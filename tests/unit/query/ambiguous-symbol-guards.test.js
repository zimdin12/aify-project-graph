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
