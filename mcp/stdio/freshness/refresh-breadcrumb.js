// WHAT HAPPENED THE LAST TIME SOMETHING TRIED TO REFRESH THIS GRAPH.
//
// The git hooks run backgrounded with `>/dev/null 2>&1` — they must never fail
// a git operation, so they cannot report through the exit code, and their output
// goes nowhere. Without a breadcrumb, a refresh mechanism that has silently
// stopped working is indistinguishable from one that is working, and its mere
// presence becomes the reason nobody checks.
//
// Deliberately a plain file, not a table in graph.sqlite: it must be writable by
// a hook that runs while an MCP server holds the DB, and readable when the DB is
// mid-rebuild.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const BREADCRUMB_FILE = 'last-refresh.json';
const MAX_ERROR_CHARS = 500;

function breadcrumbPath(repoRoot) {
  return join(repoRoot, '.aify-graph', BREADCRUMB_FILE);
}

/** Best-effort: a breadcrumb failure must never be louder than the thing it records. */
export function writeRefreshBreadcrumb(repoRoot, entry) {
  try {
    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
    const body = {
      at: new Date().toISOString(),
      trigger: entry.trigger ?? null,
      from: entry.from ?? null,
      to: entry.to ?? null,
      status: entry.status === 'failed' ? 'failed' : 'ok',
      ...(entry.error ? { error: String(entry.error).slice(0, MAX_ERROR_CHARS) } : {}),
    };
    writeFileSync(breadcrumbPath(repoRoot), JSON.stringify(body, null, 2) + '\n', 'utf8');
  } catch { /* a hook must never fail a git operation */ }
}

/** null when absent OR unparseable — a corrupt breadcrumb is treated as no breadcrumb. */
export function readRefreshBreadcrumb(repoRoot) {
  try {
    const parsed = JSON.parse(readFileSync(breadcrumbPath(repoRoot), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
