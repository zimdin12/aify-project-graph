// ⛔⛔ DELETING A CODE FILE THAT OTHERS IMPORT MUST LEAVE NO EDGE POINTING AT ITS NODES.
//
// The invariant is the one `schema.js:33-34` DECLARES and `db.js:46` DISABLES: foreign keys are off for
// bulk ingest, so `FOREIGN KEY (to_id) REFERENCES nodes(id)` is inert. Nothing enforces it; the manual
// deletion paths agree with each other, and the agreement is the whole guarantee.
//
// ⭐ WHY THIS FILE EXISTS AT ALL, GIVEN THE INVARIANT HOLDS. The general checker already existed in
// `doc-edges-have-a-deletion-trigger.test.js` — already with no relation filter, so already general — and
// only its INVOCATION was narrow: documents, and a document's link target. A CODE file deleted out from
// under its importers was measured clean and bounded by nothing.
//
// That is a fifth shape worth naming beside population / predicate / expectation / encoding: A REPAIR THAT
// IS GENERAL IN THE FUNCTION AND NARROW AT THE CALL SITE. It is cheaper to fix than any of the four and
// easier to miss, because the code reads as if the general case is covered — the generality is right there.
//
// ⚠ AND THE SEVERITY, NOT INFLATED: three independent measurements say the invariant holds today (0
// orphans in the real 35,826-edge graph, 0 after doc deletion, 0 after this exact scenario). This buys a
// bound, not a fix. It is worth taking because an orphan edge makes `graph_callers` count a caller that
// DOES NOT EXIST — confidently wrong in the direction of "there is more here than there is", which is the
// shape a reader has no way to doubt.
//
// ⛔⛔ WHAT THIS FILE DOES *NOT* PROVE, FOUND BY A STILL GREEN WITHIN MINUTES OF WRITING IT.
//
// I removed the manual inbound-edge cleanup from the production path — `storage/nodes.js:38`,
// `DELETE FROM edges WHERE from_id = $id OR to_id = $id` inside `deleteNode` — expecting the first arm to
// go red. IT STAYED GREEN. So this file does not exercise that line, and the comment above would have
// implied it did.
//
// MEASURED, rather than reasoned about: after `git rm src/target.js`, the incremental pass reports
// `processedFiles: ['src/a.js','src/b.js','src/c.js']` — the orchestrator's dependency expansion
// REPROCESSES EVERY REFERRER, so each importer's edges are dropped by `deleteEdgesByFile(<importer>)` and
// rebuilt from source. THAT is the mechanism keeping this graph consistent, not the cleanup in `deleteNode`.
//
// ⇒ So `deleteNode`'s edge cleanup is inert AT THIS CALL SITE, and by dashboard-manager's split that means
// it is DEFENCE rather than a check: it backstops a path where a referrer is NOT reprocessed, which this
// fixture cannot construct because the expansion always includes referrers. The repair is NOT to contort
// the fixture into forcing a red on a state the system cannot reach, and it is NOT to delete the line.
//
// ⇒ WHAT THE FIRST ARM ACTUALLY PROVES: the delete-plus-reprocess-referrers path leaves no edge pointing
// at a removed node. That is worth bounding and it is narrower than the heading suggests on first read.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { orphanEdgeCounts, edgeCount } from '../../helpers/orphan-edges.js';

let repoRoot;
const dbPath = () => join(repoRoot, '.aify-graph', 'graph.sqlite');
const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
const commitAll = () => {
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
};

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-orphan-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  git('init', '-q');
  await writeFile(join(repoRoot, '.gitignore'), '.aify-graph/\n');
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function buildThreeImportersOfOneTarget() {
  await writeFile(join(repoRoot, 'src', 'target.js'), 'export function target() { return 1; }\n');
  for (const n of ['a', 'b', 'c']) {
    await writeFile(join(repoRoot, 'src', `${n}.js`),
      `import { target } from './target.js';\nexport function ${n}() { return target(); }\n`);
  }
  commitAll();
  await ensureFresh({ repoRoot });
}

