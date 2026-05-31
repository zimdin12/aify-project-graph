// P0-5 — virtual-override OVERRIDDEN_BY edges surface in graph_impact and
// graph_callees, clearly marked INFERRED, cross-referencing the clangd verb.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

describe('virtual-override edges surface in impact/callees (INFERRED)', () => {
  let repoRoot;
  let graphDir;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-vover-verb-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    // ISimDomain::gravityDirection (base virtual) overridden by
    // WorldBufferDomain::gravityDirection (the echoes shape, in miniature).
    const method = (id, owner, label, file) => ({
      id, type: 'Method', label,
      file_path: file, start_line: 10, end_line: 12, language: 'cpp',
      confidence: 1, structural_fp: '', dependency_fp: '',
      extra: { qname: `${owner}::${label}`, signature: 'glm::vec3 gravityDirection() const', parent_class: owner },
    });

    upsertNode(db, method('base.grav', 'ISimDomain', 'gravityDirection', 'engine/voxel/sim/ISimDomain.h'));
    upsertNode(db, method('impl.grav', 'WorldBufferDomain', 'gravityDirection', 'engine/voxel/sim/WorldBufferDomain.cpp'));

    // The synthesized OVERRIDDEN_BY edge: base virtual -> override, INFERRED.
    upsertEdge(db, {
      from_id: 'base.grav', to_id: 'impl.grav', relation: 'OVERRIDDEN_BY',
      source_file: '', source_line: 0, confidence: 0.7,
      provenance: 'INFERRED', extractor: 'virtual-overrides',
    });

    await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
      status: 'ok', commit, indexedAt: new Date().toISOString(),
      nodes: 2, edges: 1,
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

  it('graph_impact on the base virtual surfaces the override, marked INFERRED', async () => {
    const out = await graphImpact({ repoRoot, symbol: 'gravityDirection', depth: 2, top_k: 20 });
    // The override implementation appears...
    expect(out).toContain('WorldBufferDomain');
    expect(out).toContain('OVERRIDDEN_BY');
    // ...marked INFERRED (renderProvenanceTag shows prov=INFERRED), never lsp.
    expect(out).toContain('INFERRED');
    expect(out).not.toContain('[lsp✓]');
    // ...with the clangd-verified cross-reference.
    expect(out).toContain('code_intel_hierarchy');
    expect(out).toContain('subtypes');
  });

  it('graph_callees on the base virtual follows the override (INFERRED)', async () => {
    const out = await graphCallees({ repoRoot, symbol: 'gravityDirection', depth: 1, top_k: 20 });
    expect(out).toContain('OVERRIDDEN_BY');
    expect(out).toContain('INFERRED');
    expect(out).not.toContain('[lsp✓]');
    expect(out).toContain('code_intel_hierarchy');
  });
});
