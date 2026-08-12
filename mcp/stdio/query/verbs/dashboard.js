import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { startDashboard } from '../../dashboard/server.js';
import { inspectReadFreshness } from './read_freshness.js';

// Keyed by repoRoot so calling graph_dashboard from different repos in the
// same process doesn't silently return the URL of the first repo's server
// (the previous single-slot state caused exactly that — dev audit 11b90fb).
const activeDashboards = new Map();

export async function graphDashboard({ repoRoot, port }) {
  // ⚠ CAPTURED BEFORE THE FIRST AWAIT. My first placement read this AFTER
  // inspectReadFreshness, by which time a teardown could already have started and
  // finished — so the generation matched, the guard saw nothing wrong, and the orphan
  // published anyway. The test said `expected 0, got 1` twice before this moved.
  //
  // ⇒ The window a start must be measured against opens when the CALL begins, not when
  // the part of it I happened to be looking at begins.
  const startedInGeneration = teardownGeneration;
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

  // ⛔ OWNERSHIP MUST BE RESERVED BEFORE THE AWAIT, NOT AFTER IT.
  //
  // graph-senior-dev-hermes, two independent schedules:
  //   1. a start held inside `await startDashboard()` → shutdown snapshots an EMPTY
  //      registry, returns 0/completed → the start then publishes a live server + DB
  //      AFTER teardown. The process-exit test opens a fully-started dashboard and
  //      structurally cannot witness this.
  //   2. dashboard A closing while B starts → A's unconditional clear() DISCARDS B's
  //      entry without ever closing B's server or DB.
  //
  // ★ Both are the same root: the registry recorded only COMPLETED starts, so anything
  // in flight was invisible to the owner that is supposed to release it. A shutdown that
  // cannot see a resource cannot free it, and reports success either way.
  //
  // ⇒ A pending marker goes in FIRST, so teardown can join it. And the stdin handler
  // calls teardownSessions() unawaited, which makes this window real rather than theoretical.
  const pending = { pendingStart: true, repoRoot };
  activeDashboards.set(repoRoot, pending);

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

    // ⚠ If teardown ran while this start was in flight, the dashboard we just created is
    // already orphaned — nothing will ever close it. Release it here rather than
    // publishing a server the owner has stopped tracking.
    if (teardownGeneration !== startedInGeneration) {
      await new Promise((resolve) => { try { result.server.close(resolve); } catch { resolve(); } });
      try { db.close(); } catch { /* already closed */ }
      activeDashboards.delete(repoRoot);
      return { status: 'shutting_down', url: null, port: null };
    }

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
    // The reservation must not outlive a failed start, or shutdown waits on a ghost.
    if (activeDashboards.get(repoRoot) === pending) activeDashboards.delete(repoRoot);
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

// ⚠ A GENERATION COUNTER, NOT A BOOLEAN — and the difference is the whole finding.
//
// My first attempt used a `shuttingDownAll` flag cleared when teardown finished. dev's
// schedule is precisely the case that defeats it: teardown COMPLETES, and only then does
// the in-flight start publish. By that moment the flag is already false, so the start sees
// a quiet system and installs a server nobody owns. The test failed on the first run and
// said so — expected 0 registered, got 1.
//
// ⇒ What a start needs to know is not "is a teardown happening NOW" but "has a teardown
// happened SINCE I began". That is a monotonic counter, and it cannot be raced.
let teardownGeneration = 0;

async function doStopAllDashboards() {
  // ⛔ SNAPSHOT BY KEY, AND DELETE ONLY WHAT WAS SNAPSHOTTED. The previous version ended
  // with an unconditional `activeDashboards.clear()`, which DISCARDED any dashboard
  // registered after the snapshot — dev's schedule 2: A closing while B starts meant B's
  // server and DB were dropped from the registry without ever being closed. Erasing a
  // resource is not releasing it, and it looks identical from the outside.
  const snapshot = [...activeDashboards.entries()];
  const deadline = Date.now() + SHUTDOWN_BUDGET_MS;
  for (const [key, entry] of snapshot) {
    // A reservation with no server yet: the start is still awaiting. Drop the marker so
    // the starter sees `shuttingDownAll` and closes what it creates.
    if (entry.pendingStart) { activeDashboards.delete(key); continue; }
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
    // Remove THIS key only, and only if it still holds the entry we just closed. A start
    // that replaced it mid-teardown owns its own cleanup and must not be erased here.
    if (activeDashboards.get(key) === entry) activeDashboards.delete(key);
  }
  teardownGeneration += 1;
  return snapshot.filter(([, e]) => !e.pendingStart).length;
}

// Read-only view, so a test can assert the registry is empty without reaching into
// module state or depending on the shape of what is stored.
export function activeDashboardCount() {
  return activeDashboards.size;
}
