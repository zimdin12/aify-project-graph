// Plan #17 F: gitignore-respecting candidate file selection.
//
// When a repo is a git checkout, `git ls-files --cached --others
// --exclude-standard` gives us the canonical list of files git considers
// part of the repo: tracked + untracked-but-not-ignored. This honors
// .gitignore (including per-directory rules, negations, and the global
// excludes file) without us hand-rolling a gitignore parser.
//
// Per senior-dev's lock: do NOT parse .gitignore manually. v1 calls git
// or returns null (fall through to the full filesystem sweep).
// .aifyignore / .aifyinclude continue to apply on top of whichever
// candidate set the caller resolves.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function isGitWorktree(repoRoot) {
  try {
    return fs.existsSync(path.join(repoRoot, '.git'));
  } catch { return false; }
}

/**
 * Return the candidate file set for `repoRoot` per git's
 * gitignore-aware enumeration. Returns:
 *   - Set<string> of repo-relative forward-slash paths when inside a
 *     git repo and `git ls-files` succeeds.
 *   - null when the repo isn't a git checkout, git isn't on PATH, or
 *     the command fails. Caller should fall back to the legacy fs sweep.
 *
 * The set is deliberately permissive: tracked files + untracked-not-
 * ignored. Submodule contents are excluded by default (--recurse-submodules
 * is NOT set) which matches how most index/dashboards treat submodules.
 */
export function getGitCandidateFiles(repoRoot) {
  if (!repoRoot) return null;
  if (!isGitWorktree(repoRoot)) return null;

  let stdout;
  try {
    stdout = execFileSync(
      'git',
      ['-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 }
    );
  } catch {
    return null;
  }

  const out = new Set();
  for (const raw of stdout.split(/\r?\n/u)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Normalize to forward slash for cross-platform consistency. git on
    // Windows already emits forward slashes for tree paths but be defensive.
    const normalized = trimmed.replace(/\\/g, '/');
    out.add(normalized);
  }
  return out;
}

/**
 * Cheap check: should `relPath` be considered for indexing given a
 * git-candidate set? Returns true when:
 *   - the set is null (no git filter applies; everything's a candidate)
 *   - the set explicitly contains `relPath` (forward-slash form)
 *
 * Does NOT consult .aifyignore / .aifyinclude — those are layered on top
 * by the caller via the existing ignoredDirs path.
 */
export function isGitCandidate(relPath, gitCandidates) {
  if (!gitCandidates) return true;
  if (!relPath || relPath === '.') return true;
  const normalized = relPath.replace(/\\/g, '/');
  return gitCandidates.has(normalized);
}
