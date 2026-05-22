// Plan #18 A tests: auto-sync hook — wires startWatcher to a sync fn.
// Tests inject a fake ensureFresh so we don't need a real graph DB.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startAutoSync, AUTO_SYNC_ENV_VAR } from '../../../mcp/stdio/sync/auto-sync.js';

const liveLoops = [];
afterEach(() => {
  while (liveLoops.length) liveLoops.pop().stop();
});

function start(opts) {
  const loop = startAutoSync(opts);
  liveLoops.push(loop);
  return loop;
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-autosync-'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('startAutoSync arg validation', () => {
  it('throws when repoRoot missing', () => {
    expect(() => startAutoSync({ ensureFresh: async () => {} })).toThrow(/repoRoot/);
  });
  it('throws when ensureFresh missing', () => {
    expect(() => startAutoSync({ repoRoot: '/tmp' })).toThrow(/ensureFresh/);
  });
});

describe('startAutoSync opt-in gate', () => {
  it('returns status=disabled when APG_AUTO_SYNC is unset', () => {
    const loop = start({
      repoRoot: tmpRepo(),
      ensureFresh: async () => {},
      env: {} // no env var
    });
    expect(loop.status).toBe('disabled');
    expect(loop.reason).toMatch(/APG_AUTO_SYNC/);
  });

  it('returns status=disabled when APG_AUTO_SYNC is anything other than "1"', () => {
    const loop = start({
      repoRoot: tmpRepo(),
      ensureFresh: async () => {},
      env: { [AUTO_SYNC_ENV_VAR]: 'true' }
    });
    expect(loop.status).toBe('disabled');
  });

  it('starts when APG_AUTO_SYNC=1', () => {
    const loop = start({
      repoRoot: tmpRepo(),
      ensureFresh: async () => {},
      env: { [AUTO_SYNC_ENV_VAR]: '1' }
    });
    expect(['running', 'unsupported']).toContain(loop.status);
  });
});

describe('startAutoSync sync dispatch', () => {
  it('calls ensureFresh on a file change burst (debounced)', async () => {
    const dir = tmpRepo();
    const calls = [];
    const loop = start({
      repoRoot: dir,
      debounceMs: 80,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async ({ repoRoot }) => { calls.push(repoRoot); }
    });
    if (loop.status !== 'running') return; // platform doesn't support fs.watch
    // Write several files; expect one ensureFresh call (debounced burst)
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    await sleep(250);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThanOrEqual(2); // generous slack on slow CI
    expect(calls[0]).toBe(dir);
  });

  it('survives ensureFresh throwing (no crash, watcher stays alive)', async () => {
    const dir = tmpRepo();
    let calls = 0;
    const loop = start({
      repoRoot: dir,
      debounceMs: 80,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => { calls += 1; throw new Error('boom'); }
    });
    if (loop.status !== 'running') return;
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    await sleep(200);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    await sleep(200);
    // Second burst should still trigger another ensureFresh call —
    // catching the error must not silence subsequent dispatches.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('coalesces bursts during an in-flight sync (no concurrent ensureFresh)', async () => {
    const dir = tmpRepo();
    let concurrent = 0;
    let maxConcurrent = 0;
    let totalCalls = 0;
    const loop = start({
      repoRoot: dir,
      debounceMs: 30,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => {
        concurrent += 1;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        totalCalls += 1;
        await sleep(120); // simulate slow sync
        concurrent -= 1;
      }
    });
    if (loop.status !== 'running') return;
    // Drive a stream of bursts during the first sync to force coalescing
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i));
      await sleep(40);
    }
    await sleep(400);
    expect(maxConcurrent).toBe(1);
    expect(totalCalls).toBeGreaterThanOrEqual(1);
    expect(totalCalls).toBeLessThanOrEqual(3); // bursts coalesce, not 1-per-event
  });

  it('stop() halts further sync calls', async () => {
    const dir = tmpRepo();
    let calls = 0;
    const loop = start({
      repoRoot: dir,
      debounceMs: 50,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => { calls += 1; }
    });
    if (loop.status !== 'running') return;
    fs.writeFileSync(path.join(dir, 'first.txt'), '1');
    await sleep(150);
    const before = calls;
    loop.stop();
    fs.writeFileSync(path.join(dir, 'after.txt'), '2');
    await sleep(200);
    expect(calls).toBe(before);
  });
});
