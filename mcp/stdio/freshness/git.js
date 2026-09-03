import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import {
  isIgnoredDirName,
  loadEffectiveIgnoredDirs,
  normalizeRepoRelativePath,
  pathContainsIgnoredDir,
} from '../ingest/ignored-dirs.js';

function normalizeLines(stdout) {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

export async function getHeadCommit(repoRoot) {
  return execGit(repoRoot, ['rev-parse', 'HEAD']).trim();
}

export async function getDirtyFileEntries(repoRoot) {
  return getDirtyFileEntriesSync(repoRoot);
}

export async function getDirtyFiles(repoRoot) {
  const entries = await getDirtyFileEntries(repoRoot);
  return entries.map((entry) => entry.path);
}

export function getDirtyFileEntriesSync(repoRoot) {
  const stdout = execGit(repoRoot, ['status', '--porcelain']);
  // TWO IGNORE SETS, BECAUSE THERE ARE TWO IGNORE SYSTEMS AND ONLY ONE OF THEM GIT KNOWS ABOUT.
  //
  // `.aifyignore` and the built-in directory list (`.codex_tmp`, `worktrees`, `node_modules`, …) are
  // OURS. Git has never heard of them, so git's output must still be filtered through them — that is
  // what the four `getDirtyFiles` cases in git.test.js pin, and they are right.
  //
  // ⛔ THE PATTERNS PARSED OUT OF .gitignore ARE A DIFFERENT MATTER, AND RE-APPLYING THEM IS THE BUG.
  // Git already applied them, correctly, including negations. Our parser cannot express negation
  // precedence — `loadEffectiveIgnoredDirs`'s own comment says so, ten lines up from here — so
  // running it over git's answer can only prune files git deliberately re-included.
  //
  // ⚠ AND THAT REMEDY ALREADY EXISTED. `skipGitignore: true` was added for sweep.js, whose hazard is
  // identical: git's answer is authoritative and the parser was pre-filtering it. It was applied to
  // the caller where it was found and not to this one. One fix is not a sweep.
  const ownIgnores = loadEffectiveIgnoredDirs(repoRoot, { skipGitignore: true });
  // The walk below never passes through git at all, so it needs the full set, .gitignore included.
  const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);

  return stdout
    .split(/\r?\n/u)
    .map(parseStatusLine)
    .filter(Boolean)
    .flatMap((entry) => expandEntry(repoRoot, entry, ignoredDirs))
    .map((entry) => ({
      ...entry,
      path: normalizeRepoRelativePath(entry.path),
    }))
    .filter((entry) => entry.path)
    // ⛔ ONLY WALK OUTPUT IS RE-FILTERED. Measured on this repository before the fix, on an otherwise
    // clean tree: `git status --porcelain` reported " M docs/evidence/suite/latest.log" and this
    // function returned []. `.gitignore` carries `*.log` at line 4 and the negation
    // `!docs/evidence/suite/*.log` at line 11 — written deliberately so suite evidence could be
    // committed. Git honours that negation; `pathContainsIgnoredDir` does not, so the file this
    // project uses as its own push evidence was invisible to the freshness machinery and
    // `graph_packet` rendered `dirty=0` on a dirty tree. A dirty count that reads LOW is the
    // fail-open direction: it tells an agent the snapshot agrees with the source when it does not.
    .filter((entry) => !pathContainsIgnoredDir(entry.path, entry.fromExpansion ? ignoredDirs : ownIgnores))
    // `fromExpansion` is internal routing, not part of this function's contract.
    .map(({ fromExpansion, ...entry }) => entry);
}

export function getDirtyFilesSync(repoRoot) {
  return getDirtyFileEntriesSync(repoRoot).map((entry) => entry.path);
}

// TRACKED modifications only — the one dirty number that means "the snapshot may
// disagree with the source it was built from." Untracked files were never in the
// graph, so they cannot make an indexed file stale.
//
// Field report (2026-07-27): on a tree with 0 tracked modifications and 592
// untracked files, graph_packet printed `dirty=592` while the read-verb warning
// printed nothing, for the same tree at the same commit. Two numbers for one
// question is worse than either number alone: the agent cannot tell which verb is
// lying. Every surface that reports a dirty COUNT to influence trust routes
// through here.
export function getTrackedDirtyFilesSync(repoRoot) {
  return getDirtyFileEntriesSync(repoRoot)
    .filter((entry) => !entry.untracked)
    .map((entry) => entry.path);
}

export async function getChangedFiles(repoRoot, fromRef, toRef = 'HEAD') {
  return getChangedFilesSync(repoRoot, fromRef, toRef);
}

