import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const getHeadCommit = vi.fn();
const getDirtyFiles = vi.fn();
const getChangedFiles = vi.fn();
const withWriteLock = vi.fn();

vi.mock('../../../mcp/stdio/freshness/git.js', () => ({
  getHeadCommit,
  getDirtyFiles,
  getChangedFiles,
}));

vi.mock('../../../mcp/stdio/freshness/lock.js', () => ({
  withWriteLock,
}));

describe('freshness orchestrator', () => {
  let repoRoot;

  beforeEach(async () => {
    vi.resetModules();
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-orchestrator-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });

    getHeadCommit.mockReset();
    getDirtyFiles.mockReset();
    getChangedFiles.mockReset();
    withWriteLock.mockReset();
    withWriteLock.mockImplementation(async (_repoRoot, fn) => fn());
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('does a full rebuild when the manifest is missing', async () => {
    await writeFile(join(repoRoot, 'README.md'), '# Repo\nSummary\n');
    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def helper():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'run.py'), 'from helper import helper\n\ndef run():\n    helper()\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const result = await ensureFresh({ repoRoot });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const nodes = db.all('SELECT type, label, file_path FROM nodes');
      const edges = db.all('SELECT relation, source_file FROM edges');

      expect(result.indexed).toBe(true);
      expect(result.commit).toBe('head-1');
      expect(nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'Function', label: 'helper', file_path: 'src/helper.py' }),
        expect.objectContaining({ type: 'Function', label: 'run', file_path: 'src/run.py' }),
      ]));
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: 'CALLS', source_file: 'src/run.py' }),
      ]));
    } finally {
      db.close();
    }

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.commit).toBe('head-1');
    expect(manifest.nodes).toBeGreaterThan(0);
    expect(manifest.edges).toBeGreaterThan(0);
    expect(manifest.dirtyEdges).toEqual([]);
  });

  it('reindexes dependent caller files when a target file changes', async () => {
    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def helper():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'run.py'), 'from helper import helper\n\ndef run():\n    helper()\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def new_helper():\n    return 1\n');
    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFiles.mockResolvedValue(['src/helper.py']);
    getChangedFiles.mockResolvedValue([]);

    const result = await ensureFresh({ repoRoot });
    expect(result.dirtyEdgeCount).toBeGreaterThanOrEqual(1);

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    // At least one dirty edge should reference 'helper' from run.py
    // (improved resolver may resolve the IMPORTS edge, leaving only CALLS dirty)
    expect(manifest.dirtyEdges.length).toBeGreaterThanOrEqual(1);
    expect(manifest.dirtyEdges.some(e => e.target === 'helper' && e.source_file === 'src/run.py')).toBe(true);
  });

  it('keeps previously committed chunks when a later file write fails', async () => {
    for (let i = 0; i <= 500; i += 1) {
      const name = `file-${String(i).padStart(3, '0')}.py`;
      await writeFile(join(repoRoot, 'src', name), `def fn_${i}():\n    return ${i}\n`);
    }

    getHeadCommit.mockResolvedValue('head-chunk');
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const nodesModule = await import('../../../mcp/stdio/storage/nodes.js');
    const realUpsertNode = nodesModule.upsertNode;
    const seenFiles = new Set();
    const failedFiles = new Set();

    vi.spyOn(nodesModule, 'upsertNode').mockImplementation((db, node) => {
      if (node.file_path?.startsWith('src/file-')) {
        if (!seenFiles.has(node.file_path)) {
          seenFiles.add(node.file_path);
          if (seenFiles.size === 501 && !failedFiles.has(node.file_path)) {
            failedFiles.add(node.file_path);
            throw new Error('simulated write failure');
          }
        }
      }
      return realUpsertNode(db, node);
    });

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const result = await ensureFresh({ repoRoot });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const committed = db.get(`
        SELECT COUNT(DISTINCT file_path) AS count
        FROM nodes
        WHERE file_path LIKE 'src/file-%'
      `).count;

      expect(committed).toBe(500);
      expect(result.nodes).toBeGreaterThan(0);
    } finally {
      db.close();
    }

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('ok');
    expect(manifest.commit).toBe('head-chunk');
  });
});
