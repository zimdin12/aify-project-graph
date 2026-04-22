import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

describe('graph_callers / graph_callees — recursive chain only', () => {
  let repoRoot;
  let graphDir;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-call-chain-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });

    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();
    const mkNode = (id, file, line) => ({
      id,
      type: 'Function',
      label: id,
      file_path: file,
      start_line: line,
      end_line: line,
      language: 'cpp',
      confidence: 1,
      structural_fp: '',
      dependency_fp: '',
      extra: { qname: id },
    });

    for (const node of [
      mkNode('renderScene', 'src/renderScene.cpp', 1),
      mkNode('renderChunk', 'src/renderChunk.cpp', 10),
      mkNode('LodMeshRenderer', 'src/LodMeshRenderer.cpp', 20),
      mkNode('inspectQueryHelper', 'src/inspectQueryHelper.cpp', 30),
      mkNode('handleQueryInspectCommands', 'src/handleQueryInspectCommands.cpp', 40),
    ]) {
      upsertNode(db, node);
    }

    const edge = (from, to, line) => ({
      from_id: from,
      to_id: to,
      relation: 'CALLS',
      source_file: `src/${from}.cpp`,
      source_line: line,
      confidence: 0.95,
      provenance: 'EXTRACTED',
      extractor: 'test',
    });

    upsertEdge(db, edge('renderChunk', 'LodMeshRenderer', 10));
    upsertEdge(db, edge('renderScene', 'renderChunk', 20));
    upsertEdge(db, edge('renderChunk', 'inspectQueryHelper', 30));
    upsertEdge(db, edge('handleQueryInspectCommands', 'LodMeshRenderer', 40));

    await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
      status: 'ok',
      commit,
      indexedAt: new Date().toISOString(),
      nodes: 5,
      edges: 4,
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

  it('graph_callers(depth>1) only returns edges that stay on the recursive caller chain', async () => {
    const out = await graphCallers({ repoRoot, symbol: 'LodMeshRenderer', depth: 2, top_k: 20 });
    expect(out).toContain('renderChunk');
    expect(out).toContain('renderScene');
    expect(out).not.toContain('inspectQueryHelper');
  });

  it('graph_callees(depth>1) only returns edges that stay on the recursive callee chain', async () => {
    const out = await graphCallees({ repoRoot, symbol: 'renderScene', depth: 2, top_k: 20 });
    expect(out).toContain('renderChunk');
    expect(out).toContain('LodMeshRenderer');
    expect(out).not.toContain('handleQueryInspectCommands');
  });
});
