// DOES THIS PATH EXIST *WITH THIS SPELLING*? — because `existsSync` does not answer that on Windows.
//
// ⛔ THE DEFECT THIS FIXES, measured on a fixture before this file existed:
//
//     git mv -f src/middle.js src/Middle.js      # a case-only rename
//     existsSync('<repo>/src/middle.js')  ->  true      ⛔ the old spelling "still exists"
//     existsSync('<repo>/src/Middle.js')  ->  true
//     readdirSync('<repo>/src')           ->  ['Middle.js']     the ground truth
//
// The changed-file set is correct — `git diff --no-renames --name-only` reports BOTH `src/middle.js`
// and `src/Middle.js`, verified against a normal rename as a positive control. The failure is
// downstream: the refresh loop asks `existsSync(absPath)` to choose between deleting a vanished
// file's nodes and re-extracting it, gets `true` for the stale spelling, and RE-CREATES the old
// path's nodes from the renamed file's bytes. One file on disk, two `File` nodes in the graph, one of
// them carrying edges attributed to a path that no longer exists in that spelling.
//
// Note how this differs from the rename defect `--no-renames` already fixed (see
// `getChangedFilesSync`): there the old path never entered the changed set and its nodes were LEAKED
// BY OMISSION. Here it does enter, and the nodes are ACTIVELY REBUILT. Same symptom, different
// mechanism, and the first fix cannot reach the second.
//
// ⭐ WHY `readdir` AND NOT `realpathSync.native`. realpath returns the canonical case in one syscall,
// which is cheaper and covers every segment. It also RESOLVES SYMLINKS: a symlinked file's real path
// has a different tail, so comparing tails would report a genuinely present file as ABSENT — and the
// caller's response to absent is `deleteNodesForFile`. That trades a stale node for DELETING A REAL
// FILE'S NODES, which is the worse direction and was pre-registered as a refutation of this fix.
// Reading the parent directory cannot resolve a symlink, so it cannot make that mistake.
//
// ⚠ STATED LIMIT, not an oversight: this checks the FINAL SEGMENT only. A case-only rename of a
// PARENT DIRECTORY (`src/` -> `Src/`) is not detected, and its nodes would survive the same way. The
// measured defect is a file rename; covering directories means walking every segment, which is a
// larger change and a separate arm. Recorded here rather than left for a reader to discover.
//
// ⚠ AND NO CACHE, WHICH IS A MEASUREMENT RATHER THAN AN OMISSION. The worst observed expansion on
// this repository is 1047 files, so at most ~1047 reads of small directories against a rebuild that
// takes ~40s — negligible, and a cache would add a staleness window inside a run plus a `clear()`
// someone must remember to call. The cheap correct thing beats the fast stale thing here.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/**
 * True only if `relPath` names a file or directory that exists AND whose final segment is spelled
 * exactly as given. Fails CLOSED in the safe direction: any error reading the parent directory
 * returns the plain `existsSync` answer, so a permissions problem cannot cause nodes to be deleted.
 *
 * @param {string} repoRoot  absolute repository root
 * @param {string} relPath   repo-relative path, forward slashes
 */
export function existsWithExactCase(repoRoot, relPath) {
  const abs = join(repoRoot, relPath);
  // A path that does not exist under ANY spelling is absent, and no directory read is needed.
  if (!existsSync(abs)) return false;
  const want = basename(abs);
  try {
    return readdirSync(dirname(abs)).includes(want);
  } catch {
    // ⛔ FAIL OPEN *HERE*, DELIBERATELY, AND IT IS THE OPPOSITE OF THE USUAL RULE. The caller's
    // action on `false` is destructive: it deletes the file's nodes. An unreadable parent directory
    // is not evidence that the file was renamed away, and answering `false` on it would delete real
    // nodes over a transient error. `existsSync` already said the file is there; keep it.
    return true;
  }
}
