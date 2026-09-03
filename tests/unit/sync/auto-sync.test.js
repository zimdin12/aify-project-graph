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
    // THE invariant this test exists for: never two ensureFresh runs at once.
    // Strict — a regression here is a real concurrency bug.
    expect(maxConcurrent).toBe(1);
    expect(totalCalls).toBeGreaterThanOrEqual(1);
    // Coalescing means FEWER syncs than file events. The previous bound (<=3)
    // was a timing-derived proxy: with 6 events at 40ms spacing against a 30ms
    // debounce and a 120ms sync, the exact count depends on scheduler latency,
    // so it failed intermittently under full-suite CPU contention while passing
    // standalone. `< events` is the actual definition of coalescing and is
    // robust; the strict maxConcurrent check above is what guards the real bug.
    expect(totalCalls).toBeLessThan(6);
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

// ⛔ M3a BLOCKER 2 — DOES A WRITE ARRIVING MID-SYNC GET LOST?
//
// Coalescing is only safe if the FINAL run sees the FINAL state. The test above counts syncs and
// pins `maxConcurrent === 1`; neither says anything about whether the last edit was ever read. A
// coalescer that dropped the trailing burst would satisfy both perfectly — "fewer syncs than
// events" is exactly what losing an update looks like through a call counter.
//
// ⚠ WHY THE WRITE HAPPENS INSIDE ensureFresh. The field probe of 2026-09-02 tried to answer this
// against the real indexer by writing files on a timer, and NEVER ACHIEVED OVERLAP: every index
// finished inside the gap, its deciding control reported false, and it correctly concluded nothing.
// Its first run showed "4 lost updates", and publishing that would have been wrong. Writing from
// within the in-flight sync makes the overlap a CONSTRUCTION rather than a race the scheduler has
// to win — which also stops this test flaking under full-suite CPU contention, as the sibling
// timing-derived assertion above once did.
//
// ⛔ WHAT THIS DOES NOT COVER, plainly: the injected sync is not the real `ensureFresh`, so this is
// a property of the COALESCER, not of the indexer beneath it. Blocker 2 also names sustained
// editing on a large C++ repo, which no unit test reaches.
describe('coalescing must not lose a write that lands mid-sync', () => {
  it('★★★ a file written DURING a sync is seen by a later sync', async () => {
    const dir = tmpRepo();
    const snapshots = [];
    const written = ['first.txt'];
    let injected = false;

    const loop = start({
      repoRoot: dir,
      debounceMs: 10,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => {
        // What the indexer WOULD see, captured as this sync begins.
        snapshots.push(new Set(fs.readdirSync(dir)));
        if (!injected) {
          injected = true;
          // The whole point: this write happens while a sync is in flight.
          fs.writeFileSync(path.join(dir, 'late.txt'), 'late');
          written.push('late.txt');
        }
        await sleep(200);
      },
    });

    // ⛔ ASSERT, DO NOT SILENTLY SKIP. The sibling tests `return` when the watcher is unsupported,
    // which turns an unsupported platform into a green pass — vacuous, and indistinguishable from a
    // real one. If fs.watch cannot run here, this must say so out loud.
    expect(loop.status, 'the watcher must be running or this test proves nothing').toBe('running');

    fs.writeFileSync(path.join(dir, 'first.txt'), 'first');
    await sleep(900);

    // CONTROL 1: a second sync happened at all. Without it the assertion below is vacuous.
    expect(snapshots.length, 'only one sync ran, so nothing could have observed the late write')
      .toBeGreaterThanOrEqual(2);

    // CONTROL 2: the first sync really did run BEFORE the late write — otherwise there was no
    // mid-sync arrival to lose, and this measures nothing.
    expect(snapshots[0].has('late.txt'),
      'the first sync already saw the late write, so no overlap was constructed').toBe(false);

    // THE PROPERTY: whatever was coalesced away, a later sync still observed the final state.
    const last = snapshots[snapshots.length - 1];
    const missed = written.filter((name) => !last.has(name));
    expect(missed, 'a write landed during a sync and no later sync ever observed it — a lost update')
      .toEqual([]);
  });
});

// ⛔ maxWaitMs MUST REACH THE WATCHER, NOT JUST BE ACCEPTED HERE.
//
// startAutoSync used to call startWatcher without it. An option accepted at the front door and
// dropped on the way is the failure mode this repo keeps meeting: the max-wait experiment would have
// run four arms that all behaved like `off` and produced a confident table of identical rows.
//
// ⚠ ASSERTED BEHAVIOURALLY, NOT BY SPYING ON THE ARGUMENT. Checking that the property was passed
// proves the wiring and not the effect; a test that watches a burst flush mid-stream fails if the
// value is dropped ANYWHERE between here and the timer.
describe('startAutoSync forwards maxWaitMs to the watcher', () => {
  it('⛔ CONTROL: without maxWaitMs a continuous burst never syncs mid-burst', async () => {
    const dir = tmpRepo();
    let syncs = 0;
    const loop = start({
      repoRoot: dir,
      debounceMs: 300,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => { syncs += 1; },
    });
    expect(loop.status, 'the watcher must be running or this proves nothing').toBe('running');
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 1200) {
      fs.writeFileSync(path.join(dir, `n${n += 1}.txt`), String(n));
      await sleep(60);
    }
    expect(n, 'the burst must have been continuous').toBeGreaterThan(5);
    expect(syncs, 'no maxWait: the timer keeps resetting, so nothing may fire mid-burst').toBe(0);
  }, 30_000);

  it('★★★ with maxWaitMs the same burst DOES sync while it is still running', async () => {
    const dir = tmpRepo();
    let syncs = 0;
    const loop = start({
      repoRoot: dir,
      debounceMs: 300,
      maxWaitMs: 250,
      env: { [AUTO_SYNC_ENV_VAR]: '1' },
      ensureFresh: async () => { syncs += 1; },
    });
    expect(loop.status).toBe('running');
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 1200) {
      fs.writeFileSync(path.join(dir, `m${n += 1}.txt`), String(n));
      await sleep(60);
    }
    expect(syncs, 'maxWaitMs never reached the watcher').toBeGreaterThanOrEqual(1);
  }, 30_000);
});
