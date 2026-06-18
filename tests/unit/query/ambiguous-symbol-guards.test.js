import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { graphChangePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';
import { graphPath } from '../../../mcp/stdio/query/verbs/path.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { graphPreflight } from '../../../mcp/stdio/query/verbs/preflight.js';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

describe('graph verbs — ambiguous unqualified symbol guard', () => {
  let repoRoot;
  let graphDir;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-ambiguous-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });

    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
    const mkNode = (id, parentClass, filePath, line) => ({
      id,
      type: 'Method',
      label: 'setVoxel',
      file_path: filePath,
      start_line: line,
      end_line: line,
      language: 'cpp',
      confidence: 1,
      structural_fp: '',
      dependency_fp: '',
      extra: { qname: `engine.voxel.${parentClass}.setVoxel`, parent_class: parentClass },
    });

    upsertNode(db, mkNode('chunk-setVoxel', 'ChunkManager', 'engine/voxel/ChunkManager.cpp', 474));
    upsertNode(db, mkNode('generator-setVoxel', 'StructureGenerator', 'engine/voxel/StructureGenerator.cpp', 151));

    await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
      status: 'ok',
      commit,
      indexedAt: new Date().toISOString(),
      nodes: 2,
      edges: 0,
      schemaVersion: SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      parserBundleVersion: PARSER_BUNDLE_VERSION,
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 0,
      trustDirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    try { db.close(); } catch {}
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('returns AMBIGUOUS MATCH across planning and traversal verbs instead of picking one arbitrarily', async () => {
    const outputs = await Promise.all([
      graphChangePlan({ repoRoot, symbol: 'setVoxel' }),
      graphPath({ repoRoot, symbol: 'setVoxel' }),
      graphImpact({ repoRoot, symbol: 'setVoxel' }),
      graphCallers({ repoRoot, symbol: 'setVoxel' }),
      graphCallees({ repoRoot, symbol: 'setVoxel' }),
      graphNeighbors({ repoRoot, symbol: 'setVoxel' }),
      graphPreflight({ repoRoot, symbol: 'setVoxel' }),
      graphConsequences({ repoRoot, target: 'setVoxel' }),
    ]);

    for (const out of outputs) {
      expect(out).toContain('AMBIGUOUS MATCH for "setVoxel"');
      expect(out).toContain('ChunkManager::setVoxel');
      expect(out).toContain('StructureGenerator::setVoxel');
    }
  });
});

describe('graph verbs — qualified symbol that STILL resolves to multiple definitions', () => {
  // C6 (overstated blast radius): `ChunkManager::setVoxel` exists in TWO
  // namespaces (alpha + beta). resolveSymbol's qname-suffix match returns BOTH,
  // and the old ambiguity guard skipped every qualified symbol — so graph_impact
  // silently UNIONED both callers (overstated blast radius) and the trust banner
  // reported the inflated set. The class qualifier didn't actually disambiguate,
  // so the verbs must surface AMBIGUOUS MATCH, not pick/union arbitrarily.
  let repoRoot; let graphDir; let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-qualified-ambiguous-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    const mkMethod = (id, ns, filePath, line) => ({
      id, type: 'Method', label: 'setVoxel', file_path: filePath,
      start_line: line, end_line: line, language: 'cpp', confidence: 1,
      structural_fp: '', dependency_fp: '',
      extra: { qname: `engine.${ns}.ChunkManager.setVoxel`, parent_class: 'ChunkManager' },
    });
    const mkCaller = (id, label, filePath, line) => ({
      id, type: 'Function', label, file_path: filePath,
      start_line: line, end_line: line, language: 'cpp', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    // Two DISTINCT ChunkManager::setVoxel definitions, each with its own caller.
    upsertNode(db, mkMethod('alpha-setVoxel', 'alpha', 'engine/alpha/ChunkManager.cpp', 474));
    upsertNode(db, mkMethod('beta-setVoxel', 'beta', 'engine/beta/ChunkManager.cpp', 151));
    upsertNode(db, mkCaller('alpha-caller', 'placeAlpha', 'engine/alpha/use.cpp', 10));
    upsertNode(db, mkCaller('beta-caller', 'placeBeta', 'engine/beta/use.cpp', 20));
    upsertEdge(db, { from_id: 'alpha-caller', to_id: 'alpha-setVoxel', relation: 'CALLS' });
    upsertEdge(db, { from_id: 'beta-caller', to_id: 'beta-setVoxel', relation: 'CALLS' });

    await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
      status: 'ok', commit, indexedAt: new Date().toISOString(),
      nodes: 4, edges: 2, schemaVersion: SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION, parserBundleVersion: PARSER_BUNDLE_VERSION,
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0, trustDirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    try { db.close(); } catch {}
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('graph_impact flags the qualified ambiguity instead of unioning both callers (no overstated blast radius)', async () => {
    const out = await graphImpact({ repoRoot, symbol: 'ChunkManager::setVoxel' });
    expect(out).toContain('AMBIGUOUS MATCH for "ChunkManager::setVoxel"');
    // Both distinct definitions are surfaced so the agent can narrow.
    expect(out).toContain('engine/alpha/ChunkManager.cpp');
    expect(out).toContain('engine/beta/ChunkManager.cpp');
    // It must NOT have silently unioned both blast radii.
    expect(out).not.toContain('placeAlpha');
    expect(out).not.toContain('placeBeta');
  });

  it('siblings (callers/neighbors/path/consequences) also refuse to union distinct qualified defs', async () => {
    const outputs = await Promise.all([
      graphCallers({ repoRoot, symbol: 'ChunkManager::setVoxel' }),
      graphNeighbors({ repoRoot, symbol: 'ChunkManager::setVoxel' }),
      graphConsequences({ repoRoot, target: 'ChunkManager::setVoxel' }),
    ]);
    for (const out of outputs) expect(out).toContain('AMBIGUOUS MATCH');
  });

  it('a MORE-qualified symbol disambiguates to one definition (recovery path, not ambiguous)', async () => {
    const out = await graphImpact({ repoRoot, symbol: 'alpha::ChunkManager::setVoxel' });
    expect(out).not.toContain('AMBIGUOUS MATCH');
    // Resolves to the alpha definition; its caller is in the blast radius.
    expect(out).toContain('placeAlpha');
    expect(out).not.toContain('placeBeta');
  });
});
