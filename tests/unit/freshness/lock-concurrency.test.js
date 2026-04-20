// Regression test for the 2026-04-21 "Lock file is already being held" bug:
// two ensureFresh-using verbs called concurrently in the same MCP server
// process both hit proper-lockfile, second one failed because the retry
// budget (5 × ~250ms) was shorter than typical ensureFresh runtime.
//
// Fix: in-process queue serializes same-repo callers before they reach
// proper-lockfile, so concurrent verbs in one process never race each other.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withWriteLock } from '../../../mcp/stdio/freshness/lock.js';

describe('withWriteLock — in-process concurrency', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-lock-'));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('serializes concurrent same-repo callers without "already held" errors', async () => {
    // Simulate the real pattern: three slow verbs fired back-to-back from
    // the same MCP server process. Before the fix, the second/third would
    // reject with "Lock file is already being held". After the fix, they
    // queue and each runs in order.
    const order = [];
    const slow = (label, ms) => () =>
      new Promise((r) => setTimeout(() => { order.push(label); r(label); }, ms));

    const results = await Promise.all([
      withWriteLock(repoRoot, slow('a', 40)),
      withWriteLock(repoRoot, slow('b', 20)),
      withWriteLock(repoRoot, slow('c', 10)),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    // Order in `order` reflects execution order, which must be the submission
    // order because the queue is FIFO.
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('releases the lock even when the callback throws', async () => {
    await expect(
      withWriteLock(repoRoot, async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    // The next caller must still acquire without "already held".
    const result = await withWriteLock(repoRoot, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('handles 4 concurrent callers in sequence without collision', async () => {
    // Simulates the "4 agents working in one folder" scenario at the
    // in-process level. Each caller must serialize; none can error out.
    const started = [];
    const ended = [];
    const slow = (label, ms) => async () => {
      started.push(label);
      await new Promise((r) => setTimeout(r, ms));
      ended.push(label);
      return label;
    };

    const results = await Promise.all([
      withWriteLock(repoRoot, slow('a', 15)),
      withWriteLock(repoRoot, slow('b', 15)),
      withWriteLock(repoRoot, slow('c', 15)),
      withWriteLock(repoRoot, slow('d', 15)),
    ]);

    expect(results).toEqual(['a', 'b', 'c', 'd']);
    // Critical serialization property: each caller finishes before the next starts.
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(ended).toEqual(['a', 'b', 'c', 'd']);
  });
});
