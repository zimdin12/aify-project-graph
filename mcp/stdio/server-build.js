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

let _cached = null;

export function serverBuildInfo() {
  if (_cached) return _cached;
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
  _cached = {
    version,
    commit: LOADED_COMMIT,
    dirty: dirtyOut == null ? null : dirtyOut.length > 0,
    startedAt: PROCESS_STARTED_AT,
    ...(staleProcess ? {
      workingTreeCommit: treeCommit,
      staleProcess: true,
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
              + ' RESTART the aify-project-graph MCP server before trusting any behaviour attributed to the newer commit.'),
    } : {}),
  };
  return _cached;
}

// The one-line form for the shared read-verb warning channel. A stale process
// makes EVERY answer potentially wrong, so this does not belong only in
// graph_health — a reader who never calls health would never learn.
export function staleProcessWarning() {
  const b = serverBuildInfo();
  return b.staleProcess ? b.staleWarning : null;
}

// Test seam: allow re-derivation after a simulated tree change.
export function _resetServerBuildCache() { _cached = null; }
