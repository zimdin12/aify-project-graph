import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { startDashboard } from '../../dashboard/server.js';
import { inspectReadFreshness } from './read_freshness.js';

// Keyed by repoRoot so calling graph_dashboard from different repos in the
// same process doesn't silently return the URL of the first repo's server
// (the previous single-slot state caused exactly that — dev audit 11b90fb).
const activeDashboards = new Map();

export async function graphDashboard({ repoRoot, port }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_dashboard' });
  if (freshness.blocker) return freshness.blocker;

  const existing = activeDashboards.get(repoRoot);
  if (existing) {
    return {
      url: existing.url,
      port: existing.port,
      status: 'already_running',
    };
  }

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // ★ repoRoot MUST be passed. startDashboard defaults it to process.cwd(), which
    // is the MCP server's launch directory — NOT the repo being inspected. Without
    // it the overlay layer (features/tasks/cross-layer edges) loads a different
    // repo's .aify-graph, and /api/source resolves file paths against the wrong
    // tree, so the inline source viewer returns read_failed for every node.
    // Invisible on a single-repo setup where cwd happens to match; wrong the moment
    // one server serves a second repo.
    const result = await startDashboard({ db, port: port || 0, repoRoot });

    activeDashboards.set(repoRoot, { ...result, db });

    return {
      url: result.url,
      port: result.port,
      status: 'running',
      warnings: freshness.warnings,
    };
  } catch (err) {
    // ⚠ THE CLEANUP MUST NOT REPLACE THE CAUSE. dev: `startDashboard` throwing
    // "listen failed" followed by `db.close()` throwing delivered only "db close failed" —
    // the caller was told about the janitor instead of the fire.
    try { db.close(); } catch { /* the startup failure below is the one that matters */ }
    throw err;
  }
}

// ⛔ NOTHING COULD EVER RELEASE THESE, and a green test run proved it.
//
// graph-senior-dev-hermes, auditing the dashboard tests: every repetition left an
// `apg-dashroot-*` directory behind on Windows because the SQLite handle stayed open
// until worker disposal — 72 stale fixture directories accumulated across their probe
// runs. The runs were GREEN throughout. On Linux the open handle is invisible because a
// file can be unlinked while held, so the symptom hides and the leak does not.
//
// ★ The registry was write-only: entries went in and nothing took them out. That is a
// production gap as much as a test one — a long-lived server that dashboards several
// repos holds a handle per repo forever, and there was no shutdown path at all.
//
// ⇒ A response assertion is not cleanup evidence. Tests snapshot this registry before
// and after, on BOTH the succeeding and the failing path.
// ⚠ ONE SHARED IN-FLIGHT SHUTDOWN. dev: concurrent calls were not joinable — the first
// cleared the registry before any close completed, so a second caller got 0 back while
// live cleanup was still running and could believe teardown had finished. The registry is
// now cleared only AFTER the work completes, and a second caller joins the first.
let shutdownInFlight = null;

export function stopAllDashboards() {
  if (shutdownInFlight) return shutdownInFlight;
  shutdownInFlight = doStopAllDashboards().finally(() => { shutdownInFlight = null; });
  return shutdownInFlight;
}

// ⚠ A GLOBAL DEADLINE, not a per-entry one. The first version raced each entry against 2s
// SERIALLY, so N stuck dashboards meant ~N×2s — on a host exit that is indistinguishable
// from the hang this exists to prevent. One budget for the whole teardown.
const SHUTDOWN_BUDGET_MS = 2000;

async function doStopAllDashboards() {
  const entries = [...activeDashboards.values()];
  const deadline = Date.now() + SHUTDOWN_BUDGET_MS;
  for (const entry of entries) {
    // Close the server first so no request can arrive against a closed database.
    //
    // ⚠ BOUNDED, and caught immediately: the first version deadlocked the whole suite
    // against a stub whose close() ignored its callback. Trading a leak for a hang on the
    // exit path is the worse trade.
    //
    // ⚠ BOTH CLOSE FORMS. node's http close(cb) calls back; some servers RETURN a promise
    // and never invoke the callback. dev measured a promise settling in ~20ms while
    // shutdown still waited the full ~2s callback timeout — so the returned value is
    // assimilated too, and whichever completes first wins.
    if (entry.server) {
      const closed = new Promise((resolve) => {
        try {
          const maybe = entry.server.close(resolve);
          if (maybe && typeof maybe.then === 'function') maybe.then(resolve, resolve);
        } catch {
          resolve(); // a synchronous throw must not skip the DB close below
        }
      });
      const remaining = Math.max(0, deadline - Date.now());
      await Promise.race([closed, new Promise((r) => { setTimeout(r, remaining).unref?.(); })]);
    }
    // Always reached, even if the server refused to close — this is what frees the handle.
    try { entry.db?.close(); } catch { /* already closed */ }
  }
  activeDashboards.clear();
  return entries.length;
}

// Read-only view, so a test can assert the registry is empty without reaching into
// module state or depending on the shape of what is stored.
export function activeDashboardCount() {
  return activeDashboards.size;
}
