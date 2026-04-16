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
        expect.objectContaining({ type: 'Document', file_path: 'README.md' }),
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
    expect(result.dirtyEdgeCount).toBe(2);

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.dirtyEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: 'CALLS',
        target: 'helper',
        source_file: 'src/run.py',
      }),
      expect.objectContaining({
        relation: 'IMPORTS',
        target: 'helper',
        source_file: 'src/run.py',
      }),
    ]));
  });
});
