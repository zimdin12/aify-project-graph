import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphChangePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGitRepo(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('config', 'user.email', 'test@test');
  runGit('config', 'user.name', 'test');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node }
  );
}

describe('graph_change_plan — weak-trust source-occurrence fallback', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-change-plan-occ-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await mkdir(join(repoRoot, 'tests'), { recursive: true });
    initGitRepo(repoRoot);

    await writeFile(join(repoRoot, 'src', 'orchestrator.js'), 'export function ensureFresh() { return true; }\n');
    await writeFile(join(repoRoot, 'src', 'index.js'), "import { ensureFresh } from './orchestrator.js';\nensureFresh();\n");
    await writeFile(join(repoRoot, 'src', 'search.js'), "import { ensureFresh } from './orchestrator.js';\nexport const search = ensureFresh;\n");
    await writeFile(join(repoRoot, 'tests', 'freshness.test.js'), "import { ensureFresh } from '../src/orchestrator.js';\n");
    execFileSync('git', ['-C', repoRoot, 'add', '.'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, 'commit', '-qm', 'init'], { stdio: 'ignore' });
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'fn1', type: 'Function', label: 'ensureFresh', file_path: 'src/orchestrator.js', start_line: 1 });
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
      dirtyEdgeCount: 1800,
      trustDirtyEdgeCount: 1800,
    }));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('does not report SAFE when caller edges are sparse but source occurrences are broad under weak trust', async () => {
    const out = await graphChangePlan({ repoRoot, symbol: 'ensureFresh', top_k: 6 });

    expect(out).toContain('SOURCE OCCURRENCE FILES');
    expect(out).toContain('source-occurrence file(s)');
    expect(out).not.toContain('RISK SAFE');
    expect(out).toMatch(/RISK (REVIEW|CONFIRM)/);
    expect(out).toContain('weak trust may understate caller scope');
  });
});
