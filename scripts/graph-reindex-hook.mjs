#!/usr/bin/env node
// Background reindex + brief regen, invoked from the git post-commit hook.
//
// Runs ensureFresh() (incremental) followed by generateBrief() so the graph
// and briefs stay in sync with HEAD without manual intervention. Stdout is
// redirected to .aify-graph/hook.log by the installer so the commit stays
// clean even on long repos.

import { resolve } from 'node:path';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
import { generateBrief } from '../mcp/stdio/brief/generator.js';

const [, , repoRootArg] = process.argv;
const repoRoot = resolve(repoRootArg || process.cwd());
const startedAt = Date.now();

try {
  const result = await ensureFresh({ repoRoot });
  const reindexMs = Date.now() - startedAt;
  const brief = generateBrief({ repoRoot });
  const totalMs = Date.now() - startedAt;
  console.log(`[${new Date().toISOString()}] post-commit: ${result.nodes}N/${result.edges}E reindexed in ${reindexMs}ms; briefs regenerated in ${totalMs - reindexMs}ms (total ${totalMs}ms)`);
  if (result.dirtyEdgeCount > 0) {
    console.log(`  unresolved=${result.dirtyEdgeCount} (see .aify-graph/dirty-edges.full.json)`);
  }
  process.exit(0);
} catch (err) {
  console.error(`[${new Date().toISOString()}] post-commit FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
