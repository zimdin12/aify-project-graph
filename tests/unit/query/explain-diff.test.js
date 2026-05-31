// graph_explain_diff — explain an EXISTING diff (P1-4). Reverse of
// graph_consequences: keyed on a git range, not a symbol. Tests build a temp
// git repo with a known diff and assert CHANGED lists the edited symbols,
// AFFECTED lists their cross-file caller, LAYERS spans the architecture
// overlay, RISK is present + labeled heuristic, and the optional
// diff-overlay.json is emitted on overlay=true.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphExplainDiff } from '../../../mcp/stdio/query/verbs/explain_diff.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function git(repoRoot, ...args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function initGitRepo(repoRoot) {
  git(repoRoot, 'init', '-q');
  git(repoRoot, 'config', 'user.email', 'test@test');
  git(repoRoot, 'config', 'user.name', 'test');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'javascript', confidence: 1, extra: '{}', ...node },
  );
}

function insertEdge(db, { from_id, to_id, relation, source_file, provenance = 'EXTRACTED' }) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, extractor, provenance)
     VALUES ($from_id, $to_id, $relation, $source_file, 1, 0.9, 'javascript', $provenance)`,
    { from_id, to_id, relation, source_file, provenance },
  );
}

async function seedManifest(repoRoot, overrides = {}) {
  const commit = git(repoRoot, 'rev-parse', 'HEAD');
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0',
    status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    ...overrides,
  }));
}

describe('graph_explain_diff — explain an existing diff', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-xdiff-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    initGitRepo(repoRoot);
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('reports no changed files for a clean working tree', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
    git(repoRoot, 'commit', '--allow-empty', '-m', 'init');
    await seedManifest(repoRoot);

    const result = await graphExplainDiff({ repoRoot });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/no changed files/i);
  });

  it('CHANGED lists edited symbols; AFFECTED lists a cross-file caller; RISK present', async () => {
    // Commit a baseline so we have a range to diff.
    await writeFile(join(repoRoot, 'src', 'core.js'), 'export function gravity() { return 1; }\n');
    await writeFile(join(repoRoot, 'src', 'caller.js'), "import { gravity } from './core.js';\nexport function step() { return gravity(); }\n");
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'baseline');
    const base = git(repoRoot, 'rev-parse', 'HEAD');

    // Make a change to core.js and commit it — this is the diff we explain.
    await writeFile(join(repoRoot, 'src', 'core.js'), 'export function gravity() { return 2; }\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'tweak gravity');

    // Seed the graph: gravity defined in core.js, step (in caller.js) CALLS it.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'gravity', type: 'Function', label: 'gravity', file_path: 'src/core.js', start_line: 1 });
    insertNode(db, { id: 'step', type: 'Function', label: 'step', file_path: 'src/caller.js', start_line: 2 });
    insertEdge(db, { from_id: 'step', to_id: 'gravity', relation: 'CALLS', source_file: 'src/caller.js' });
    db.close();
    await seedManifest(repoRoot, { nodes: 2, edges: 1 });

    const result = await graphExplainDiff({ repoRoot, range: `${base}..HEAD` });
    expect(typeof result).toBe('object');

    // CHANGED — gravity defined in the changed file.
    expect(result.changed.file_count).toBe(1);
    expect(result.changed.files_with_symbols['src/core.js']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^gravity /)]),
    );

    // AFFECTED — step() in caller.js (NOT a changed file) calls gravity.
    expect(result.affected_1hop.symbol_count).toBe(1);
    const affectedFiles = result.affected_1hop.by_file.map((g) => g.file);
    expect(affectedFiles).toContain('src/caller.js');

    // RISK — present, labeled heuristic, with a fan_out flag.
    expect(result.risk.heuristic).toBe(true);
    expect(result.risk).toHaveProperty('score');
    expect(result.risk.flags).toEqual(expect.arrayContaining([expect.stringMatching(/fan_out/)]));

    // Trust banner present (heuristic since no LSP_VERIFIED edges).
    expect(result.trust).toMatch(/heuristic/i);
  });

  it('excludes intra-diff edges from AFFECTED (a caller inside a changed file is not "affected")', async () => {
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function foo() {}\nexport function bar() { return foo(); }\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'baseline');
    const base = git(repoRoot, 'rev-parse', 'HEAD');
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function foo() { return 9; }\nexport function bar() { return foo(); }\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'edit');

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'foo', type: 'Function', label: 'foo', file_path: 'src/a.js', start_line: 1 });
    insertNode(db, { id: 'bar', type: 'Function', label: 'bar', file_path: 'src/a.js', start_line: 2 });
    insertEdge(db, { from_id: 'bar', to_id: 'foo', relation: 'CALLS', source_file: 'src/a.js' });
    db.close();
    await seedManifest(repoRoot, { nodes: 2, edges: 1 });

    const result = await graphExplainDiff({ repoRoot, range: `${base}..HEAD` });
    // bar calls foo but lives in the SAME changed file → not counted as affected.
    expect(result.affected_1hop.symbol_count).toBe(0);
  });

  it('LAYERS spans the architecture overlay and flags cross_layer risk', async () => {
    // Real on-disk files (semantic validator checks existence).
    await writeFile(join(repoRoot, 'src', 'render.js'), 'export function draw() {}\n');
    await mkdir(join(repoRoot, 'sim'), { recursive: true });
    await writeFile(join(repoRoot, 'sim', 'phys.js'), 'export function tick() {}\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'baseline');
    const base = git(repoRoot, 'rev-parse', 'HEAD');
    await writeFile(join(repoRoot, 'src', 'render.js'), 'export function draw() { return 1; }\n');
    await writeFile(join(repoRoot, 'sim', 'phys.js'), 'export function tick() { return 1; }\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'cross-layer edit');

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'draw', type: 'Function', label: 'draw', file_path: 'src/render.js', start_line: 1 });
    insertNode(db, { id: 'tick', type: 'Function', label: 'tick', file_path: 'sim/phys.js', start_line: 1 });
    db.close();
    await seedManifest(repoRoot, { nodes: 2, edges: 0 });

    // Valid intelligence overlay pair (envelope fields the validators require).
    const env = {
      schema_version: '0.1',
      generatorVersion: 'test-1',
      generatedAt: new Date().toISOString(),
      graphHead: 'deadbeef',
      inputSha: `sha256:${'a'.repeat(64)}`,
    };
    await writeFile(join(repoRoot, '.aify-graph', 'semantic.files.json'), JSON.stringify({
      ...env,
      files: [
        { path: 'src/render.js', summary: 'rendering', tags: ['render'], complexity: 'low', nodeType: 'service', entryPoint: false },
        { path: 'sim/phys.js', summary: 'physics', tags: ['sim'], complexity: 'low', nodeType: 'service', entryPoint: false },
      ],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'architecture.json'), JSON.stringify({
      ...env,
      layers: [
        { id: 'rendering', name: 'Rendering', description: 'gpu + draw', color: '#112233' },
        { id: 'simulation', name: 'Simulation', description: 'physics + sim', color: '#445566' },
        { id: 'core', name: 'Core', description: 'shared core', color: '#778899' },
      ],
      assignments: {
        'src/render.js': { layerId: 'rendering', confidence: 'high' },
        'sim/phys.js': { layerId: 'simulation', confidence: 'high' },
      },
    }));

    const result = await graphExplainDiff({ repoRoot, range: `${base}..HEAD` });
    expect(result.layers.available).toBe(true);
    expect(result.layers.spans).toBe(2);
    expect(result.layers.layers.map((l) => l.id).sort()).toEqual(['rendering', 'simulation']);
    expect(result.risk.flags).toEqual(expect.arrayContaining([expect.stringMatching(/cross_layer/)]));
  });

  it('writes diff-overlay.json when overlay=true', async () => {
    await writeFile(join(repoRoot, 'src', 'm.js'), 'export function m() {}\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'baseline');
    const base = git(repoRoot, 'rev-parse', 'HEAD');
    await writeFile(join(repoRoot, 'src', 'm.js'), 'export function m() { return 1; }\n');
    git(repoRoot, 'add', '-A');
    git(repoRoot, 'commit', '-q', '-m', 'edit');

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'm', type: 'Function', label: 'm', file_path: 'src/m.js', start_line: 1 });
    db.close();
    await seedManifest(repoRoot, { nodes: 1, edges: 0 });

    const result = await graphExplainDiff({ repoRoot, range: `${base}..HEAD`, overlay: true });
    expect(result.overlay_written).toBe('.aify-graph/diff-overlay.json');
    const overlayPath = join(repoRoot, '.aify-graph', 'diff-overlay.json');
    expect(existsSync(overlayPath)).toBe(true);
    const parsed = JSON.parse(await readFile(overlayPath, 'utf8'));
    expect(parsed.changedNodeIds).toContain('m');
    expect(Array.isArray(parsed.affectedNodeIds)).toBe(true);
  });

  it('accepts an explicit files[] list overriding range resolution', async () => {
    git(repoRoot, 'commit', '--allow-empty', '-m', 'init');
    await seedManifest(repoRoot);
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'z', type: 'Function', label: 'zap', file_path: 'src/z.js', start_line: 1 });
    db.close();

    const result = await graphExplainDiff({ repoRoot, files: ['src/z.js'] });
    expect(result.mode).toBe('explicit');
    expect(result.changed.files_with_symbols['src/z.js']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^zap /)]),
    );
  });
});
