import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

describe('graph_impact — recursive chain only', () => {
  let repoRoot;
  let graphDir;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-impact-'));
    graphDir = join(repoRoot, '.aify-graph');
    db = openDb(join(graphDir, 'graph.sqlite'));

    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });

    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

    const mkNode = (id, label, type = 'Function', file = `src/${label}.cpp`, line = 1) => ({
      id,
      type,
      label,
      file_path: file,
      start_line: line,
      end_line: line,
      language: 'cpp',
      confidence: 1,
      structural_fp: '',
      dependency_fp: '',
      extra: { qname: label },
    });

    for (const node of [
      mkNode('target', 'LodMeshRenderer'),
      mkNode('caller', 'renderChunk'),
      mkNode('upstream', 'renderScene'),
      mkNode('leak', 'handleQueryInspectCommands'),
      mkNode('other', 'totallyUnrelated'),
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

    // Intended impact chain: upstream -> caller -> target
    upsertEdge(db, edge('caller', 'target', 10));
    upsertEdge(db, edge('upstream', 'caller', 20));

    // Unrelated outgoing edge from the same caller. Old SQL leaked this.
    upsertEdge(db, edge('caller', 'leak', 30));
    upsertEdge(db, edge('other', 'leak', 40));

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
    }));
  });

  afterEach(async () => {
    try { db.close(); } catch {}
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('returns only edges on the recursive impact chain, not every outgoing edge from callers', async () => {
    const out = await graphImpact({ repoRoot, symbol: 'LodMeshRenderer', depth: 3, top_k: 20 });
    expect(out).toContain('renderChunk');
    expect(out).toContain('renderScene');
    expect(out).not.toContain('handleQueryInspectCommands');
    expect(out).not.toContain('totallyUnrelated');
  });
});
