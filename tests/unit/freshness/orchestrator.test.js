import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

describe('freshness orchestrator', () => {
  let repoRoot;

  beforeEach(async () => {
    vi.resetModules();
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-orchestrator-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });

    getHeadCommit.mockReset();
    getDirtyFileEntries.mockReset();
    getDirtyFiles.mockReset();
    getChangedFiles.mockReset();
    withWriteLock.mockReset();
    withWriteLock.mockImplementation(async (_repoRoot, fn) => fn());
    getDirtyFileEntries.mockImplementation(async () =>
      (getDirtyFiles.getMockImplementation()
        ? (await getDirtyFiles())?.map((path) => ({ path, status: ' M', untracked: false })) ?? []
        : []));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('does a full rebuild when the manifest is missing', async () => {
    await writeFile(join(repoRoot, 'README.md'), '# Repo\nSummary\n');
    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def helper():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'run.py'), 'from helper import helper\n\ndef run():\n    helper()\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([]);
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
    expect(manifest.trustDirtyEdgeCount).toBe(0);
  });

  it('ignores build-prefixed scratch trees during a full rebuild', async () => {
    await mkdir(join(repoRoot, 'build-linux-techlead', 'generated'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'main.py'), 'def main():\n    return 1\n');
    await writeFile(join(repoRoot, 'build-linux-techlead', 'generated', 'scratch.py'), 'def scratch():\n    return 2\n');

    getHeadCommit.mockResolvedValue('head-ignore-build');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const ignoredNodes = db.all(`
        SELECT file_path
        FROM nodes
        WHERE file_path LIKE 'build-linux-techlead/%'
      `);

      expect(ignoredNodes).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('preserves framework Route nodes while reindexing the backing route file', async () => {
    const fixtureRoot = join(process.cwd(), 'tests', 'fixtures', 'ingest', 'tiny-laravel-middleware');
    await mkdir(join(repoRoot, 'app', 'Http', 'Controllers'), { recursive: true });
    await mkdir(join(repoRoot, 'app', 'Http', 'Middleware'), { recursive: true });
    await mkdir(join(repoRoot, 'routes'), { recursive: true });
    await copyFile(join(fixtureRoot, 'composer.json'), join(repoRoot, 'composer.json'));
    await copyFile(join(fixtureRoot, 'app', 'Http', 'Kernel.php'), join(repoRoot, 'app', 'Http', 'Kernel.php'));
    await copyFile(join(fixtureRoot, 'app', 'Http', 'Controllers', 'ProfileController.php'), join(repoRoot, 'app', 'Http', 'Controllers', 'ProfileController.php'));
    await copyFile(join(fixtureRoot, 'app', 'Http', 'Middleware', 'RequireToken.php'), join(repoRoot, 'app', 'Http', 'Middleware', 'RequireToken.php'));
    await copyFile(join(fixtureRoot, 'app', 'Http', 'Middleware', 'ThrottleNonIntrusive.php'), join(repoRoot, 'app', 'Http', 'Middleware', 'ThrottleNonIntrusive.php'));
    await copyFile(join(fixtureRoot, 'routes', 'api.php'), join(repoRoot, 'routes', 'api.php'));

    getHeadCommit.mockResolvedValue('head-laravel');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const route = db.get(`
        SELECT id, type, label, file_path
        FROM nodes
        WHERE type = 'Route' AND label = 'GET /profile'
      `);
      const executionEdges = db.get(`
        SELECT COUNT(*) AS count
        FROM edges
        WHERE relation IN ('INVOKES', 'PASSES_THROUGH')
      `);
      const orphanedFrom = db.get(`
        SELECT COUNT(*) AS count
        FROM edges e
        WHERE e.relation IN ('INVOKES', 'PASSES_THROUGH')
          AND NOT EXISTS (SELECT 1 FROM nodes WHERE id = e.from_id)
      `);
      const chain = db.all(`
        SELECT f.label AS from_label, f.file_path AS from_file, e.relation, t.label AS to_label, t.file_path AS to_file
        FROM edges e
        JOIN nodes f ON f.id = e.from_id
        JOIN nodes t ON t.id = e.to_id
        WHERE e.relation IN ('INVOKES', 'PASSES_THROUGH')
          AND (
            f.label = 'GET /profile'
            OR f.label = 'handle'
            OR t.label = 'show'
          )
        ORDER BY
          CASE e.relation WHEN 'PASSES_THROUGH' THEN 0 ELSE 1 END,
          f.label,
          t.label
      `);

      expect(route).toEqual(expect.objectContaining({
        type: 'Route',
        label: 'GET /profile',
        file_path: 'routes/api.php',
      }));
      expect(executionEdges.count).toBeGreaterThan(0);
      expect(orphanedFrom.count).toBe(0);
      expect(chain).toEqual(expect.arrayContaining([
        expect.objectContaining({ from_label: 'GET /profile', from_file: 'routes/api.php', relation: 'PASSES_THROUGH', to_label: 'handle', to_file: 'app/Http/Middleware/RequireToken.php' }),
        expect.objectContaining({ from_label: 'handle', from_file: 'app/Http/Middleware/RequireToken.php', relation: 'PASSES_THROUGH', to_label: 'handle', to_file: 'app/Http/Middleware/ThrottleNonIntrusive.php' }),
        expect.objectContaining({ from_label: 'handle', from_file: 'app/Http/Middleware/ThrottleNonIntrusive.php', relation: 'PASSES_THROUGH', to_label: 'show', to_file: 'app/Http/Controllers/ProfileController.php' }),
      ]));
    } finally {
      db.close();
    }
  });

  it('reindexes dependent caller files when a target file changes', async () => {
    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def helper():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'run.py'), 'from helper import helper\n\ndef run():\n    helper()\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, 'src', 'helper.py'), 'def new_helper():\n    return 1\n');
    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([{ path: 'src/helper.py', status: ' M', untracked: false }]);
    getDirtyFiles.mockResolvedValue(['src/helper.py']);
    getChangedFiles.mockResolvedValue([]);

    const result = await ensureFresh({ repoRoot });
    expect(result.dirtyEdgeCount).toBe(0);

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.dirtyEdges).toEqual([]);

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const external = db.get(`
        SELECT type, label
        FROM nodes
        WHERE type = 'External' AND label = 'helper'
      `);
      const call = db.get(`
        SELECT relation
        FROM edges
        WHERE source_file = 'src/run.py'
          AND relation = 'CALLS'
          AND to_id = (SELECT id FROM nodes WHERE type = 'External' AND label = 'helper')
      `);

      expect(external).toEqual(expect.objectContaining({ type: 'External', label: 'helper' }));
      expect(call).toEqual(expect.objectContaining({ relation: 'CALLS' }));
    } finally {
      db.close();
    }
  });

  it('skips incremental reindex work for brand-new untracked files not yet in the graph', async () => {
    await writeFile(join(repoRoot, 'src', 'main.py'), 'def main():\n    return 1\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, 'src', 'new_helper.py'), 'def helper():\n    return 2\n');
    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([{ path: 'src/new_helper.py', status: '??', untracked: true }]);
    getDirtyFiles.mockResolvedValue(['src/new_helper.py']);
    getChangedFiles.mockResolvedValue([]);

    const result = await ensureFresh({ repoRoot });
    expect(result.processedFiles).toEqual([]);
    expect(result.dirtyEdgeCount).toBe(0);

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const newFileNode = db.get(`SELECT id FROM nodes WHERE file_path = 'src/new_helper.py' LIMIT 1`);
      expect(newFileNode).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('skips incremental reindex work for already-indexed untracked files too', async () => {
    await writeFile(join(repoRoot, 'src', 'scratch.py'), 'def scratch():\n    return 1\n');

    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, 'src', 'scratch.py'), 'def scratch():\n    return 2\n');
    getHeadCommit.mockResolvedValue('head-1');
    getDirtyFileEntries.mockResolvedValue([{ path: 'src/scratch.py', status: '??', untracked: true }]);
    getDirtyFiles.mockResolvedValue(['src/scratch.py']);
    getChangedFiles.mockResolvedValue([]);

    const result = await ensureFresh({ repoRoot });
    expect(result.processedFiles).toEqual([]);

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const node = db.get(`SELECT label FROM nodes WHERE file_path = 'src/scratch.py' LIMIT 1`);
      expect(node).toEqual(expect.objectContaining({ label: 'scratch.py' }));
    } finally {
      db.close();
    }
  });

  it('keeps previously committed chunks when a later file write fails', async () => {
    for (let i = 0; i <= 500; i += 1) {
      const name = `file-${String(i).padStart(3, '0')}.py`;
      await writeFile(join(repoRoot, 'src', name), `def fn_${i}():\n    return ${i}\n`);
    }

    getHeadCommit.mockResolvedValue('head-chunk');
    getDirtyFileEntries.mockResolvedValue([]);
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

  it('does not carry sidecar unresolved refs into a force rebuild', async () => {
    await writeFile(join(repoRoot, 'src', 'main.py'), 'def main():\n    return 1\n');
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'old-head',
      indexedAt: '2026-04-21T00:00:00.000Z',
      nodes: 0,
      edges: 0,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [{ source_file: 'ghost.py', relation: 'CALLS', target: 'missing', extractor: 'python' }],
      dirtyEdgeCount: 1,
      trustDirtyEdgeCount: 1,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'dirty-edges.full.json'), JSON.stringify({
      dirtyEdges: [{ source_file: 'ghost.py', relation: 'CALLS', target: 'missing', extractor: 'python' }],
    }));

    getHeadCommit.mockResolvedValue('head-force');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const result = await ensureFresh({ repoRoot, force: true });

    expect(result.dirtyEdgeCount).toBe(0);
    expect(result.trustDirtyEdgeCount).toBe(0);
    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.dirtyEdgeCount).toBe(0);
    expect(manifest.trustDirtyEdgeCount).toBe(0);
    expect(manifest.dirtyEdges).toEqual([]);
  });

  it('drops stale unresolved refs for reprocessed files and ignored scratch paths', async () => {
    await writeFile(join(repoRoot, 'src', 'run.py'), 'def run():\n    return 1\n');

    getHeadCommit.mockResolvedValue('head-a');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });

    await writeFile(join(repoRoot, '.aify-graph', 'dirty-edges.full.json'), JSON.stringify({
      dirtyEdges: [
        { source_file: 'src/run.py', relation: 'CALLS', target: 'ghost', extractor: 'python' },
        { source_file: '.codex_tmp/task89batch/Ghost.cpp', relation: 'CALLS', target: 'ghost', extractor: 'cpp' },
      ],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'head-a',
      indexedAt: '2026-04-21T00:00:00.000Z',
      nodes: 1,
      edges: 1,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 2,
      trustDirtyEdgeCount: 2,
    }));

    await writeFile(join(repoRoot, 'src', 'run.py'), 'def run_clean():\n    return 1\n');
    getHeadCommit.mockResolvedValue('head-b');
    getDirtyFileEntries.mockResolvedValue([{ path: 'src/run.py', status: ' M', untracked: false }]);
    getDirtyFiles.mockResolvedValue(['src/run.py']);
    getChangedFiles.mockResolvedValue([]);

    const result = await ensureFresh({ repoRoot });
    expect(result.dirtyEdgeCount).toBe(0);
    expect(result.trustDirtyEdgeCount).toBe(0);

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.dirtyEdgeCount).toBe(0);
    expect(manifest.trustDirtyEdgeCount).toBe(0);
    expect(manifest.dirtyEdges).toEqual([]);
  });

  it('defers huge partial-resume work for read-like callers when requested', async () => {
    await writeFile(join(repoRoot, 'src', 'a.py'), 'def a():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'b.py'), 'def b():\n    return 1\n');
    await writeFile(join(repoRoot, 'src', 'c.py'), 'def c():\n    return 1\n');
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      db.run(
        `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
         VALUES ('f-a', 'File', 'a.py', 'src/a.py', 1, 0, 'python', 1.0, '', '', '{}')`,
      );
    } finally {
      db.close();
    }

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'head-partial',
      indexedAt: '2026-04-23T00:00:00.000Z',
      nodes: 1,
      edges: 0,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'indexing',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 0,
      trustDirtyEdgeCount: 0,
    }));

    getHeadCommit.mockResolvedValue('head-partial');
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const result = await ensureFresh({
      repoRoot,
      allowLargePartialResume: false,
      partialResumeLimit: 1,
    });

    expect(result.partialResumeDeferred).toBe(true);
    expect(result.alreadyProcessedFiles).toBe(1);
    expect(result.pendingFiles).toBeNull();
    expect(result.processedFiles).toEqual([]);

    const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('indexing');
  });
});
