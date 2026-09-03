// ⛔ A DEBOUNCE WITH NO CEILING STARVES, AND THAT WAS MEASURED BEFORE IT WAS FIXED.
//
// `queueEvent` cancels the pending flush on every event. While events arrive closer together than
// `debounceMs` the burst therefore never flushes at all — 229 edits over 60 s produced ONE sync, and
// that one ran only after editing stopped
// (docs/evidence/m3-freshness/FINDING-debounce-starves-under-continuous-editing.md).
//
// `maxWaitMs` bounds the delay from the burst's FIRST event. These tests pin both directions,
// because only one of them is the new behaviour and the other is what the experiment's control arm
// stands on: with maxWaitMs off, starvation must still happen exactly as before.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startWatcher } from '../../../mcp/stdio/sync/watcher.js';

const live = [];
afterEach(() => { while (live.length) live.pop().stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(opts) {
  const w = startWatcher(opts);
  live.push(w);
  return w;
}

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-maxwait-'));
}

/**
 * Write a file every `everyMs` for `forMs`, so events keep arriving inside the debounce window.
 * Returns the flush timestamps observed while that was happening.
 */
async function drive({ maxWaitMs, debounceMs = 300, everyMs = 60, forMs = 1200 }) {
  const dir = tmpRepo();
  const flushes = [];
  const w = start({
    repoRoot: dir,
    debounceMs,
    maxWaitMs,
    onChange: () => { flushes.push(Date.now()); },
  });
  // ⛔ ASSERT rather than skip. The sibling suites `return` when the watcher is unsupported, which
  // turns an unsupported platform into a green pass indistinguishable from a real one.
  expect(w.status, 'the watcher must be running or this test proves nothing').toBe('running');

  const start0 = Date.now();
  let n = 0;
  while (Date.now() - start0 < forMs) {
    fs.writeFileSync(path.join(dir, `f${n += 1}.txt`), String(n));
    await sleep(everyMs);
  }
  const duringBurst = flushes.length;
  await sleep(debounceMs + 400); // let the trailing flush land
  return { duringBurst, total: flushes.length, writes: n };
}

describe('maxWaitMs bounds how long a continuous burst can suppress the flush', () => {
  it('⛔ CONTROL: with maxWaitMs OFF, a continuous burst still starves — the old behaviour, intact', async () => {
    // This is not a nice-to-have. The preregistered experiment's W=off arm IS this behaviour, and if
    // adding the option quietly changed the default there would be no baseline to compare against.
    const r = await drive({ maxWaitMs: null });
    expect(r.writes, 'the burst must actually have been continuous').toBeGreaterThan(5);
    expect(r.duringBurst, 'events kept resetting the timer, so nothing may flush mid-burst').toBe(0);
    expect(r.total, 'and the trailing flush must still arrive once the burst ends').toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('★★★ with maxWaitMs set, the burst flushes WHILE it is still going', async () => {
    const r = await drive({ maxWaitMs: 250 });
    expect(r.writes).toBeGreaterThan(5);
    expect(r.duringBurst, 'a bounded wait must produce at least one flush during a 1.2 s burst')
      .toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('⛔ maxWaitMs never DELAYS a flush past the plain debounce', async () => {
    // The clamp is Math.min(debounceMs, ...). A single event with a large maxWaitMs must still flush
    // on the ordinary debounce — otherwise the option would make a quiet repo LESS fresh, which is
    // the opposite of its purpose.
    const dir = tmpRepo();
    const flushes = [];
    const w = start({
      repoRoot: dir,
      debounceMs: 200,
      maxWaitMs: 10_000,
      onChange: () => { flushes.push(Date.now()); },
    });
    expect(w.status).toBe('running');
    fs.writeFileSync(path.join(dir, 'once.txt'), 'x');
    await sleep(900);
    expect(flushes.length, 'one event, long maxWait: the debounce must still fire').toBeGreaterThanOrEqual(1);
  }, 30_000);
});
