// scripts/reindex.mjs — incremental reindex entry for the post-commit hook.
// Usage: node scripts/reindex.mjs <repoRoot>. Best-effort: never throws out
// (a reindex failure must never fail a git commit).
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';

const repoRoot = process.argv[2] || process.cwd();
ensureFresh({ repoRoot }).then(
  (r) => { console.log(`[aify-project-graph] reindexed ${repoRoot}: ${r?.nodes ?? '?'} nodes`); },
  (e) => { console.error(`[aify-project-graph] reindex failed: ${e?.message ?? e}`); process.exit(0); },
);