describe('a code file leaving the repo takes every edge into it', () => {
  it('★★★ deleting an imported file orphans NOTHING, at either end', async () => {
    await buildThreeImportersOfOneTarget();

    // ⛔ POSITIVE CONTROL FIRST, AND IT IS THE POPULATION. "No orphan edges" is trivially true of a graph
    // with no edges, and an empty graph gives the IDENTICAL verdict to a consistent one.
    const edgesBefore = edgeCount(openDb, dbPath());
    expect(edgesBefore, 'the fixture must produce edges, or the assertion below proves nothing')
      .toBeGreaterThan(0);
    expect(orphanEdgeCounts(openDb, dbPath()), 'and the baseline must be clean, or the delete is not the cause')
      .toEqual({ from: 0, to: 0 });

    git('rm', '-q', 'src/target.js');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'delete the imported file');
    await ensureFresh({ repoRoot });

    // The three importers still say `import { target } from './target.js'`, and the file is gone. Whatever
    // becomes of those refs, no EDGE may point at a node that no longer exists.
    //
    // ⚠ THE MECHANISM IS THE REFERRER REPROCESS, NOT `deleteNode`'s CLEANUP — measured, see the header.
    // Removing `storage/nodes.js:38` leaves this arm GREEN, so do not read it as covering that line.
    expect(orphanEdgeCounts(openDb, dbPath()),
      'three importers still name the deleted file — no edge may reference its removed nodes')
      .toEqual({ from: 0, to: 0 });

    // ⚠ AND THE EDGE COUNT MUST HAVE MOVED. Without this the arm passes against a re-index that did
    // nothing at all, where "no new orphans" is true because nothing changed.
    const edgesAfter = edgeCount(openDb, dbPath());
    expect(edgesAfter, 'the deletion must actually have removed edges').toBeLessThan(edgesBefore);
  });

  it('★★★ INSTRUMENT CONTROL — the checker reports an orphan when one is planted', async () => {
    // ⛔ WITHOUT THIS, `{from:0,to:0}` ABOVE IS THE VERDICT OF A QUERY THAT MIGHT NEVER FIND ANYTHING.
    // A control on the predicate is not a control on the instrument: this plants the state in the artifact
    // the check actually reads, then requires the check to name it.
    await buildThreeImportersOfOneTarget();
    expect(orphanEdgeCounts(openDb, dbPath()), 'clean before the plant').toEqual({ from: 0, to: 0 });

    const db = openDb(dbPath());
    let planted = 0;
    try {
      const real = db.all("SELECT id FROM nodes WHERE file_path = 'src/a.js' LIMIT 1")[0];
      db.run(
        'INSERT INTO edges (from_id, to_id, relation, source_file) VALUES ($f, $t, $r, $s)',
        { f: real.id, t: 'zzq-node-that-does-not-exist', r: 'CALLS', s: 'src/a.js' },
      );
      planted = 1;
    } finally {
      db.close();
    }
    // A plant that planted nothing cannot produce a meaningful verdict.
    expect(planted, 'the plant must have inserted a row').toBe(1);

    const after = orphanEdgeCounts(openDb, dbPath());
    expect(after.to, 'the checker must see a dangling to_id').toBe(1);
    expect(after.from, 'and must not invent one at the other end').toBe(0);
  });

  it('★★★ the checker REFUSES over an empty graph instead of reporting a vacuous zero', async () => {
    // ⛔ THE GUARD THAT REPLACED A CONTRACT I BROKE. The helper's header used to say "every consumer must
    // assert the edge count is non-zero"; I then added a consumer without that control three lines later,
    // in a CHUNK ROLLBACK test where a near-empty graph is realistic. A prose contract is a note.
    //
    // ⚠ Measured before this landed: the four existing call sites hold 1, 1/3/5, and 10/15/15/16 edges. None
    // is empty, so this refusal breaks nothing — but two sit at ONE edge, so the vacuous case was one
    // fixture change away rather than hypothetical.
    await buildThreeImportersOfOneTarget();

    // POSITIVE CONTROL: with edges present it answers normally, so the refusal below is about emptiness and
    // not about the helper being broken outright.
    expect(orphanEdgeCounts(openDb, dbPath()), 'answers while the graph has edges').toEqual({ from: 0, to: 0 });

    const db = openDb(dbPath());
    try {
      db.run('DELETE FROM edges');
    } finally {
      db.close();
    }
    expect(edgeCount(openDb, dbPath()), 'the plant must really have emptied the edge table').toBe(0);

    // ⛔ AND THE MESSAGE MUST NAME THE PRECONDITION, not merely fail. A throw a reader cannot diagnose sends
    // them to the wrong place, which is the same cost as a red stating the wrong reason.
    expect(() => orphanEdgeCounts(openDb, dbPath())).toThrow(/ZERO edges/u);
  });
});
