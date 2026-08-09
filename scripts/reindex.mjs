// scripts/reindex.mjs — the single payload for the aify git refresh hooks.
// Usage: node scripts/reindex.mjs <repoRoot> [trigger]
//
// Refreshes EVERYTHING a reader depends on, not just the graph. The session-start
// skill tells agents to read .aify-graph/brief.agent.md first, and graph_health
// tracks brief + categorization staleness separately from graph staleness — so a
// payload that reindexed the graph alone would leave a fresh graph behind a stale
// brief while reporting success.
//
// Best-effort: always exits 0. A reindex failure must never fail a git operation.
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
import { writeUnresolvedCategorization } from '../mcp/stdio/freshness/unresolved-categorization.js';
import { generateBrief } from '../mcp/stdio/brief/generator.js';

const repoRoot = resolve(process.argv[2] || process.cwd());
const trigger = process.argv[3] || 'manual';

// Appended history, complementary to the breadcrumb Task 2 adds: the breadcrumb
// answers "what happened last time", the log answers "has this been failing for
// a week". Inherited from the installer this task supersedes, which had it right.
function log(line) {
  try {
    appendFileSync(join(repoRoot, '.aify-graph', 'hook.log'),
      `[${new Date().toISOString()}] ${trigger}: ${line}\n`, 'utf8');
  } catch { /* logging must never be louder than the thing it records */ }
}

try {
  const started = Date.now();
  const result = await ensureFresh({ repoRoot });
  const reindexMs = Date.now() - started;
  generateBrief({ repoRoot });
  const categorization = await writeUnresolvedCategorization({ repoRoot });
  const totalMs = Date.now() - started;
  log(`${result?.nodes ?? '?'}N/${result?.edges ?? '?'}E in ${reindexMs}ms; `
    + `briefs+categorization in ${totalMs - reindexMs}ms (total ${totalMs}ms); `
    + `categorization=${categorization?.total ?? '?'}`);
  process.exit(0);
} catch (err) {
  log(`FAILED: ${err?.message ?? err}`);
  console.error(`[aify-project-graph] reindex failed: ${err?.message ?? err}`);
  process.exit(0);
}
