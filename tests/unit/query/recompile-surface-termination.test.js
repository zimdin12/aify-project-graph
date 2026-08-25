// `terminated: true` IS A COMPLETENESS CLAIM, SO IT HAS TO EARN IT.
//
// the field test went looking for a case that would make it lie (2026-07-31). His
// predicted mechanism was extension-based terminality — a walk that stops at
// anything that is not .h/.cpp would be defeated by the first .inl/.tpp/.glsl it
// met. He built a GLSL chain to prove it, since this repo's shaders have real
// multi-hop #include.
//
// That defect does not exist: terminality is decided by the GRAPH (the frontier
// ran out of includers), never by file extension, and the walk crossed
// gravity-field.glsl → gravity_helpers.glsl → pcas_powder.comp.glsl correctly.
// His hand-built chain was also wrong on one edge — lbm_fluid.comp.glsl includes
// worldbuf.glsl, not gravity-field.glsl.
//
// ★ But looking for his defect found a REAL one, of exactly the class he was
// hunting: the SQL `LIMIT` clips rows inside SQLite before we count them, while
// `truncated` was set only when the SEEN SET crossed the cap. A hop can therefore
// return a full page, lose real includers to the LIMIT, leave `seen` below the cap,
// and report `terminated: true` on an incomplete closure — false completeness inside
// the feature built to prevent it.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version asserted four regexes over pull.js, one of them an exact
// reproduction of a whole line of source including its spacing
// (`if (rows.length >= TRANSITIVE_MAX_FILES) truncated = true;`). Reformat that line and
// the case reds having found nothing; rewrite the walk to compute the same verdict a
// different way and it reds too. Neither is a defect. Meanwhile a wrong verdict — the
// actual bug — is invisible to all four, because none of them ever ran the walk.
//
// ⚠⚠ MY FIXTURE CLAIM WAS FALSE, AND review, hermes session MEASURED IT.
//
// I wrote that `fullPageWithCycle` reproduces the clipping defect — that SQLite "had
// already cut" the closure and real includers were discarded. They ran it: 300 candidates,
// 300 returned, **0 omitted**. Nothing was clipped. On that exact graph the old
// `terminated: true` was factually CORRECT.
//
// ⇒ The full-page fixture pins a conservative POLICY — "an exactly-full page cannot
// establish completeness", which is true and worth pinning, because 300 returned rows
// cannot distinguish 300 candidates from 3000. It is NOT a witness to omission, and I
// presented it as one.
//
// ★ That is the wording-contract defect — a prose claim outliving its evidence — committed
// inside the test file whose header teaches that lesson, in the session I wrote the lesson.
// Recorded rather than quietly amended.
//
// So there are now TWO fixtures, and they assert different things:
//   · fullPage (root + 299) — 300 candidates, nothing omitted → POLICY: cannot establish.
//   · overflow (root + 300) — 301 candidates, 300 returned, ONE omitted → real clipping.
// Only the second supports the defect narrative. Both preserve the already-seen root row,
// so neither can be satisfied by the old seen-size guard.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// Mirrors the constants in pull.js. If those move, these fixtures stop testing the
// boundary they are named for — so the first case asserts the page is genuinely full
// rather than trusting the number.
const MAX_FILES = 300;

let repoRoot;

