import { mkdir } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { enrichLockError } from './lock-error.js';

// In-process lock coordination: when two verbs in the same MCP server
// process both call ensureFresh concurrently (legitimate — MCP dispatches
// requests asynchronously), they would both hit `proper-lockfile` and the
// second would fail with "already being held" because the first hasn't
// released yet. proper-lockfile is NOT re-entrant across async callers in
// the same process; the PID matches but the lockfile rejects overlap.
// Fix: queue concurrent same-repo requests in memory, so only one crosses
// into proper-lockfile at a time. Cross-process still uses the on-disk lock.
const inProcessQueues = new Map(); // repoRoot → Promise<void> (tail of queue)

export async function withWriteLock(repoRoot, fn) {
  const prior = inProcessQueues.get(repoRoot) ?? Promise.resolve();
  let resolveSlot;
  const slot = new Promise((r) => { resolveSlot = r; });
  const chained = prior.then(() => slot);
  inProcessQueues.set(repoRoot, chained);

  await prior.catch(() => {}); // wait for previous caller; don't inherit errors

  try {
    const graphDir = `${repoRoot.replace(/\\/g, '/')}/.aify-graph`;
    const lockPath = `${graphDir}/.write.lock`;
    await mkdir(graphDir, { recursive: true });
    const release = await lockfile.lock(lockPath, {
      realpath: false,
      stale: 3600000, // 1 hour — large repos take 10+ minutes on first index
      // Cross-process retry budget. Must survive a peer agent doing a
      // first-time full index (seconds on small repos, minutes on large
      // repos like echoes 250+ files). Previous 10 × (100..2000ms) =
      // ~9s total was too short for teams of 2+ agents racing the first
      // index. New budget: 40 retries × backoff (200..5000ms) gives
      // ~3 minutes of polite waiting — enough to cover typical first-index
      // cases while still timing out eventually on a truly stuck peer.
      retries: { retries: 40, factor: 1.5, minTimeout: 200, maxTimeout: 5000 },
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  } catch (err) {
    // ⛔ "Lock file is already being held" NAMES NO CAUSE, NO EXPIRY AND NO REMEDY, and a reader
    // who hits it has nowhere to go. Measured: a killed index (a timeout, a Ctrl-C, a crashed peer)
    // leaves the lock directory behind, and with `stale: 3600000` the repository is UNINDEXABLE FOR
    // UP TO AN HOUR while every attempt fails with that one sentence.
    //
    // The 1-hour window is correct — it protects a legitimately long first index from being stolen
    // by a peer. What was wrong is that the failure explained none of it.
    //
    // ⚠ ONE MORE VALUE IN A FIELD A READER ALREADY CONSULTS — the error message — not a new field.
    // And it states only what it can OBSERVE: the lock's age, when it becomes reclaimable, and the
    // path. It does NOT claim the holder is dead; a long index is indistinguishable from a crashed
    // one from here, and asserting otherwise would invite deleting a live peer's lock.
    throw enrichLockError(err, repoRoot);
  } finally {
    resolveSlot();
    // If no one queued behind us, remove the map entry to avoid leaking
    // resolved promise references. If someone did queue, they own the tail.
    if (inProcessQueues.get(repoRoot) === chained) {
      inProcessQueues.delete(repoRoot);
    }
  }
}
