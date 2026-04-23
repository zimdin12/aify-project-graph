import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphReport } from '../../../mcp/stdio/query/verbs/report.js';
import { graphChangePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';

function initGitRepo(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'test@test');
  runGit('config', 'user.name', 'test');
}

function gitCommit(repoRoot, message) {
  execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', message], { stdio: 'ignore' });
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

describe('read verbs use existing snapshots only', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-read-freshness-'));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('bootstraps a graph on first read when no snapshot exists yet', async () => {
    initGitRepo(repoRoot);
    await writeFile(join(repoRoot, 'README.md'), '# temp\n');
    gitCommit(repoRoot, 'init');
    const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
    expect(existsSync(dbPath)).toBe(false);

    const result = await graphReport({ repoRoot });

    expect(result).toMatch(/REPO /);
    expect(result).toContain('README.md');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('blocks read verbs on incomplete rebuild snapshots without mutating manifest state', async () => {
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123',
      indexedAt: new Date().toISOString(),
      nodes: 0,
      edges: 0,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'indexing',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 0,
    }));

    const result = await graphChangePlan({ repoRoot, symbol: 'foo' });
    const manifestAfter = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));

    expect(result).toMatch(/GRAPH REBUILD INCOMPLETE/);
    expect(manifestAfter.status).toBe('indexing');
  });

  it('surfaces dirty working-tree warnings while reading the last completed snapshot', async () => {
    initGitRepo(repoRoot);
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'app.js'), 'export function foo() { return 1; }\n');
    const commit = gitCommit(repoRoot, 'init');

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ('fn1', 'Function', 'foo', 'src/app.js', 1, 1, 'javascript', 1.0, '{}')`,
    );
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit,
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

    await writeFile(join(repoRoot, 'src', 'app.js'), 'export function foo() { return 2; }\n');

    const result = await graphWhereis({ repoRoot, symbol: 'foo' });

    expect(result).toMatch(/SNAPSHOT WARNINGS/);
    expect(result).toMatch(/working tree has 1 dirty file/);
    expect(result).toMatch(/src\/app\.js:1/);
  });
});
