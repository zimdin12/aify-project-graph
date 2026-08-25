import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrichLockError, lockAgeMs } from '../../../mcp/stdio/freshness/lock-error.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// F7. ⛔ THE FAILURE THIS CLOSES WAS OBSERVED, not imagined: a `graph_index` run killed by a
// timeout left `.aify-graph/.write.lock.lock` behind, and with `stale: 3600000` the repository was
// UNINDEXABLE FOR UP TO AN HOUR — every attempt failing with one sentence, "Lock file is already
// being held", naming no cause, no expiry and no remedy.
//
// The hour is CORRECT: it protects a legitimately long first index from being stolen by a peer.
// What was wrong is that the failure explained none of it.
//
// ⚠ AND THE MESSAGE MUST NOT OVERCLAIM. From here a slow index and a crashed one are
// indistinguishable. Asserting the holder is dead would invite an operator to delete a live peer's
// lock mid-write, which is worse than the silence being replaced.

const STALE = 3600000;
let dir;

function repoWithLock(ageMs) {
  dir = mkdtempSync(join(tmpdir(), 'apg-lockerr-'));
  const lock = join(dir, '.aify-graph', '.write.lock.lock');
  mkdirSync(lock, { recursive: true });
  if (ageMs != null) {
    const when = (Date.now() - ageMs) / 1000;
    utimesSync(lock, when, when);
  }
  return dir;
}

beforeEach(() => { dir = null; });
afterEach(() => { if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } });

const held = () => new Error('Lock file is already being held');

describe('enrichLockError — only the lock failure, and only what is observable', () => {
  it('⛔ an UNRELATED error passes through completely untouched', () => {
    // Attaching lock advice to a database corruption error would be worse than the original
    // message: it sends the reader to delete a lock file over an unrelated fault.
    const other = new Error('SQLITE_CORRUPT: database disk image is malformed');
    expect(enrichLockError(other, repoWithLock(0))).toBe(other);
  });

  it('⭐ a held lock is rewritten with cause, remedy and a typed code', () => {
    const e = enrichLockError(held(), repoWithLock(12 * 60000), STALE);
    expect(e.code).toBe('graph_write_lock_held');
    expect(e.message).toMatch(/cannot be indexed right now/i);
    expect(e.message).toMatch(/remove .*\.write\.lock\.lock/i);
    expect(e.cause).toBeInstanceOf(Error);      // the original is never discarded
  });

  it('⭐ a YOUNG lock reports when it becomes reclaimable', () => {
    const e = enrichLockError(held(), repoWithLock(12 * 60000), STALE);
    expect(e.message).toMatch(/12 minute\(s\) old/);
    expect(e.message).toMatch(/reclaimable automatically/i);
    expect(e.message).toMatch(/about 48 minute\(s\) from now/);
  });

  it('⭐ an OLD lock says the next attempt reclaims it — the opposite advice', () => {
    // Without this, "reclaimable in N minutes" would print for a lock already past the threshold,
    // telling the reader to wait for something that has already happened.
    const e = enrichLockError(held(), repoWithLock(90 * 60000), STALE);
    expect(e.message).toMatch(/past the 60-minute stale threshold/i);
    expect(e.message).toMatch(/reclaim it automatically/i);
    expectAbsentWithLiveMatcher(
      /reclaimable automatically after/,
      { forbidden: 'becomes reclaimable automatically after 60 minutes', allowed: 'should reclaim it automatically' },
      e.message,
      'a lock past the threshold must not be described as still waiting to expire',
    );
  });

  it('⛔ NEVER claims the holder is dead — both readings are offered', () => {
    // The claim this must not make. A slow first index on a large repository is indistinguishable
    // from a crashed one from here.
    const e = enrichLockError(held(), repoWithLock(90 * 60000), STALE);
    expect(e.message).toMatch(/either a peer still indexing/i);
    expect(e.message).toMatch(/or a previous run that was killed/i);
    expect(e.message).toMatch(/If you are certain no index is running/i);
  });

  it('⛔ an UNREADABLE age says so and does not then describe an age', () => {
    // ⛔ The first version printed "the lock age could not be read" and "a lock THIS OLD is either…"
    // in the same message — two sentences contradicting each other, which is the exact defect class
    // this audit exists to remove.
    dir = mkdtempSync(join(tmpdir(), 'apg-lockerr-none-'));   // no lock directory at all
    const e = enrichLockError(held(), dir, STALE);
    expect(e.lockAgeMs).toBeNull();
    expect(e.message).toMatch(/age could not be read/i);
    expectAbsentWithLiveMatcher(
      /lock this old/,
      { forbidden: 'A lock this old is either a peer', allowed: 'It is either a peer still indexing' },
      e.message,
      'a message that cannot read the age must not describe the age',
    );
  });
});

describe('lockAgeMs — absent is null, never zero', () => {
  it('⛔ a missing lock returns null, not 0', () => {
    // 0 would read as "brand new", which is the opposite of "we do not know" and would make the
    // caller advise waiting a full hour for a lock that does not exist.
    dir = mkdtempSync(join(tmpdir(), 'apg-lockage-'));
    expect(lockAgeMs(dir)).toBeNull();
  });

  it('⭐ an existing lock returns a real age — the positive control', () => {
    expect(lockAgeMs(repoWithLock(5 * 60000))).toBeGreaterThan(4 * 60000);
  });
});