// Shared sync git-diff name-only helper. Used by verify mode (which stays
// sync) and the async getChangedFiles wrapper so both get identical line
// normalization (trim, drop blanks, backslash→slash).
//
// ⛔ RETURNS null WHEN THE DIFF COULD NOT BE COMPUTED — never [].
//
// `[]` means "these zero files changed". `null` means "I could not find out". They used to be the
// SAME VALUE, and the orchestrator read the second as the first:
//
//     HEAD..HEAD   -> []    a legitimate empty delta
//     bogus..HEAD  -> []    a failure
//
// With an unresolvable indexed commit the orchestrator found nothing to reindex, took its no-op
// path, and ADVANCED THE MANIFEST over code it had never read. Reproduced end to end, with a live
// control arm, in tests/integration/stale-commit-advances-manifest.test.js.
//
// ⚠ THE OLD CONTRACT — "so callers can degrade gracefully instead of throwing" — REMAINS CORRECT
// FOR ONE CALLER. packet-verify is a display path that documents its own degradation and now writes
// `?? []`. It was never correct for a caller deciding what to reindex. One failure policy cannot
// serve two callers with opposite needs, and `null` forces each to say which it is: null is not an
// array, so it cannot be silently spread, iterated or defaulted away.
//
// ★ AND NOTE WHAT THIS FUNCTION'S OWN HEADER ALREADY RECORDS, below: a rename leaking the old
// file's nodes, invisible to every per-file assertion in the suite and found only because a rebuild
// oracle disagreed with the incremental graph. The catch beneath was producing a SECOND instance of
// that same class — silent incompleteness that nothing in the suite could see.
export function getChangedFilesSync(repoRoot, fromRef, toRef = 'HEAD') {
  try {
    // ★★ `--no-renames` IS LOAD-BEARING. WITHOUT IT A RENAME LEAKS THE OLD FILE'S NODES.
    //
    // git applies rename detection to `diff` by DEFAULT, and `--name-only` then reports
    // only the DESTINATION path. Proven:
    //
    //     git mv src/oldname.js src/newname.js
    //     git diff --name-only          → src/newname.js
    //     git diff --no-renames --name-only → src/newname.js
    //                                         src/oldname.js
    //
    // The source path never entered the changed-file list, so the refresh loop never
    // called `deleteNodesForFile` on it and every node from the old path survived — File,
    // Module and every symbol in it.
    //
    // ⛔ WHAT THAT COSTS A READER: `graph_search` returns a symbol at a path that does not
    // exist; `code_intel_references` counts callers living in a deleted file; a
    // deletion-safety judgement is computed over phantom code. Confidently wrong, in the
    // direction of "there is more here than there is".
    //
    // ★ FOUND BY THE INCREMENTAL-VS-REBUILD ORACLE ON ITS FIRST RUN, which is the whole
    // argument for that oracle: every per-file assertion in the suite passed throughout.
    // The incremental graph and a clean rebuild simply disagreed, and nothing had ever
    // compared them. A plain delete was handled correctly — only a RENAME hid, because
    // only a rename is something git helpfully collapses for you.
    const stdout = execGit(repoRoot, ['diff', '--no-renames', '--name-only', `${fromRef}..${toRef}`]);
    return normalizeLines(stdout);
  } catch {
    return null;
  }
}

function execGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

// P5-5: worktree detection + redirect.
//
// A linked git worktree (`git worktree add`) is frequently ephemeral — agents
// spin one up for a task and delete it on session end. If the MCP server runs
// inside such a worktree and resolves `.aify-graph` relative to the worktree
// root, it either (a) builds a graph that vanishes with the worktree, or worse
// (b) clobbers the parent checkout's graph if the worktree shares it. We detect
// the linked-worktree case and REDIRECT `.aify-graph` resolution to the MAIN
// working tree's root, where the durable graph lives.
//
// Detection: in a linked worktree, `--git-dir` points at
// `<main>/.git/worktrees/<name>` while `--git-common-dir` points at the shared
// `<main>/.git`. They differ → linked worktree. The main working tree root is
// the parent of the common git dir (for a standard `<main>/.git` layout). We
// return that as `mainRoot`. Bare repos / detached `.git` files are handled by
// falling back to no redirect (mainRoot=null) rather than guessing wrong.
//
// Returns:
//   { isWorktree: false, mainRoot: null }                      — not a worktree
//   { isWorktree: true,  mainRoot: '<abs>' | null, ... }       — linked worktree
export function detectWorktree(repoRoot, { exec = execGit } = {}) {
  const out = { isWorktree: false, mainRoot: null, gitDir: null, commonDir: null };
  let gitDir;
  let commonDir;
  try {
    gitDir = exec(repoRoot, ['rev-parse', '--git-dir']).trim();
    commonDir = exec(repoRoot, ['rev-parse', '--git-common-dir']).trim();
  } catch {
    return out; // not a git repo, or git unavailable → no redirect
  }
  if (!gitDir || !commonDir) return out;

  // Normalize both to absolute paths. git may return either relative (to
  // repoRoot) or absolute paths depending on version/platform.
  const absGit = resolve(repoRoot, gitDir);
  const absCommon = resolve(repoRoot, commonDir);
  out.gitDir = absGit;
  out.commonDir = absCommon;

  if (absGit === absCommon) return out; // main working tree — no redirect

  out.isWorktree = true;
  // The common dir is the shared git dir, typically `<mainRoot>/.git`. Its
  // parent is the main working tree root. Guard the conventional layout; if
  // the basename isn't `.git` we can't safely infer the root, so leave it null
  // (caller falls back to a notice instead of a redirect).
  const commonBase = absCommon.replace(/[\\/]+$/u, '');
  if (/[\\/]\.git$/u.test(commonBase) || commonBase.endsWith('.git')) {
    out.mainRoot = dirname(commonBase);
  }
  return out;
}

