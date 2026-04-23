// graph_health aggregates existing signals (indexed state, trust,
// staleness, overlay validity) into one answer. Pure synthesis — no
// new data. Tests cover the decision branches: no-graph, fresh+clean,
// stale, weak trust, broken overlay.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGitRepo(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'test@test');
  runGit('config', 'user.name', 'test');
}

function gitCommit(repoRoot, message) {
  execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', message], { stdio: 'ignore' });
}

describe('graph_health — synthesis of graph state signals', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-health-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('reports missing trust when no graph exists', async () => {
    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(false);
    expect(result.trust).toBe('missing');
    expect(result.summary).toMatch(/No graph/);
  });

  it('reports strong trust on a clean graph', async () => {
    // Create a minimal graph
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(true);
    expect(result.trust).toBe('strong');
    expect(result.manifestStatus).toBe('ok');
    expect(result.unresolvedEdges).toBe(0);
    expect(result.summary).toMatch(/trust=strong/);
  });

  it('reports weak trust when unresolved > 2000', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 5227,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.trust).toBe('weak');
    expect(result.unresolvedEdges).toBe(5227);
    expect(result.summary).toMatch(/trust=weak \(5227 unresolved\)/);
  });

  it('uses trustDirtyEdgeCount so unresolved CONTAINS noise does not force weak trust', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 100, edges: 200, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 5227, trustDirtyEdgeCount: 600,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.trust).toBe('ok');
    expect(result.unresolvedEdges).toBe(5227);
    expect(result.trustUnresolvedEdges).toBe(600);
    expect(result.summary).toMatch(/trust=ok \(600 trust-relevant unresolved, 5227 total\)/);
  });

  it('reports broken overlay state when functionality.json has broken anchors', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 0, edges: 0, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'broken-feature',
        anchors: { symbols: ['ThisDoesNotExist'], files: ['nope/nonexistent.ts'] },
      }],
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.overlay.present).toBe(true);
    expect(result.overlay.broken).toBe(1);
    expect(result.overlay.sample[0].id).toBe('broken-feature');
    expect(result.summary).toMatch(/overlay=broken 1\/1/);
  });

  it('summary is one line across all axes', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 10, edges: 20, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 100,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.summary.split('\n').length).toBe(1);
    expect(result.summary).toContain('·');
    expect(result.summary).toMatch(/nodes=/);
    expect(result.summary).toMatch(/trust=/);
    expect(result.summary).toMatch(/fresh|stale/);
    expect(result.summary).toMatch(/overlay=/);
  });

  it('surfaces incomplete rebuild state from manifest.status', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: new Date().toISOString(),
      nodes: 10, edges: 20, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'indexing', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.manifestStatus).toBe('indexing');
    expect(result.summary).toContain('rebuild-incomplete: status=indexing');
  });

  it('flags stale unresolved categorization separately from stale briefs', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: '2026-04-23T00:00:00.000Z',
      nodes: 10, edges: 20, schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), JSON.stringify({
      graph_indexed_at: '2026-04-23T00:00:00.000Z',
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'unresolved-categorization.json'), JSON.stringify({
      graph_indexed_at: '2026-04-22T00:00:00.000Z',
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.briefStaleVsManifest).toBe(false);
    expect(result.unresolvedCategorizationStaleVsManifest).toBe(true);
    expect(result.summary).toContain('categorization-stale: regenerate via graph_index()');
  });

  it('surfaces overlay quality and dirty seams when the working tree intersects mapped features', async () => {
    initGitRepo(repoRoot);
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'auth.js'), 'export function login() { return true; }\n');
    gitCommit(repoRoot, 'init');

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      indexedAt: new Date().toISOString(),
      nodes: 1,
      edges: 0,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 0,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'auth',
        label: 'Auth',
        anchors: { files: ['src/auth.js'], docs: ['docs/auth.md'] },
        tests: ['tests/test_main.cpp'],
        depends_on: ['core'],
        related_to: ['session'],
      }],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      tasks: [
        { id: 'T-1', title: 'linked', status: 'open', features: ['auth'] },
        { id: 'T-2', title: 'loose', status: 'open', features: [] },
      ],
    }));
    await writeFile(join(repoRoot, 'src', 'auth.js'), 'export function login() { return false; }\n');

    const result = await graphHealth({ repoRoot });
    expect(result.overlayQuality).toMatchObject({
      featureCount: 1,
      featuresWithTests: 1,
      featuresWithDocs: 1,
      featuresWithDependsOn: 1,
      featuresWithRelatedTo: 1,
      tasksTotal: 2,
      linkedTasks: 1,
      unlinkedTasks: 1,
    });
    expect(result.dirtySeams.features[0]).toMatchObject({
      id: 'auth',
      file_count: 1,
    });
    expect(result.summary).toContain('dirty-seams: auth(1)');
    expect(result.summary).toContain('tasks 1/2');
  });
});
