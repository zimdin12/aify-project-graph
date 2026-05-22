// Plan #18 Step A: graph_watch verb. Wraps the Plan #17 B native watcher
// and wires bursts through to graphIndex().
//
// Semantics per senior-dev's lock:
//   - Explicit verb only (no auto-enable env var by default).
//   - One watcher per repoRoot. enable=true on an already-running watcher
//     returns the current status (idempotent), does NOT spawn a second.
//   - During a re-index, additional change bursts collapse into ONE queued
//     follow-up — so a noisy editor save-storm produces at most 2 index
//     runs (the in-flight one + one trailing one).
//   - enable=false stops cleanly; subsequent enable=true starts fresh.

import path from 'node:path';
import { startWatcher } from '../../sync/watcher.js';
import { graphIndex } from './index.js';

// Plan #18 A per senior-dev revision: graph_watch's default debounce is
// 1500ms (longer than the underlying watcher's 750ms default). Editor
// save-storms + LSP autosaves can fire 5-10 events per second; a longer
// debounce on the verb-level path coalesces those more aggressively than
// the watcher module's general-purpose default.
const GRAPH_WATCH_DEFAULT_DEBOUNCE_MS = 1500;

const watchers = new Map();   // repoRoot → state

async function runReindex(repoRoot, state, eventCount) {
  state.eventsQueued += eventCount || 0;
  if (state.indexing) {
    // Coalesce: a re-index is already running; ensure one trailing run
    // is queued, but never queue more than one.
    state.pending = true;
    return;
  }
  state.indexing = true;
  state.pending = false;
  try {
    await graphIndex({ repoRoot, force: false });
    state.lastRunAt = new Date().toISOString();
    state.lastError = null;
    state.eventsQueued = 0;  // observed bursts consumed by this run
  } catch (err) {
    state.lastError = err?.message ?? String(err);
  } finally {
    state.indexing = false;
    // If a burst arrived during the previous run, do exactly one more.
    if (state.pending && watchers.get(repoRoot) === state) {
      state.pending = false;
      runReindex(repoRoot, state, 0); // tail-call; don't await
    }
  }
}

function buildStatus(repoRoot, state, { debounceMs } = {}) {
  // Senior-dev revision: return shape exposes the full observability set
  // so callers can health-check without spawning another verb call.
  if (!state || !state.watcher) {
    return {
      status: 'stopped',
      reason: null,
      repoRoot,
      running: false,
      debounceMs: debounceMs ?? null,
      lastRunAt: null,
      lastError: null,
      eventsQueued: 0,
    };
  }
  return {
    status: state.watcher.status,                  // 'running' | 'disabled' | 'unsupported'
    reason: state.watcher.reason ?? null,
    repoRoot,
    running: state.watcher.status === 'running',
    debounceMs: state.debounceMs ?? null,
    lastRunAt: state.lastRunAt ?? null,
    lastError: state.lastError ?? null,
    eventsQueued: state.eventsQueued,
    indexing: state.indexing,
    pendingReindex: state.pending,
  };
}

/**
 * MCP verb: graph_watch
 *   args: { enable: boolean, repoRoot?: string, debounceMs?: number }
 *
 * When enable=true: start a debounced native watcher on the repo. Each
 * settled burst kicks off a re-index via graphIndex(); concurrent bursts
 * coalesce into one trailing run.
 *
 * When enable=false: stop the watcher (if any). Idempotent.
 *
 * Returns the current status.
 */
export async function graphWatch({ enable, repoRoot, debounceMs } = {}) {
  const root = repoRoot ?? process.cwd();
  const absRoot = path.resolve(root);

  if (enable === false) {
    const existing = watchers.get(absRoot);
    if (existing) {
      try { existing.watcher.stop(); } catch { /* swallow */ }
      watchers.delete(absRoot);
    }
    return { status: 'stopped', repoRoot: absRoot };
  }

  if (enable !== true) {
    // Not enabling and not disabling — return current state. Useful for
    // health checks: graph_watch({}) → "what's the watcher's state right now?"
    const existing = watchers.get(absRoot);
    return buildStatus(absRoot, existing);
  }

  // enable=true with no existing watcher — start one.
  const existing = watchers.get(absRoot);
  if (existing && existing.watcher.status === 'running') {
    return buildStatus(absRoot, existing);
  }

  const resolvedDebounceMs = Number.isFinite(debounceMs) && debounceMs >= 0
    ? debounceMs
    : GRAPH_WATCH_DEFAULT_DEBOUNCE_MS;
  const state = {
    watcher: null,
    indexing: false,
    pending: false,
    lastRunAt: null,
    lastError: null,
    eventsQueued: 0,
    debounceMs: resolvedDebounceMs,
  };
  state.watcher = startWatcher({
    repoRoot: absRoot,
    debounceMs: resolvedDebounceMs,
    onChange: (events) => { runReindex(absRoot, state, Array.isArray(events) ? events.length : 1); },
  });
  watchers.set(absRoot, state);
  return buildStatus(absRoot, state);
}

// Test-only helpers — let suites snapshot/reset internal state.
export function _watchersForTest() {
  return watchers;
}
export function _resetWatchersForTest() {
  for (const state of watchers.values()) {
    try { state.watcher.stop(); } catch { /* swallow */ }
  }
  watchers.clear();
}
