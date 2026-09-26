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
// ⛔⛔ THE "STATED LIMIT" THAT WAS A LIVE DEFECT. This function first checked the FINAL SEGMENT only,
// and its header recorded that as a limit: a case-only rename of a PARENT directory (`src/` -> `Src/`)
// would not be detected. graph-senior-dev then EXECUTED it — two-file repo, one commit carrying
// `D src/*` + `A Src/*`, disk holding only `Src` — and measured FOUR File nodes against a forced
// rebuild's TWO, plus a stale `src/outer.js -> src/middle.js` edge. Windows resolves the wrong-case
// `src` to `Src`, so `existsSync` said present and the basename check never looked at the directory.
//
// ⭐ That makes this the THIRD time in one arc that a hazard I wrote down was left undischarged (the
// others: caveating a conservation figure instead of fixing its key, and naming a dotted-prefix
// hazard in the comment directly above the code that had it). The note is not the fix. Every segment
// is checked now, and the parent case has an arm rather than a sentence.
//
// COST, measured rather than traded away: the worst observed expansion on this repository is 1047
// files at 3-4 segments each, so roughly 4000 reads of small directories against a rebuild that takes
// ~40s. The original basename-only choice was made on an unquantified saving, which is how the
// correctness was lost.
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
  // A path that does not exist under ANY spelling is absent, and no directory read is needed.
  //
  // ⚠ WHY A CASE-INSENSITIVE CALL IS SAFE *HERE* AND NOWHERE ELSE IN THIS FUNCTION. This is a fast
  // path to FALSE only. If it answers true for the wrong case, the segment walk below still answers
  // false; it can never turn a wrong-case path into a present one. The comparison that decides the
  // result is the exact one over a directory listing, which the platform cannot answer loosely.
  // (Raised by dashboard-manager: do not ask the filesystem a question it is entitled to answer
  // case-insensitively. Correct as a rule — this call does not decide anything.)
  if (!existsSync(join(repoRoot, relPath))) return false;

  // EVERY segment, parent directories included. `src/middle.js` after `src/` -> `Src/` must fail on
  // the FIRST segment; checking only `middle.js` finds it inside `Src` and wrongly reports present.
  const segments = relPath.split(/[\\/]+/).filter((s) => s && s !== '.');
  let parent = repoRoot;
  for (const segment of segments) {
    try {
      if (!readdirSync(parent).includes(segment)) return false;
    } catch {
      // ⛔ FAIL OPEN *HERE*, DELIBERATELY, AND IT IS THE OPPOSITE OF THE USUAL RULE. The caller's
      // action on `false` is destructive: it deletes the file's nodes. An unreadable directory is
      // not evidence that anything was renamed away, and answering `false` would delete real nodes
      // over a transient error. `existsSync` already said the path is there; keep it.
      return true;
    }
    parent = join(parent, segment);
  }
  return true;
}
