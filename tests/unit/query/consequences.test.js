// graph_consequences — traversal across code / feature / contract / task /
// test / activity layers for "what breaks if I touch X?" planning. Pure
// synthesis verb; no new data. Tests cover: no-match case, symbol match
// surfaces feature + tasks, file match surfaces features anchored to the
// file path, contracts bubble up from feature overlay, risk_flags.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGitRepo(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '--allow-empty', '-m', 'init');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node }
  );
}

describe('graph_consequences — cross-layer traversal', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-cons-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    initGitRepo(repoRoot);
    // Seed manifest + matching commit so ensureFresh is a no-op
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns NO MATCH when target is unknown', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    const result = await graphConsequences({ repoRoot, target: 'ghostSymbol' });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/NO MATCH/);
  });

  it('traverses symbol → feature → contracts + tasks', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'fn1', type: 'Function', label: 'updatePhase', file_path: 'src/sim.js' });
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'sim',
        label: 'Simulation',
        anchors: { symbols: ['updatePhase'] },
        contracts: ['docs/contracts/physics-invariant.md'],
      }],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      version: '0.1', source: 'local',
      tasks: [
        { id: 'T-1', title: 'fix phase bug', status: 'open', features: ['sim'] },
        { id: 'T-2', title: 'closed', status: 'done', features: ['sim'] },
      ],
    }));

    const result = await graphConsequences({ repoRoot, target: 'updatePhase' });
    expect(result.matched.symbols).toHaveLength(1);
    expect(result.matched.symbols[0].label).toBe('updatePhase');
    expect(result.features_touching).toHaveLength(1);
    expect(result.features_touching[0].id).toBe('sim');
    expect(result.contracts_potentially_affected).toContain('docs/contracts/physics-invariant.md');
    // Open task included; closed task excluded
    expect(result.open_tasks_on_those_features.map((t) => t.id)).toEqual(['T-1']);
  });

  it('flags no-adjacent-tests as regression risk', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'fn1', type: 'Function', label: 'helper', file_path: 'src/a.js' });
    db.close();

    const result = await graphConsequences({ repoRoot, target: 'helper' });
    expect(result.risk_flags).toEqual(expect.arrayContaining([expect.stringMatching(/no_test_coverage/i)]));
  });

  it('flags orphan code when no feature anchors the symbol', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'fn1', type: 'Function', label: 'orphanFn', file_path: 'src/x.js' });
    db.close();
    // No functionality.json

    const result = await graphConsequences({ repoRoot, target: 'orphanFn' });
    expect(result.features_touching).toEqual([]);
    expect(result.risk_flags).toEqual(expect.arrayContaining([expect.stringMatching(/orphan_anchor/i)]));
  });

  it('accepts file path as target', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'a.js', file_path: 'src/a.js' });
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{ id: 'core', anchors: { files: ['src/a.js'] } }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'src/a.js' });
    expect(result.features_touching.map((f) => f.id)).toContain('core');
  });

  it('surfaces dirty overlap when the target touches currently modified feature files', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'a.js', file_path: 'src/a.js' });
    db.close();

    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'a.js'), 'console.log("dirty");\n');
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{ id: 'core', anchors: { files: ['src/a.js'] } }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'src/a.js' });
    expect(result.dirty_overlap.direct_files).toContain('src/a.js');
    expect(result.dirty_overlap.affected_features[0]).toMatchObject({ id: 'core', file_count: 1 });
    expect(result.risk_flags).toEqual(expect.arrayContaining([expect.stringMatching(/dirty_local_seam/i)]));
  });
});