// Resolve the directory that should own `.aify-graph` for a given checkout.
// If `repoRoot` is a linked worktree that has NO `.aify-graph` of its own, and
// we can locate the main working tree root, redirect there. Otherwise keep the
// worktree's own root (an intentional per-worktree graph is respected, and a
// main checkout is never redirected). Opt-out via APG_NO_WORKTREE_REDIRECT=1.
//
// Returns { root, redirected: boolean, isWorktree: boolean, mainRoot }.
export function resolveGraphRoot(repoRoot, { env = process.env, fsExists = existsSync, exec = execGit } = {}) {
  const result = { root: repoRoot, redirected: false, isWorktree: false, mainRoot: null };
  if (env?.APG_NO_WORKTREE_REDIRECT === '1') return result;

  const wt = detectWorktree(repoRoot, { exec });
  result.isWorktree = wt.isWorktree;
  result.mainRoot = wt.mainRoot;
  if (!wt.isWorktree || !wt.mainRoot) return result;

  // If the worktree already has its own graph, honor it (don't hijack an
  // intentional per-worktree build).
  if (fsExists(join(repoRoot, '.aify-graph'))) return result;

  // Only redirect when the main root actually has a graph to serve.
  if (fsExists(join(wt.mainRoot, '.aify-graph'))) {
    result.root = wt.mainRoot;
    result.redirected = true;
  }
  return result;
}

function parseStatusLine(line) {
  const trimmed = String(line || '').trimEnd();
  if (!trimmed) return null;
  const status = trimmed.slice(0, 2);
  let filePath = trimmed.slice(3).trim();
  if (!filePath) return null;
  if (filePath.includes(' -> ')) {
    filePath = filePath.split(' -> ').at(-1) ?? filePath;
  }
  return {
    status,
    path: filePath,
    untracked: status === '??',
  };
}

// ⛔ WHO NAMED THIS PATH — GIT, OR OUR OWN DIRECTORY WALK? The two need opposite treatment, and
// collapsing them is what made a tracked file invisible.
//
// A path git NAMED is already ignore-correct by git's evaluation: git does not apply .gitignore to
// tracked files at all, and does not list ignored untracked ones. Re-filtering those through our own
// approximation can only DROP what git deliberately reported.
//
// A path our WALK produced is different. Git reports an untracked directory as one `?? dir/` entry,
// so the files inside it never passed git's per-file check and genuinely do need filtering.
//
// `fromExpansion` carries that distinction to the filter instead of leaving it to be guessed.
function expandEntry(repoRoot, entry, ignoredDirs) {
  const normalized = normalizeRepoRelativePath(entry.path);
  if (!entry.untracked || !normalized.endsWith('/')) {
    return [{ ...entry, path: normalized, fromExpansion: false }];
  }
  return expandUntrackedDirectory(repoRoot, normalized, ignoredDirs)
    .map((path) => ({ ...entry, path, fromExpansion: true }));
}

function expandUntrackedDirectory(repoRoot, relDir, ignoredDirs) {
  const absDir = join(repoRoot, relDir);
  if (!existsSync(absDir)) return [relDir];
  const out = [];
  const walk = (absPath, relPath) => {
    const entries = readdirSync(absPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextAbs = join(absPath, entry.name);
      const nextRel = normalizeRepoRelativePath(join(relPath, entry.name));
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name, ignoredDirs)) continue;
        walk(nextAbs, nextRel);
      } else {
        out.push(nextRel);
      }
    }
  };
  walk(absDir, relDir);
  return out.length > 0 ? out : [relDir];
}
