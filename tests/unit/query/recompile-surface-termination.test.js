// `terminated: true` IS A COMPLETENESS CLAIM, SO IT HAS TO EARN IT.
//
// ef-manager went looking for a case that would make it lie (2026-07-31). His
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
// hunting: the SQL `LIMIT` clips rows inside SQLite before we count them, and
// `truncated` was only set when the SEEN SET crossed the cap. A hop returning a
// full page of mostly-already-seen files therefore discarded real includers,
// left seen.size well below the cap, and reported `terminated: true` on an
// incomplete closure — false completeness sitting inside the feature built to
// prevent it.
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
// Building the isolating fixture required understanding the bug more precisely than the
// source-grep ever had to: because the query is SELECT DISTINCT, a hop returning a full
// page of 300 distinct paths normally drives `seen` to 300 as well, and the OLD guard
// catches it. The two only come apart when one returned row is ALREADY SEEN — then the
// page is full while `seen` stops one short and the old guard never fires. That is the
// shape a cyclic include produces, and it is what `fullPageWithCycle` below builds.
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

// A full page whose last row is already seen. 299 fresh includers plus a self-edge on the
// root gives exactly MAX_FILES distinct rows, of which one (the root) is already in `seen`
// — so `seen` stops at 299 additions and the old seen-size guard never fires.
const fullPageWithCycle = ({ node, imports }) => {
  node('root', 'src/root.h');
  imports('root', 'root'); // the cyclic include; without it the old guard catches the page
  for (let i = 0; i < MAX_FILES - 1; i += 1) {
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

// ef-manager's shape: a multi-hop chain of extensions an extension whitelist would stop
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
  it('★★ a FULL PAGE of SQL rows is truncation, even when the seen set never filled', async () => {
    // The real defect, reproduced. The LIMIT clips inside SQLite before anything is
    // counted, so a full page means "there may be more" whatever `seen` says. Under the
    // old rule this exact graph reported terminated:true on a closure the database had
    // already cut.
    repoRoot = await makeRepo(fullPageWithCycle);
    const s = await surfaceOf('src/root.h');

    expect(s.total, 'harness sanity: seen must stop SHORT of the cap, or the old guard fires')
      .toBeLessThan(MAX_FILES);
    expect(s.truncated, 'a full page means there may be more, always').toBe(true);
    expect(s.terminated, 'and a clipped closure is not a complete one').toBe(false);
    expect(s.note, 'the note must say FLOOR, not report a total').toMatch(/FLOOR/);
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
    // ef-manager's predicted defect, as behaviour rather than as the absence of
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
