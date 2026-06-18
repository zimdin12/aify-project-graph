// Plan #18 A: auto-sync hook — wires the Plan #17 B file watcher to
// the graph_index pipeline so file changes trigger an incremental
// re-index without the user thinking about it.
//
// OPT-IN BY DEFAULT. Without APG_AUTO_SYNC=1 set, startAutoSync()
// returns status='disabled' and never starts the watcher. This keeps
// existing MCP-server installs unchanged for users who don't want a
// background sync process — the file watcher's WSL-/mnt-default-off
// safety is good but a background process is still a behavior change
// that should opt in.
//
// When APG_AUTO_SYNC=1:
//   1. startWatcher() runs at the project root.
//   2. On each debounced burst, ensureFresh({repoRoot}) is called.
//   3. Errors during sync are caught + logged (never crash the watcher).
//   4. Re-index lock is honored — only one sync runs at a time; bursts
//      that arrive during a sync are coalesced into the next one.

import { startWatcher } from './watcher.js';

export const AUTO_SYNC_ENV_VAR = 'APG_AUTO_SYNC';

/**
 * Start the auto-sync loop for `repoRoot`.
 *
 * Returns `{ stop, status, reason? }`:
 *   - status='running'      → watcher started, sync hook wired
 *   - status='disabled'     → opt-in env var not set (default)
 *   - status='unsupported'  → watcher reported unsupported (no fs.watch)
 *
 * @param {object} opts
 * @param {string} opts.repoRoot - absolute repo root
 * @param {Function} opts.ensureFresh - the freshness orchestrator entrypoint;
 *   injected so this module doesn't take a hard dependency on the file
 *   layout and stays unit-testable without a real graph DB.
 * @param {number} [opts.debounceMs=750]
 * @param {object} [opts.env=process.env]
 * @param {Function} [opts.log] - optional logger called with status strings
 */
export function startAutoSync({
  repoRoot,
  ensureFresh,
  debounceMs = 750,
  env = process.env,
  log = null,
} = {}) {
  if (!repoRoot) throw new Error('startAutoSync: repoRoot required');
  if (typeof ensureFresh !== 'function') throw new Error('startAutoSync: ensureFresh required');

  if (env[AUTO_SYNC_ENV_VAR] !== '1') {
    return {
      stop: () => { /* no-op */ },
      status: 'disabled',
      reason: `${AUTO_SYNC_ENV_VAR}!=1 (opt-in; set ${AUTO_SYNC_ENV_VAR}=1 to enable background re-index on file changes)`,
    };
  }

  let syncing = false;
  let pendingSync = false;
  let stopped = false; // set by stop(); gates runSync entry + the coalesced rerun

  async function runSync(reason) {
    if (stopped) return;
    if (syncing) {
      // Another sync is already running; coalesce by setting a pending flag
      // so the in-flight sync triggers one more pass when it finishes.
      pendingSync = true;
      return;
    }
    syncing = true;
    try {
      log?.(`[auto-sync] ensureFresh start (${reason})`);
      await ensureFresh({ repoRoot });
      log?.('[auto-sync] ensureFresh ok');
    } catch (err) {
      log?.(`[auto-sync] ensureFresh failed: ${err?.message ?? err}`);
    } finally {
      syncing = false;
      // Audit M3: don't fire the coalesced-burst rerun after stop() — that
      // straggling setImmediate was the real race behind the flaky test.
      if (pendingSync && !stopped) {
        pendingSync = false;
        // Recurse asynchronously so we don't keep a single sync chain
        // alive forever in pathological burst scenarios.
        setImmediate(() => runSync('coalesced-burst'));
      }
    }
  }

  const watcher = startWatcher({
    repoRoot,
    debounceMs,
    env,
    onChange: (events) => {
      // The watcher already debounces and filters ignored dirs; we just
      // hand off to ensureFresh. Don't await; runSync handles re-entry.
      runSync(`${events.length} file event(s)`);
    },
  });

  if (watcher.status !== 'running') {
    // Watcher refused (WSL /mnt or unsupported platform). Pass the status
    // through so the caller surfaces it instead of pretending sync is on.
    return {
      stop: watcher.stop,
      status: watcher.status,
      reason: watcher.reason,
    };
  }

  return {
    stop: () => {
      stopped = true;
      watcher.stop();
    },
    status: 'running',
  };
}
