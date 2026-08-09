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
import { join, resolve } from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
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
    // mkdir first: appendFileSync does not create parent directories.
    //
    // DEFENSIVE, NOT CORRECTIVE — and the distinction is worth recording. Task 1b's
    // implementer flagged that a failure before `.aify-graph/` exists would lose the
    // FAILED line to this function's own catch. Sound reasoning, but measured: it is
    // unreachable today. ensureFresh() creates `.aify-graph/` before anything that
    // can throw, including on a repoRoot that does not exist at all — both cases were
    // run with and without this line, and the log was written every time.
    //
    // Kept because log() should not depend on ensureFresh's internal ordering, which
    // is free to change. Not kept because it fixes a live bug; it does not.
    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
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
