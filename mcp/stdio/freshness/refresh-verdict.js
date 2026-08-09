// IS ANYTHING ACTUALLY KEEPING THIS GRAPH CURRENT?
//
// Measured 2026-08-07: sand_castle 20 commits stale, aify-project-graph 130.
// Neither was an indexing bug. The refresh hooks were never installed, and
// nothing reported that — the mechanism's own absence was invisible, so the
// staleness read as a property of the tool rather than of the setup. One agent
// made zero graph calls in a full session and concluded it did not help.
//
// The three-way split is deliberate and is the whole design:
//
//   unconfigured  no hooks. A KNOWN state, not a failure. Advisory.
//   degraded      hooks present but the mechanism is not demonstrably working.
//   ok            hooks present and a refresh has been observed to succeed.
//
// Fail-closed applies to `degraded`, not to `unconfigured`. A mechanism that is
// supposed to be running and is silent cannot be told apart from one that is
// working, so silence is treated as failure. A mechanism never enabled is
// different in kind — and reporting every un-hooked repo as degraded would spend
// the signal's meaning in exactly the repos that later install hooks and need it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIFY_HOOKS, AIFY_HOOK_MARKER } from '../../../scripts/install-graph-hook.mjs';
import { readRefreshBreadcrumb } from './refresh-breadcrumb.js';

const INSTALL_CMD = 'node <apg>/scripts/install-graph-hook.mjs <repoRoot>';

/**
 * Count hooks that are OURS, by marker rather than by path.
 *
 * This repo shipped two competing installers writing the same filename with
 * different markers; counting by path would have reported a foreign hook — or a
 * superseded one — as the working mechanism.
 */
function installedHookCount(repoRoot) {
  let n = 0;
  for (const hook of AIFY_HOOKS) {
    const p = join(repoRoot, '.git', 'hooks', hook);
    if (!existsSync(p)) continue;
    try {
      if (readFileSync(p, 'utf8').includes(AIFY_HOOK_MARKER)) n += 1;
    } catch { /* unreadable == not installed */ }
  }
  return n;
}

/**
 * Reindex failures carry raw stderr, which is multi-line. These strings are
 * joined into graph_health's single-line summary, so an embedded newline splits
 * the summary mid-sentence and the fragments read as separate findings.
 */
function oneLine(text) {
  return String(text).replace(/\s*\r?\n\s*/g, ' ').trim();
}

export function refreshMechanismVerdict(repoRoot) {
  if (!existsSync(join(repoRoot, '.git'))) {
    return {
      state: 'not_a_git_repo',
      hooks_installed: 0,
      hooks_expected: AIFY_HOOKS.length,
      last_refresh: null,
      consequence: 'No git repository here, so there is no HEAD to track. Freshness is whatever graph_index last produced.',
      remedy: null,
    };
  }

  const installed = installedHookCount(repoRoot);
  const last = readRefreshBreadcrumb(repoRoot);
  const base = { hooks_installed: installed, hooks_expected: AIFY_HOOKS.length, last_refresh: last };

  if (installed === 0) {
    return {
      ...base,
      state: 'unconfigured',
      consequence:
        'Nothing refreshes this graph when HEAD moves, so it will drift behind the repo silently and a '
        + '"not found" will increasingly mean "not indexed yet" rather than "absent". This is not a '
        + 'failure — the mechanism was never enabled.',
      remedy: `install the refresh hooks: ${INSTALL_CMD}`,
    };
  }

  if (installed < AIFY_HOOKS.length) {
    return {
      ...base,
      state: 'degraded',
      consequence:
        `Only ${installed} of ${AIFY_HOOKS.length} refresh hooks are installed, so some of the ways HEAD moves `
        + '(pull, branch switch, rebase) do NOT trigger a refresh. Staleness will appear intermittently and '
        + 'look like a different bug each time.',
      remedy: `re-run the installer to restore all four: ${INSTALL_CMD}`,
    };
  }

  if (!last) {
    return {
      ...base,
      state: 'degraded',
      consequence:
        'The refresh hooks are installed but no refresh has been recorded — the mechanism has never been '
        + 'observed to run. Unknown is not healthy: a hook that silently fails to execute looks exactly like '
        + 'one that has simply not been needed yet.',
      remedy: 'make a commit, then re-run graph_health. If still absent, run the hook body manually to see its error.',
    };
  }

  if (last.status === 'failed') {
    return {
      ...base,
      state: 'degraded',
      consequence: oneLine(
        `The last refresh FAILED (${last.trigger ?? 'unknown trigger'} at ${last.at}): ${last.error ?? 'no error recorded'}. `
        + 'The graph has been drifting since then, and the hooks will keep failing the same way until it is fixed.',
      ),
      remedy: 'fix the underlying error, then run graph_index() to catch up.',
    };
  }

  return {
    ...base,
    state: 'ok',
    consequence: oneLine(`Last refresh ${last.status} via ${last.trigger ?? 'unknown'} at ${last.at}.`),
    remedy: null,
  };
}
