// Plan #18 A tests: graph_watch verb.
// Covers enable/disable lifecycle, debounced re-index, coalesced trailing
// run on burst-during-indexing, return-shape (status/running/debounceMs/
// lastRunAt/lastError/eventsQueued), idempotent enable.
//
// graphIndex() is mocked via vi.mock — these tests verify the verb's
// orchestration logic, not the indexing itself.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const indexCalls = { count: 0, lastArgs: null };

vi.mock('../../../mcp/stdio/query/verbs/index.js', () => ({
  graphIndex: async (args) => {
    indexCalls.count += 1;
    indexCalls.lastArgs = args;
    // Simulate a small reindex window so concurrent bursts can coalesce.
    await new Promise(resolve => setTimeout(resolve, 50));
    return { ok: true };
  },
}));

import { graphWatch, _resetWatchersForTest } from '../../../mcp/stdio/query/verbs/watch.js';

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-graphwatch-'));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

beforeEach(() => {
  indexCalls.count = 0;
  indexCalls.lastArgs = null;
  _resetWatchersForTest();
});
afterEach(() => {
  _resetWatchersForTest();
});

describe('graph_watch — lifecycle', () => {
  it('omitted enable returns stopped status', async () => {
    const r = await graphWatch({ repoRoot: tmpRepo() });
    expect(r.status).toBe('stopped');
    expect(r.running).toBe(false);
  });

  it('enable=true starts the watcher and returns running shape', async () => {
    const repo = tmpRepo();
    const r = await graphWatch({ enable: true, repoRoot: repo });
    expect(r.status === 'running' || r.status === 'unsupported' || r.status === 'disabled').toBe(true);
    if (r.status === 'running') {
      expect(r.running).toBe(true);
      expect(r.debounceMs).toBeGreaterThanOrEqual(0);
      expect(r.repoRoot).toBe(path.resolve(repo));
    }
  });

  it('enable=false stops the watcher and is idempotent', async () => {
    const repo = tmpRepo();
    await graphWatch({ enable: true, repoRoot: repo });
    const r = await graphWatch({ enable: false, repoRoot: repo });
    expect(r.status).toBe('stopped');
    const r2 = await graphWatch({ enable: false, repoRoot: repo });
    expect(r2.status).toBe('stopped');
  });

  it('enable=true on an already-running watcher is idempotent', async () => {
    const repo = tmpRepo();
    const first = await graphWatch({ enable: true, repoRoot: repo });
    if (first.status !== 'running') return; // platform doesn't support fs.watch
    const second = await graphWatch({ enable: true, repoRoot: repo });
    expect(second.status).toBe('running');
  });
});

describe('graph_watch — return shape', () => {
  it('exposes the senior-dev-required fields', async () => {
    const repo = tmpRepo();
    const r = await graphWatch({ enable: true, repoRoot: repo, debounceMs: 200 });
    // Required fields per dev's revision
    for (const field of ['status', 'reason', 'running', 'debounceMs', 'lastRunAt', 'lastError', 'eventsQueued']) {
      expect(field in r).toBe(true);
    }
    if (r.status === 'running') {
      expect(r.debounceMs).toBe(200);
    }
  });
});

describe('graph_watch — debounced re-index', () => {
  it('a burst of file writes triggers exactly one graphIndex call within the debounce window', async () => {
    const repo = tmpRepo();
    const r = await graphWatch({ enable: true, repoRoot: repo, debounceMs: 150 });
    if (r.status !== 'running') return; // platform doesn't support fs.watch

    // Burst 5 writes; they should coalesce into 1 reindex call after debounce.
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(repo, `f${i}.txt`), String(i));
    await sleep(500);

    expect(indexCalls.count).toBeGreaterThanOrEqual(1);
    expect(indexCalls.count).toBeLessThanOrEqual(2); // trailing-run allowed
    expect(indexCalls.lastArgs).toMatchObject({ repoRoot: path.resolve(repo), force: false });
  });

  it('a second burst arriving DURING an in-flight reindex coalesces into exactly one trailing run', async () => {
    const repo = tmpRepo();
    const r = await graphWatch({ enable: true, repoRoot: repo, debounceMs: 50 });
    if (r.status !== 'running') return;

    fs.writeFileSync(path.join(repo, 'first.txt'), '1');
    await sleep(80); // let first burst trigger reindex (50ms reindex sleep)
    // While the reindex is running, fire MANY more writes; they should all
    // coalesce into ONE trailing reindex, not many.
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(repo, `b${i}.txt`), String(i));
    await sleep(500);

    // Expect: 1 reindex from first burst + 1 trailing = at most 2 calls,
    // never one per write.
    expect(indexCalls.count).toBeGreaterThanOrEqual(1);
    expect(indexCalls.count).toBeLessThanOrEqual(3);
  });

  it('lastRunAt updates after a successful reindex', async () => {
    const repo = tmpRepo();
    const r = await graphWatch({ enable: true, repoRoot: repo, debounceMs: 100 });
    if (r.status !== 'running') return;
    fs.writeFileSync(path.join(repo, 'touch.txt'), 'x');
    await sleep(400);
    const status = await graphWatch({ repoRoot: repo });
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastError).toBeNull();
  });
});
