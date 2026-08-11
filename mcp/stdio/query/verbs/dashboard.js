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
    db.close();
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
export async function stopAllDashboards() {
  const entries = [...activeDashboards.values()];
  activeDashboards.clear();
  for (const entry of entries) {
    // Close the server first so no request can arrive against a closed database.
    //
    // ⚠ BOUNDED. `close(cb)` is only obliged to call back once every connection drains,
    // and a server that never does would otherwise hang shutdown forever — trading a leak
    // for a hang, which is worse because it is load-bearing on the exit path. Caught
    // immediately: the first version of this deadlocked the test suite against a stub
    // whose close() ignored its callback.
    //
    // ⇒ The DB close below is what actually frees the handle, so it must not be reachable
    // only through a promise someone else controls.
    if (entry.server) {
      await Promise.race([
        new Promise((resolve) => { try { entry.server.close(resolve); } catch { resolve(); } }),
        new Promise((resolve) => { setTimeout(resolve, 2000).unref?.(); }),
      ]);
    }
    try { entry.db?.close(); } catch { /* already closed */ }
  }
  return entries.length;
}

// Read-only view, so a test can assert the registry is empty without reaching into
// module state or depending on the shape of what is stored.
export function activeDashboardCount() {
  return activeDashboards.size;
}
