// ⛔ THE ADMISSION CHANGE, THROUGH THE REAL INCREMENTAL PIPELINE — not resolveRefs in isolation.
//
// 970ed13 excluded External from ordinary resolution and routed every External-bound edge through one
// admission decision. Its unit tests call resolveRefs directly, and its effect measurement was a
// whole-index A/B. Neither exercises `ensureFresh`, which is what actually runs when a file changes,
// and I said so plainly when I sent it for review rather than letting the gap pass unmentioned.
//
// Two things are pinned here that only the real pipeline can show:
//
//  1. A refused terminal is not merely skipped at resolution time — the edge does not survive a
//     re-index, so an agent querying the graph after an ordinary edit does not see it.
//  2. When a terminal loses its LAST admitted edge, `cleanupOrphanExternalNodes` collects it. That
//     sweep was correct all along but had been STARVED: refs kept re-binding to stubs and refreshing
//     their edges, so the node never became an orphan.
//
// ⭐ LIVENESS FIRST IN EVERY ARM. A re-index that silently did nothing produces exactly the same
// "the edge is gone" reading as one that worked, and this repository has already published one void
// result from that confusion. Each test asserts the file was actually re-processed before it reads
// anything else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';

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

function withDb(repoRoot, fn) {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

describe('external admission survives a real incremental re-index', () => {
  let repoRoot;

  beforeEach(async () => {
    vi.resetModules();
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-admission-fresh-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });

    for (const m of [getHeadCommit, getDirtyFileEntries, getDirtyFiles, getChangedFiles, withWriteLock]) m.mockReset();
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
    await writeFile(
      join(repoRoot, 'src', 'run.js'),
      'export function run(rows) {\n  return rows.map((r) => r.id);\n}\n',
    );
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });
    return ensureFresh;
  }

  function markDirty(relPath) {
    getDirtyFileEntries.mockResolvedValue([{ path: relPath, status: ' M', untracked: false }]);
    getDirtyFiles.mockResolvedValue([relPath]);
  }

  /** Plant the exact shape the old bypass produced: a stub, plus an edge from this file to it. */
  function plantRefusedStub(db, { id, label, relation }) {
    const owner = db.get(
      "SELECT id FROM nodes WHERE type IN ('Function','Method') AND file_path = 'src/run.js' LIMIT 1",
    );
    expect(owner, 'setup: the seed index must have produced a function node').toBeTruthy();
    upsertNode(db, {
      id, type: 'External', label, file_path: '', start_line: 0, end_line: 0,
      language: 'js_ts', confidence: 0.5, structural_fp: '', dependency_fp: '', extra: { external: true },
    });
    upsertEdge(db, {
      from_id: owner.id, to_id: id, relation,
      source_file: 'src/run.js', source_line: 2, confidence: 0.7,
      provenance: 'AMBIGUOUS', extractor: 'javascript',
    });
    return owner.id;
  }

  const countEdgesTo = (db, id) => db.all('SELECT COUNT(*) AS n FROM edges WHERE to_id = $id', { id })[0].n;
  const countNode = (db, id) => db.all('SELECT COUNT(*) AS n FROM nodes WHERE id = $id', { id })[0].n;

  it('⛔ a refused REFERENCES terminal does not survive the re-index, and is then collected', async () => {
    const ensureFresh = await seed();
    withDb(repoRoot, (db) => {
      plantRefusedStub(db, { id: 'external:planted-local', label: 'rows', relation: 'REFERENCES' });
      expect(countEdgesTo(db, 'external:planted-local'), 'setup: the stub must start with its edge').toBe(1);
    });

    // A new exported function is unambiguously structural — a top-level const is classified cosmetic
    // and skipped, which is how an earlier probe of mine produced a void result.
    await writeFile(
      join(repoRoot, 'src', 'run.js'),
      'export function run(rows) {\n  return rows.map((r) => r.id);\n}\n\nexport function added(rows) {\n  return rows.length;\n}\n',
    );
    markDirty('src/run.js');
    const result = await ensureFresh({ repoRoot });

    // ⭐ LIVENESS — everything below is void if the file was not re-processed.
    expect(result.processedFiles, 'the re-index must actually have touched src/run.js')
      .toContain('src/run.js');

    withDb(repoRoot, (db) => {
      expect(countEdgesTo(db, 'external:planted-local'), 'a refused terminal keeps no edge').toBe(0);
      expect(countNode(db, 'external:planted-local'), 'and the orphan sweep collects it').toBe(0);
    });
  });

  it('⭐ CONTROL: an ADMITTED terminal survives the same re-index', async () => {
    // Without this, the test above is satisfied by a re-index that wipes every External
    // indiscriminately — which would be a far worse defect than the one being fixed.
    const ensureFresh = await seed();
    withDb(repoRoot, (db) => {
      plantRefusedStub(db, { id: 'external:planted-call', label: 'lodashMerge', relation: 'CALLS' });
    });

    await writeFile(
      join(repoRoot, 'src', 'run.js'),
      'export function run(rows) {\n  return rows.map((r) => r.id);\n}\n\nexport function alsoAdded(rows) {\n  return lodashMerge(rows);\n}\n',
    );
    markDirty('src/run.js');
    const result = await ensureFresh({ repoRoot });

    expect(result.processedFiles).toContain('src/run.js');

    withDb(repoRoot, (db) => {
      // The source really calls lodashMerge now, so an admitted CALLS terminal must exist for it.
      const rows = db.all("SELECT id FROM nodes WHERE type = 'External' AND label = 'lodashMerge'");
      expect(rows, 'an admitted callee must keep a terminal').toHaveLength(1);
      expect(countEdgesTo(db, rows[0].id)).toBeGreaterThan(0);
    });
  });
});
