// P1-6: structural-vs-cosmetic change classification on the incremental
// `ensureFresh` path.
//
//  - A body-only / comment / whitespace / literal edit leaves the file's
//    structural fingerprint unchanged → COSMETIC → re-extraction +
//    re-resolution is skipped, existing nodes/edges are kept byte-identical,
//    and `cosmeticSkipped` reflects it.
//  - A signature change OR an added call changes the fingerprint → STRUCTURAL
//    → the file is re-extracted and the new shape/edge appears.
//  - The added-call case is the correctness guard: a body edit that introduces
//    a new outgoing CALL edge MUST be treated as structural even though no
//    signature changed (a false "cosmetic" would silently drop the edge).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const getHeadCommit = vi.fn();
const getDirtyFiles = vi.fn();
const getDirtyFileEntries = vi.fn();
const getChangedFiles = vi.fn();
const withWriteLock = vi.fn();

vi.mock('../../../mcp/stdio/freshness/git.js', () => ({
  getHeadCommit,
  getDirtyFileEntries,
  getDirtyFiles,
  getChangedFiles,
}));

vi.mock('../../../mcp/stdio/freshness/lock.js', () => ({
  withWriteLock,
}));

function snapshot(db) {
  const nodes = db.all(
    'SELECT id, type, label, file_path, structural_fp, dependency_fp FROM nodes ORDER BY id',
  );
  const edges = db.all(
    'SELECT from_id, to_id, relation, source_file FROM edges ORDER BY from_id, to_id, relation',
  );
  return { nodes, edges };
}

