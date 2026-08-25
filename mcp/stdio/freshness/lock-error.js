// Turn "Lock file is already being held" into something a reader can act on.
//
// ⛔ THE FAILURE THIS EXISTS FOR, OBSERVED WHILE AUDITING THIRD-PARTY REPOSITORIES. A `graph_index`
// run was killed by a timeout mid-write. It left `.aify-graph/.write.lock.lock` behind, and with
// `stale: 3600000` in withWriteLock the repository became UNINDEXABLE FOR UP TO AN HOUR — every
// attempt failing with one sentence that names no cause, no expiry, and no remedy.
//
// The one-hour window is CORRECT: it protects a legitimately long first index from being stolen by
// a peer agent. What was wrong is that the failure explained none of it, so the operator could not
// tell a busy peer from a corpse, and had nothing to try.
//
// ⚠ IT STATES ONLY WHAT IT CAN OBSERVE. The lock's age, when it becomes reclaimable, and its path.
// It does NOT claim the holder is dead — from here a slow index and a crashed one are
// indistinguishable, and asserting otherwise would invite an operator to delete a live peer's lock
// mid-write. The reader is given the age and the threshold and left to judge.

import fs from 'node:fs';

/** proper-lockfile appends `.lock` to the path it is given. */
const lockDirFor = (repoRoot) => `${String(repoRoot).replace(/\\/g, '/')}/.aify-graph/.write.lock.lock`;

/** How long has the lock existed, in ms? `null` when it cannot be read. */
export function lockAgeMs(repoRoot, now = Date.now()) {
  try {
    const { mtimeMs } = fs.statSync(lockDirFor(repoRoot));
    return Math.max(0, now - mtimeMs);
  } catch {
    return null;   // absent or unreadable — never guess an age
  }
}

const mins = (ms) => Math.round(ms / 60000);

/**
 * @param {Error} err        the original failure
 * @param {string} repoRoot
 * @param {number} staleMs   the reclaim threshold withWriteLock configured
 */
export function enrichLockError(err, repoRoot, staleMs = 3600000, now = Date.now()) {
  const msg = String(err?.message ?? err);
  // ⛔ ONLY THE LOCK FAILURE IS REWRITTEN. Wrapping every error from inside the critical section
  // would attach lock advice to an unrelated crash, which is worse than the original message.
  if (!/already being held|ELOCKED/i.test(msg)) return err;

  const age = lockAgeMs(repoRoot, now);
  const path = lockDirFor(repoRoot);

  const parts = [
    'graph write lock is held, so this repository cannot be indexed right now.',
    age === null
      ? 'The lock age could not be read, so it is unknown whether the holder is still working.'
      : `The lock is ${mins(age)} minute(s) old.`,
    age === null
      ? ''
      : (age >= staleMs
        ? `That is past the ${mins(staleMs)}-minute stale threshold, so the next attempt should reclaim it automatically.`
        : `It becomes reclaimable automatically after ${mins(staleMs)} minutes — about ${mins(staleMs - age)} minute(s) from now.`),
    // ⚠ Both readings offered, because this cannot distinguish them and pretending otherwise is how
    // a live peer's lock gets deleted mid-write.
    //
    // ⛔ AND THE PHRASE MUST NOT CLAIM AN AGE IT JUST SAID IT LACKS. The first version said "a lock
    // this old is either…" in the same message as "the lock age could not be read" — two sentences
    // contradicting each other, which is precisely the defect class this whole audit is about.
    age === null
      ? 'It is either a peer still indexing a large repository, or a previous run that was killed '
        + 'and never released it.'
      : 'A lock this old is either a peer still indexing a large repository, or a previous run that '
        + 'was killed and never released it.',
    `If you are certain no index is running, remove ${path} and retry.`,
  ].filter(Boolean);

  const enriched = new Error(`${msg} — ${parts.join(' ')}`);
  enriched.code = 'graph_write_lock_held';
  enriched.lockPath = path;
  enriched.lockAgeMs = age;
  enriched.staleMs = staleMs;
  enriched.cause = err;
  return enriched;
}
