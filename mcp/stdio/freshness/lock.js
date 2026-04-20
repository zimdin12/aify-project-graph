import { mkdir } from 'node:fs/promises';
import lockfile from 'proper-lockfile';

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
      // Cross-process retry budget. In-process concurrency is already
      // serialized by the queue above, so these retries only cover the case
      // where another OS process holds the lock.
      retries: { retries: 10, factor: 1.5, minTimeout: 100, maxTimeout: 2000 },
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  } finally {
    resolveSlot();
    // If no one queued behind us, remove the map entry to avoid leaking
    // resolved promise references. If someone did queue, they own the tail.
    if (inProcessQueues.get(repoRoot) === chained) {
      inProcessQueues.delete(repoRoot);
    }
  }
}