function withDb(repoRoot, fn) {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe('P1-6 cosmetic-vs-structural change classification', () => {
  let repoRoot;

  beforeEach(async () => {
    vi.resetModules();
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-cosmetic-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });

    getHeadCommit.mockReset();
    getDirtyFileEntries.mockReset();
    getDirtyFiles.mockReset();
    getChangedFiles.mockReset();
    withWriteLock.mockReset();
    withWriteLock.mockImplementation(async (_repoRoot, fn) => fn());
    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function seed() {
    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def helper():\n    return 1\n');
    await writeFile(
      join(repoRoot, 'src', 'run.py'),
      'from helper import helper\n\ndef run():\n    helper()\n',
    );
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });
    return ensureFresh;
  }

  function markDirty(relPath) {
    getDirtyFileEntries.mockResolvedValue([{ path: relPath, status: ' M', untracked: false }]);
    getDirtyFiles.mockResolvedValue([relPath]);
  }

  it('classifies a body-only edit as COSMETIC and leaves nodes/edges byte-identical', async () => {
    const ensureFresh = await seed();
    const before = withDb(repoRoot, snapshot);

    // Body-only change: same signature, same calls, only the literal differs.
    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper\n\ndef run():\n    helper()  # tweaked comment\n    return 42\n');
    markDirty('src/run.py');

    const result = await ensureFresh({ repoRoot });

    expect(result.cosmeticSkipped).toBe(1);
    expect(result.processedFiles).toEqual([]); // nothing re-extracted

    const after = withDb(repoRoot, snapshot);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
  });

  it('classifies a SIGNATURE change as STRUCTURAL and re-extracts the new shape', async () => {
    const ensureFresh = await seed();
    const before = withDb(repoRoot, snapshot);
    const runNodeBefore = before.nodes.find((n) => n.type === 'Function' && n.label === 'run');

    // Add a parameter → signature change → structural.
    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper\n\ndef run(verbose):\n    helper()\n');
    markDirty('src/run.py');

    const result = await ensureFresh({ repoRoot });

    expect(result.cosmeticSkipped).toBe(0);
    expect(result.processedFiles).toContain('src/run.py');

    const after = withDb(repoRoot, snapshot);
    const runNodeAfter = after.nodes.find((n) => n.type === 'Function' && n.label === 'run');
    expect(runNodeAfter).toBeDefined();
    // Same id (stable qname) but a different structural fingerprint.
    expect(runNodeAfter.id).toBe(runNodeBefore.id);
    expect(runNodeAfter.structural_fp).not.toBe(runNodeBefore.structural_fp);
  });

  it('treats an ADDED CALL (body-only, no signature change) as STRUCTURAL and adds the new edge (correctness guard)', async () => {
    const ensureFresh = await seed();

    // No signature change, but the body now calls a second function. This MUST
    // be structural — a false "cosmetic" would silently drop the new CALLS edge.
    await writeFile(join(repoRoot, 'src', 'helper.py'),
      'def helper():\n    return 1\n\ndef helper2():\n    return 2\n');
    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper, helper2\n\ndef run():\n    helper()\n    helper2()\n');
    // Both files dirty (helper gains a symbol, run gains a call).
    getDirtyFileEntries.mockResolvedValue([
      { path: 'src/helper.py', status: ' M', untracked: false },
      { path: 'src/run.py', status: ' M', untracked: false },
    ]);
    getDirtyFiles.mockResolvedValue(['src/helper.py', 'src/run.py']);

    const result = await ensureFresh({ repoRoot });

    expect(result.cosmeticSkipped).toBe(0);
    expect(result.processedFiles).toContain('src/run.py');

    withDb(repoRoot, (db) => {
      const runId = db.get(
        `SELECT id FROM nodes WHERE type = 'Function' AND label = 'run' AND file_path = 'src/run.py'`,
      ).id;
      const calls = db.all(
        `SELECT n.label AS label FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id = $from AND e.relation = 'CALLS'`,
        { from: runId },
      ).map((r) => r.label);
      // The newly-added helper2 call edge must now exist.
      expect(calls).toContain('helper2');
    });
  });

  it('treats a REMOVED call as STRUCTURAL too (edge must disappear)', async () => {
    // Seed run() with two calls, then remove one — body-only but edge-affecting.
    await writeFile(join(repoRoot, 'src', 'helper.py'),
      'def helper():\n    return 1\n\ndef helper2():\n    return 2\n');
    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper, helper2\n\ndef run():\n    helper()\n    helper2()\n');
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper, helper2\n\ndef run():\n    helper()\n');
    markDirty('src/run.py');

    const result = await ensureFresh({ repoRoot });
    expect(result.cosmeticSkipped).toBe(0);

    withDb(repoRoot, (db) => {
      const runId = db.get(
        `SELECT id FROM nodes WHERE type = 'Function' AND label = 'run' AND file_path = 'src/run.py'`,
      ).id;
      const calls = db.all(
        `SELECT n.label AS label FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id = $from AND e.relation = 'CALLS'`,
        { from: runId },
      ).map((r) => r.label);
      expect(calls).not.toContain('helper2');
    });
  });

  it('treats a changed file with no stored fingerprint (e.g. legacy graph) as STRUCTURAL', async () => {
    const ensureFresh = await seed();
    // ⚠ SIMULATE THE LEGACY STATE WHERE IT NOW LIVES. This deleted structural-fp.json, which was
    // the right move while fingerprints were a file — and became INERT the moment they moved into
    // the transaction: the file was gone, the table still had the fingerprint, the fast path fired,
    // and a test written to prove the conservative branch was silently exercising the other one.
    // It failed loudly rather than passing vacuously only because the assertion is on a count.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try { db.exec('DROP TABLE structural_fingerprints'); } finally { db.close(); }

    // Pure body edit that WOULD be cosmetic — but without a stored fp we must
    // conservatively re-extract.
    await writeFile(join(repoRoot, 'src', 'run.py'),
      'from helper import helper\n\ndef run():\n    helper()\n    return 7\n');
    markDirty('src/run.py');

    const result = await ensureFresh({ repoRoot });
    expect(result.cosmeticSkipped).toBe(0);
    expect(result.processedFiles).toContain('src/run.py');
  });
});
