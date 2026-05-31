// Cohesion review R2 — graph_neighbors ALL_RELATIONS now flows through the
// taxonomy registry (NEIGHBOR_FAMILY), so the NEW edge types are visible via
// the general neighborhood verb:
//   OVERRIDDEN_BY, LOADS_SHADER, DECLARES_BINDING, HAS_DIAGNOSTIC.
// Before the fix the local allowlist omitted them and the SQL never saw them,
// even though it handles arbitrary relations — the allowlist was the only block.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

describe('graph_neighbors exposes the new edge types via the registry', () => {
  let repoRoot;
  let graphDir;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-neighbors-new-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    const node = (id, type, label, file, lang = 'cpp') => ({
      id, type, label, file_path: file, start_line: 10, end_line: 12,
      language: lang, confidence: 1, structural_fp: '', dependency_fp: '',
      extra: { qname: `${label}` },
    });

    // base virtual --OVERRIDDEN_BY--> override
    upsertNode(db, node('base.grav', 'Method', 'gravityDirection', 'sim/ISimDomain.h'));
    upsertNode(db, node('impl.grav', 'Method', 'gravityDirectionImpl', 'sim/WorldBufferDomain.cpp'));
    upsertEdge(db, {
      from_id: 'base.grav', to_id: 'impl.grav', relation: 'OVERRIDDEN_BY',
      source_file: '', source_line: 0, confidence: 0.7,
      provenance: 'INFERRED', extractor: 'virtual-overrides',
    });

    // shader File --DECLARES_BINDING--> ShaderBinding, and cpp File --LOADS_SHADER--> shader File
    upsertNode(db, node('shaderfile', 'File', 'cas.comp.glsl', 'shaders/cas.comp.glsl', 'glsl'));
    upsertNode(db, node('binding0', 'ShaderBinding', 'binding 0.0 VoxelBuffer', 'shaders/cas.comp.glsl', 'glsl'));
    upsertNode(db, node('cppfile', 'File', 'loader.cpp', 'src/loader.cpp'));
    upsertEdge(db, {
      from_id: 'shaderfile', to_id: 'binding0', relation: 'DECLARES_BINDING',
      source_file: 'shaders/cas.comp.glsl', source_line: 1, confidence: 1,
      provenance: 'EXTRACTED', extractor: 'shader-bindings',
    });
    upsertEdge(db, {
      from_id: 'cppfile', to_id: 'shaderfile', relation: 'LOADS_SHADER',
      source_file: 'src/loader.cpp', source_line: 5, confidence: 1,
      provenance: 'EXTRACTED', extractor: 'shader-bindings',
    });

    // file --HAS_DIAGNOSTIC--> diagnostic symbol
    upsertNode(db, node('diagfile', 'File', 'broken.cpp', 'src/broken.cpp'));
    upsertNode(db, node('diag0', 'Symbol', 'error:E001', 'src/broken.cpp'));
    upsertEdge(db, {
      from_id: 'diagfile', to_id: 'diag0', relation: 'HAS_DIAGNOSTIC',
      source_file: 'src/broken.cpp', source_line: 3, confidence: 1,
      provenance: 'CODE_INTEL', extractor: 'code-intel',
    });

    await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
      status: 'ok', commit, indexedAt: new Date().toISOString(),
      nodes: 7, edges: 4,
      schemaVersion: SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      parserBundleVersion: PARSER_BUNDLE_VERSION,
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    try { db.close(); } catch {}
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('OVERRIDDEN_BY is now a valid edge_type and returns the override edge', async () => {
    const out = await graphNeighbors({ repoRoot, symbol: 'gravityDirection', edge_types: ['OVERRIDDEN_BY'] });
    expect(out).toContain('OVERRIDDEN_BY');
    // the override-target node (impl.grav) is reachable through the edge
    expect(out).toContain('impl.grav');
    expect(out).not.toContain('none of the requested edge_types are valid');
  });

  it('DECLARES_BINDING is queryable and returns the binding edge', async () => {
    const out = await graphNeighbors({ repoRoot, symbol: 'cas.comp.glsl', edge_types: ['DECLARES_BINDING'] });
    expect(out).toContain('DECLARES_BINDING');
    expect(out).toContain('binding0');
    expect(out).not.toContain('none of the requested edge_types are valid');
  });

  it('LOADS_SHADER is queryable and returns the loader edge', async () => {
    const out = await graphNeighbors({ repoRoot, symbol: 'cas.comp.glsl', edge_types: ['LOADS_SHADER'] });
    expect(out).toContain('LOADS_SHADER');
    expect(out).toContain('cppfile');
    expect(out).not.toContain('none of the requested edge_types are valid');
  });

  it('HAS_DIAGNOSTIC is queryable and returns the diagnostic edge', async () => {
    const out = await graphNeighbors({ repoRoot, symbol: 'broken.cpp', edge_types: ['HAS_DIAGNOSTIC'] });
    expect(out).toContain('HAS_DIAGNOSTIC');
    expect(out).toContain('diag0');
    expect(out).not.toContain('none of the requested edge_types are valid');
  });
});
