// SERVER BUILD IDENTITY — what code is actually answering you.
//
// Captured at MODULE LOAD, which is when this process read its code from disk.
// It used to be read lazily inside the first graph_health call, from the working
// DIRECTORY — which is a fact about the filesystem, not about the running build. A
// long-lived MCP server whose checkout moves underneath it (git pull, a push)
// reported the NEW commit while executing the OLD code.
//
// That cost a real verification window on 2026-07-30: sc-manager did the careful
// thing — restart, then confirm `server.commit` via graph_health BEFORE testing a
// fix — and the field answered about the filesystem. He then tested code that was
// never loaded. His words: it converted "I should check" into "I checked".
//
// `startedAt` shared the defect (it recorded first-call time, not process start),
// so the one field that could have caught the mismatch was broken the same way.
// A guard failing together with the thing it guards is how a blind spot survives.
//
// Extracted to its own module so EVERY surface can carry the warning, not just the
// diagnostic verb: if the process is stale, every answer it gives is suspect.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function gitAt(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { return null; }
}

// Both captured at load: this is the process's own identity.
const PROCESS_STARTED_AT = new Date().toISOString();
const LOADED_COMMIT = gitAt(SERVER_ROOT, ['rev-parse', '--short', 'HEAD']);

// ★ THE STALENESS VERDICT MUST NOT BE CACHED — IT IS THE ONE FIELD THAT CHANGES.
//
// This function used to cache its ENTIRE result on first call. Two of the values
// it returns are immutable by construction (the commit this process loaded, when
// it started), but `staleProcess` is a comparison against the tree RIGHT NOW, and
// the tree is the thing that moves.
//
// So the guard cached "I am not stale" and never looked again. Worse, the
// negative verdict omits the key entirely (see the spread below), so the frozen
// answer was indistinguishable from a build that had no check at all.
//
// Measured (sc-manager, 2026-08-07): their server loaded 709cacf on Aug 4, called
// a verb that day while the tree still matched, and cached staleProcess:false.
// Two commits landed on Aug 5. On Aug 7 graph_health returned NO staleProcess
// field — and they reasonably concluded the field post-dated their binary. It did
// not; it shipped Jul 30, five days before their process started. The check was
// present, correct, and answering a question it had stopped asking.
//
// The population this guard exists for is long-lived processes. A long-lived
// process is precisely the one that has had time to cache "fresh" before going
// stale, so the cache disabled the guard exactly where it was needed — the same
// shape as the defect it detects.
//
// Immutable parts stay cached. The comparison is recomputed, behind a short TTL
// so a multi-verb turn does not shell out to git on every call.
let _immutable = null;
let _verdict = null;
let _verdictAt = 0;
const VERDICT_TTL_MS = 5000;

export function serverBuildInfo() {
  const now = Date.now();
  if (_immutable && _verdict && (now - _verdictAt) < VERDICT_TTL_MS) {
    return { ..._immutable, ..._verdict };
  }
  let version = null;
  try {
    version = JSON.parse(readFileSync(join(SERVER_ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch { /* installed copy without package.json — version alone is not load-bearing */ }
  const dirtyOut = gitAt(SERVER_ROOT, ['status', '--porcelain', '--untracked-files=no']);
  // Read the tree NOW and compare. A difference means this process is stale: the
  // reported commit is what is RUNNING; the tree is what a restart would load.
  const treeCommit = gitAt(SERVER_ROOT, ['rev-parse', '--short', 'HEAD']);
  const staleProcess = Boolean(LOADED_COMMIT && treeCommit && LOADED_COMMIT !== treeCommit);
  // ★ COMMIT IDENTITY STOOD IN FOR BEHAVIOURAL DIFFERENCE.
  //
  // staleProcess says RESTART whether the delta is a guard that prevents data loss
  // or a single markdown file. ef-manager hit exactly that: loaded cad4569 vs tree
  // c526849, staleProcess true — and the entire delta was one doc. He had to run
  // `git diff --name-only` himself to learn the running server was behaviourally
  // current, which is the difference between "you must restart before collecting"
  // and "ignore this".
  //
  // Fail-closed remains right: unknown delta => assume it matters. But unknown had
  // a one-command path to known, which is the session's own lesson — a fail-closed
  // default is a prompt to go measure, not a resting state.
  let staleDelta = null;
  if (staleProcess) {
    const changed = gitAt(SERVER_ROOT, ['diff', '--name-only', `${LOADED_COMMIT}..${treeCommit}`]);
    if (changed != null) {
      const files = changed.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
      const executable = files.filter((f) => /\.(js|mjs|cjs|ts|json)$/i.test(f));
      staleDelta = {
        files_changed: files.length,
        executable_files_changed: executable.length,
        behaviourally_current: executable.length === 0,
        sample: executable.slice(0, 5),
      };
    }
  }
  _immutable = {
    version,
    commit: LOADED_COMMIT,
    startedAt: PROCESS_STARTED_AT,
  };
  _verdictAt = now;
  _verdict = {
    dirty: dirtyOut == null ? null : dirtyOut.length > 0,
    // Explicit false rather than an omitted key. An absent field cannot be told
    // apart from a build that never had the check — which is exactly the
    // inference sc-manager drew, correctly, from a missing key.
    staleProcess,
    ...(staleProcess ? {
      workingTreeCommit: treeCommit,
      ...(staleDelta ? { staleDelta } : {}),
      staleWarning: `SERVER IS RUNNING STALE CODE: this process loaded ${LOADED_COMMIT} at ${PROCESS_STARTED_AT},`
        + ` but the checkout is now ${treeCommit}. Answers come from ${LOADED_COMMIT}.`
        + (staleDelta?.behaviourally_current
          ? ` HOWEVER the delta is ${staleDelta.files_changed} non-executable file(s) only —`
            + ' no .js/.mjs/.ts/.json changed, so this process is BEHAVIOURALLY CURRENT and a restart is not'
            + ' required for correctness.'
          : staleDelta
            ? ` The delta includes ${staleDelta.executable_files_changed} executable file(s)`
              + `${staleDelta.sample.length ? ` (e.g. ${staleDelta.sample.join(', ')})` : ''} —`
              + ' RESTART the aify-project-graph MCP server before trusting any behaviour attributed to the newer commit.'
            : ' Delta could not be computed, so assume it matters:'
              + ' RESTART the aify-project-graph MCP server before trusting any behaviour attributed to the newer commit.')
        // ★ NAME WHO CAN ACT ON THIS. The reader is almost always an agent, and an
        // agent cannot respawn its own MCP server — the host spawns it at session
        // start, and killing it drops the connection rather than reloading it. So
        // "RESTART the server" is correct for an operator and a dead end for the
        // one actually reading the string. ef-manager hit this twice in two
        // sessions: blocked, correctly refused to measure the old build, and had
        // no action available. (2026-08-09)
        + ' NOTE: an agent cannot self-restart this server — ask your operator to'
        + ' reconnect MCP or relaunch the session.',
    } : {}),
  };
  return { ..._immutable, ..._verdict };
}

// The one-line form for the shared read-verb warning channel. A stale process
// makes EVERY answer potentially wrong, so this does not belong only in
// graph_health — a reader who never calls health would never learn.
export function staleProcessWarning() {
  const b = serverBuildInfo();
  return b.staleProcess ? b.staleWarning : null;
}

// Test seam: force the next call to re-derive instead of waiting out the TTL.
export function _resetServerBuildCache() { _verdict = null; _verdictAt = 0; }
