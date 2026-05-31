// Plan #17 B: native OS file watcher with debounced auto-sync.
//
// Mirrors github.com/colbymchenry/codegraph's approach: recursive
// fs.watch (FSEvents on macOS / inotify on Linux 19+ /
// ReadDirectoryChangesW on Windows) with a debounce window so a burst
// of file changes triggers ONE re-index, not many.
//
// Per senior-dev's lock:
//   - WSL `/mnt/*` mounts disable the watcher entirely by default
//     (recursive fs.watch is pathologically slow there per codegraph
//     issue #199; opt back in via APG_WATCHER_FORCE_WSL_MNT=1).
//   - NO polling fallback. If native fs.watch isn't supported on this
//     platform, the watcher reports unsupported and the caller falls
//     through to manual re-index. Polling can be added behind an
//     explicit opt-in flag in a follow-up.
//
// Public API:
//   startWatcher({ repoRoot, onChange, debounceMs?, ignoredDirs?, env? })
//   -> { stop(): void, status: 'running' | 'disabled' | 'unsupported',
//        reason?: string }

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isIgnoredDirName,
  pathContainsIgnoredDir,
  IGNORED_DIRS,
} from '../ingest/ignored-dirs.js';

const DEFAULT_DEBOUNCE_MS = 750;

/**
 * Detect "WSL on /mnt/*" — the case codegraph explicitly turns off the
 * native watcher for. Returns true ONLY when we're sure (linux + WSL
 * markers AND the watched path starts with /mnt/). False on macOS,
 * native Linux, native Windows, and WSL paths outside /mnt/*.
 */
export function isWslMntPath(repoRoot, { env = process.env } = {}) {
  if (os.platform() !== 'linux') return false;
  if (!repoRoot || !repoRoot.startsWith('/mnt/')) return false;
  // WSL exposes the host kernel via /proc/version containing "Microsoft"
  // or "WSL". Cheap one-shot check; cached by the OS so reading it
  // repeatedly is fine.
  try {
    const ver = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    if (ver.includes('microsoft') || ver.includes('wsl')) return true;
  } catch { /* not WSL or proc unreadable; fall through */ }
  // Also accept WSL_DISTRO_NAME env var as a positive signal.
  if (env?.WSL_DISTRO_NAME) return true;
  return false;
}

/**
 * Start a debounced native file watcher rooted at `repoRoot`. Calls
 * `onChange(events)` after the debounce window settles, where `events`
 * is an array of `{ event, filename, at }` for the burst.
 *
 * Returns `{ stop, status, reason? }`:
 *   - status='running'      → watcher is active, fs.watch fired
 *   - status='disabled'     → intentionally off (WSL /mnt/* by default)
 *   - status='unsupported'  → fs.watch threw / returned no handle
 */
export function startWatcher({
  repoRoot,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  ignoredDirs = IGNORED_DIRS,
  env = process.env,
} = {}) {
  if (!repoRoot) throw new Error('startWatcher: repoRoot required');
  if (typeof onChange !== 'function') throw new Error('startWatcher: onChange required');

  // WSL /mnt/* disabled by default per senior-dev's lock. Opt back in
  // with APG_WATCHER_FORCE_WSL_MNT=1 (mirrors codegraph's opt-out env
  // pattern).
  if (isWslMntPath(repoRoot, { env }) && env.APG_WATCHER_FORCE_WSL_MNT !== '1') {
    return {
      stop: () => { /* no-op */ },
      status: 'disabled',
      reason: 'wsl-/mnt/-default-off (recursive fs.watch is pathologically slow on WSL /mnt/*; set APG_WATCHER_FORCE_WSL_MNT=1 to override)',
    };
  }

  let pending = null;
  let pendingTimer = null;
  let stopped = false;

  function flushBurst() {
    if (stopped) return;
    const burst = pending;
    pending = null;
    pendingTimer = null;
    if (!burst || burst.length === 0) return;
    try { onChange(burst); } catch { /* swallow; one bad consumer mustn't kill the watcher */ }
  }

  function queueEvent(event, filename) {
    if (stopped) return;
    if (!filename) return; // platforms occasionally fire with null filename
    // P5-4: inotify-budget hygiene. Node's recursive fs.watch registers ONE
    // descriptor at the root (FSEvents / ReadDirectoryChangesW / inotify
    // recursive) — we deliberately do NOT register a watch per directory, so
    // there is nothing to "exclude before registering": the single recursive
    // watch is already the cheapest possible registration and never blows the
    // OS watch-descriptor budget on large repos.
    //
    // What we DO gate is which events reach the debounce/rebuild path. Earlier
    // this only checked the TOP-LEVEL segment, so a nested ignored dir
    // (`src/node_modules/...`, `pkg/build-x/...`, `.claude/worktrees/...`)
    // still triggered a rebuild. Check the FULL relative path against the
    // ignored-dir rules (handles nested segments, build-prefix rules, and
    // path-patterns) and drop the event before it queues any work.
    const rel = String(filename).replace(/\\/g, '/');
    // Check EVERY segment, not just leading or dir-only ones. fs.watch on
    // Windows frequently reports a directory change (e.g. `pkg/node_modules`)
    // where the ignored name is the trailing segment — pathContainsIgnoredDir
    // (which treats the last segment as a filename) would let it through. The
    // path-pattern rules (e.g. `.claude/worktrees`) still need the full-path
    // check, so apply both.
    const segments = rel.split('/').filter(Boolean);
    if (segments.some((seg) => isIgnoredDirName(seg, ignoredDirs))) return;
    if (pathContainsIgnoredDir(rel, ignoredDirs)) return;
    if (!pending) pending = [];
    pending.push({ event, filename: String(filename).replace(/\\/g, '/'), at: Date.now() });
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flushBurst, debounceMs);
  }

  let handle;
  try {
    handle = fs.watch(repoRoot, { recursive: true }, queueEvent);
  } catch (err) {
    return {
      stop: () => { /* no-op */ },
      status: 'unsupported',
      reason: `fs.watch failed: ${err?.message ?? err}`,
    };
  }
  if (!handle || typeof handle.close !== 'function') {
    return { stop: () => { /* no-op */ }, status: 'unsupported', reason: 'fs.watch returned no handle' };
  }
  // Keep the watcher from holding the event loop open by default; the
  // caller can call .ref() on the handle if they need to.
  if (typeof handle.unref === 'function') handle.unref();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      try { handle.close(); } catch { /* swallow */ }
    },
    status: 'running',
  };
}