async function makeRepo(build) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-recompile-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const node = (id, file) => db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, 'File', $id, $file, 1, 1, 'cpp', 1, '{}')`,
    { id, file },
  );
  // from IMPORTS to  ⇒  `from` is an includer of `to`, which is the direction the
  // recompile walk follows (who must rebuild when `to` changes).
  const imports = (from, to) => db.run(
    `INSERT INTO edges (from_id, to_id, relation, confidence)
     VALUES ($f, $t, 'IMPORTS', 1)`,
    { f: from, t: to },
  );
  build({ node, imports });
  db.close();
  return repo;
}

// EXACTLY the cap. 299 fresh includers plus a self-edge on the root gives 300 distinct
// candidates, of which one (the root) is already in `seen` — so `seen` takes only 299
// additions and the old seen-size guard never fires. Nothing is omitted here: this fixture
// exists to pin the POLICY that a full page cannot establish completeness.
const fullPageExactly = ({ node, imports }) => {
  node('root', 'src/root.h');
  imports('root', 'root'); // the cyclic include; without it the old guard catches the page
  for (let i = 0; i < MAX_FILES - 1; i += 1) {
    node(`a${i}`, `src/a${i}.cpp`);
    imports(`a${i}`, 'root');
  }
};

// ONE OVER the cap — dev's positive control, and the only fixture that witnesses real
// omission. 300 fresh includers plus the root self-edge is 301 candidates for a LIMIT of
// 300, so exactly one includer is discarded inside SQLite before anything is counted.
const fullPageOverflow = ({ node, imports }) => {
  node('root', 'src/root.h');
  imports('root', 'root');
  for (let i = 0; i < MAX_FILES; i += 1) {
    node(`a${i}`, `src/a${i}.cpp`);
    imports(`a${i}`, 'root');
  }
};

// Five hops of includers against a depth budget of four.
const deepChain = ({ node, imports }) => {
  node('root', 'src/root.h');
  let prev = 'root';
  for (let i = 1; i <= 5; i += 1) {
    node(`h${i}`, `src/h${i}.h`);
    imports(`h${i}`, prev);
    prev = `h${i}`;
  }
};

// the field test's shape: a multi-hop chain of extensions an extension whitelist would stop
// at. THREE hops, deliberately — a four-hop chain ends with the frontier still holding the
// last file when the depth loop exits, so `depth_capped` is true and `terminated` is
// correctly false. That is not the case being tested here, and the first version of this
// fixture got it wrong: the walk must run out of GRAPH, not out of budget, which means the
// last hop has to come back empty. The .inl and .tpp sit side by side at depth 3.
const shaderChain = ({ node, imports }) => {
  node('root', 'shaders/gravity-field.glsl');
  node('helpers', 'shaders/gravity_helpers.glsl');
  node('powder', 'shaders/pcas_powder.comp.glsl');
  node('inl', 'src/detail/matrix_ops.inl');
  node('tpl', 'src/detail/traits.tpp');
  imports('helpers', 'root');
  imports('powder', 'helpers');
  imports('inl', 'powder');
  imports('tpl', 'powder');
};

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

// graph_pull returns a JSON string, and the surface lives under the `relations` LAYER —
// which has to be asked for. Both facts were learned by probing rather than assumed, after
// the sanity guard below caught the first attempt reading `res.relations` off a string.
const surfaceOf = async (target) => {
  const raw = await graphPull({ repoRoot, node: target, layers: ['relations'] });
  const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const s = res?.layers?.relations?.recompile_surface;
  expect(s, 'harness sanity: the pull must produce a recompile surface').toBeTruthy();
  return s;
};

describe('recompile surface cannot claim a completeness it did not verify', () => {
  it('★★ an exactly-FULL page cannot establish completeness (policy, not omission)', async () => {
    // ⚠ This fixture omits NOTHING — measured: 300 candidates, 300 returned, 0 omitted.
    // What it pins is that a full page is INDISTINGUISHABLE from an overflowing one, so
    // the walk must decline to claim terminality. The old rule looked only at `seen`,
    // which stops one short here, and claimed completeness.
    repoRoot = await makeRepo(fullPageExactly);
    const s = await surfaceOf('src/root.h');

    expect(s.total, 'harness sanity: seen must stop SHORT of the cap, or the old guard fires')
      .toBeLessThan(MAX_FILES);
    expect(s.truncated, 'a full page means there MAY be more — it cannot prove otherwise').toBe(true);
    expect(s.terminated, 'and an unestablished closure is not a complete one').toBe(false);
    expect(s.note, 'the note must not overclaim either — see the wording fix in pull.js')
      .toMatch(/completeness not established|may be incomplete/i);
    // Nothing was actually lost here, and the test says so — the counterpart to the
    // omitted-identity assertion below.
    const reachedAll = new Set(s.byDepth.flatMap((d) => d.files));
    const exist = Array.from({ length: MAX_FILES - 1 }, (_, i) => `src/a${i}.cpp`);
    expect(exist.filter((f) => !reachedAll.has(f)), 'an exactly-full page omits nothing').toEqual([]);
  }, 30_000);

  it('★★ a page that OVERFLOWS really does lose an includer', async () => {
    // dev's positive control, and the actual defect witness. 301 candidates against
    // LIMIT 300: one real includer is discarded inside SQLite before anything counts it.
    // This is the case my original fixture claimed to be and was not.
    repoRoot = await makeRepo(fullPageOverflow);
    const s = await surfaceOf('src/root.h');

    expect(s.truncated, 'a genuinely clipped closure must say so').toBe(true);
    expect(s.terminated).toBe(false);
    // ★★ THE OMITTED IDENTITY, which is what makes this a witness rather than a rerun of
    // the case above. Both fixtures report total=299 — that number alone distinguishes
    // nothing. Here 300 includers EXIST and one of them is absent from the closure; in
    // the exactly-full fixture all 299 that exist are present.
    const reached = new Set(s.byDepth.flatMap((d) => d.files));
    const expected = Array.from({ length: MAX_FILES }, (_, i) => `src/a${i}.cpp`);
    const missing = expected.filter((f) => !reached.has(f));
    expect(missing.length, 'exactly one real includer was discarded inside SQLite').toBe(1);
  }, 30_000);

  it('★★ running out of DEPTH is reported separately from running out of FILES', async () => {
    // Two different reasons for an incomplete answer. Collapsing them tells the reader
    // the surface is a floor without telling them which budget to raise.
    repoRoot = await makeRepo(deepChain);
    const s = await surfaceOf('src/root.h');

    expect(s.depth_capped, 'five hops against a budget of four').toBe(true);
    expect(s.truncated, 'the FILE cap was nowhere near — five files').toBe(false);
    expect(s.terminated).toBe(false);
    expect(s.note).toMatch(/CUT OFF at depth/);
  }, 30_000);

  it('★★ claims terminated only when the frontier emptied ON ITS OWN', async () => {
    // The positive case. Without it the other two are satisfied by a walk that never
    // claims completeness at all, which would be useless rather than wrong.
    repoRoot = await makeRepo(shaderChain);
    const s = await surfaceOf('shaders/gravity-field.glsl');

    expect(s.terminated, 'nothing includes the last file — the walk ran out of graph').toBe(true);
    expect(s.truncated).toBe(false);
    expect(s.depth_capped).toBe(false);
  }, 30_000);

  it('★★ decides terminality from the graph, not from file extension', async () => {
    // the field test's predicted defect, as behaviour rather than as the absence of
    // `endsWith(` in a slice of source. An extension whitelist would stop at the first
    // .glsl and report a 1-hop closure; a .tpp four hops out proves it did not.
    repoRoot = await makeRepo(shaderChain);
    const s = await surfaceOf('shaders/gravity-field.glsl');

    const reached = s.byDepth.flatMap((d) => d.files);
    expect(reached, 'crossed .glsl → .comp.glsl → .inl and .tpp').toContain('src/detail/traits.tpp');
    expect(reached, 'and the .inl beside it').toContain('src/detail/matrix_ops.inl');
    expect(s.total, 'all four includers, none dropped for its extension').toBe(4);
  }, 30_000);
});
