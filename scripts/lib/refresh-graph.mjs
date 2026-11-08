// The one refresh sequence: the graph, then everything a reader depends on that is derived from it.
//
// The session-start skill tells agents to read .aify-graph/brief.agent.md first, and graph_health tracks brief and
// categorization staleness separately from the graph's, so a refresh that rebuilt the graph alone would leave a fresh
// graph behind a stale brief while reporting success. Two callers: scripts/reindex.mjs (the git-hook payload, which
// must never fail a git operation) and `apg index` (a step someone runs on purpose, which must fail loudly). They
// differ in what they do with a failure, never in what a refresh is.
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';
import { writeUnresolvedCategorization } from '../../mcp/stdio/freshness/unresolved-categorization.js';
import { generateBrief } from '../../mcp/stdio/brief/generator.js';

/** @returns {Promise<{ result, categorization, reindexMs: number, totalMs: number }>} throws on any failure */
export async function refreshGraph(repoRoot) {
  const started = Date.now();
  const result = await ensureFresh({ repoRoot });
  const reindexMs = Date.now() - started;
  generateBrief({ repoRoot });
  const categorization = await writeUnresolvedCategorization({ repoRoot });
  return { result, categorization, reindexMs, totalMs: Date.now() - started };
}
