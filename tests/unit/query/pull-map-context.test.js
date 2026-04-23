import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGitRepo(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'test@test');
  runGit('config', 'user.name', 'test');
}

describe('graph_pull — map context signals', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-pull-map-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    initGitRepo(repoRoot);
    await writeFile(join(repoRoot, 'src', 'auth.js'), 'export const auth = true;\n');
    execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'init'], { stdio: 'ignore' });

    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ('file1', 'File', 'auth.js', 'src/auth.js', 1, 1, 'javascript', 1.0, '{}')`,
    );
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'auth',
        label: 'Auth',
        anchors: { files: ['src/auth.js'], docs: ['docs/auth.md'] },
        tests: ['tests/test_main.cpp'],
        depends_on: ['core'],
      }],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      tasks: [
        { id: 'T-1', title: 'linked', status: 'open', features: ['auth'], evidence: 'path:src/auth.js' },
        { id: 'T-2', title: 'loose', status: 'open', features: [] },
      ],
    }));
    await writeFile(join(repoRoot, 'src', 'auth.js'), 'export const auth = false;\n');
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns overlay_quality and dirty_overlap for file targets', async () => {
    const raw = await graphPull({ repoRoot, node: 'src/auth.js' });
    const result = JSON.parse(raw);

    expect(result.overlay_quality).toMatchObject({
      featureCount: 1,
      featuresWithTests: 1,
      featuresWithDocs: 1,
      featuresWithDependsOn: 1,
      tasksTotal: 2,
      linkedTasks: 1,
      strongTaskLinks: 1,
      mixedTaskLinks: 0,
      broadTaskLinks: 0,
      unlinkedTasks: 1,
    });
    expect(result.dirty_overlap.direct_files).toContain('src/auth.js');
    expect(result.dirty_overlap.affected_features[0]).toMatchObject({
      id: 'auth',
      file_count: 1,
    });
    expect(result._warnings).toEqual(expect.arrayContaining([expect.stringMatching(/working tree has 1 dirty file/i)]));
  });
});
