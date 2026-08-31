import { describe, it, expect, vi, afterEach } from 'vitest';

const state = {
  starts: [],
  dbs: [],
  freshness: { warnings: [] },
  startImpl: null,
  dbImpl: null,
};

vi.mock('../../../mcp/stdio/query/verbs/read_freshness.js', () => ({
  inspectReadFreshness: async () => state.freshness,
}));
vi.mock('../../../mcp/stdio/storage/db.js', () => ({
  openExistingDb: (...args) => {
    const db = state.dbImpl ? state.dbImpl(...args) : { close: vi.fn() };
    state.dbs.push(db);
    return db;
  },
}));
vi.mock('../../../mcp/stdio/dashboard/server.js', () => ({
  startDashboard: (...args) => {
    state.starts.push(args);
    return state.startImpl(...args);
  },
}));

const { graphDashboard, stopAllDashboards, activeDashboardCount } =
  await import('../../../mcp/stdio/query/verbs/dashboard.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function drain() {
  await stopAllDashboards();
  state.starts.length = 0;
  state.dbs.length = 0;
  state.freshness = { warnings: [] };
  state.startImpl = null;
  state.dbImpl = null;
}
afterEach(drain);

describe('withheld shutdown anti-targets', () => {
  it('startup failure remains primary when cleanup also throws', async () => {
    const startup = new Error('STARTUP_PRIMARY');
    state.dbImpl = () => ({ close: () => { throw new Error('CLEANUP_SECONDARY'); } });
    state.startImpl = async () => { throw startup; };
    await expect(graphDashboard({ repoRoot: 'startup-fail', port: 1 })).rejects.toBe(startup);
    expect(activeDashboardCount()).toBe(0);
  });

  it('joins second and third stop by exact promise identity; callback+promise rejection and db throw do not strand registry', async () => {
    const callbackGate = deferred();
    state.startImpl = async () => ({
      url: 'u', port: 1,
      server: { close: (cb) => { callbackGate.promise.then(cb); return Promise.reject(new Error('promise close failed')); } },
    });
    state.dbImpl = () => ({ close: () => { throw new Error('db cleanup failed'); } });
    await graphDashboard({ repoRoot: 'identity', port: 1 });
    const a = stopAllDashboards();
    const b = stopAllDashboards();
    const c = stopAllDashboards();
    expect(b).toBe(a);
    expect(c).toBe(a);
    callbackGate.resolve();
    await expect(a).resolves.toBe(1);
    expect(activeDashboardCount()).toBe(0);
  });

  it('uses one global deadline for multiple callback-never-closes', async () => {
    state.startImpl = async () => ({ url: 'u', port: 1, server: { close: () => undefined } });
    await graphDashboard({ repoRoot: 'deadline-a', port: 1 });
    await graphDashboard({ repoRoot: 'deadline-b', port: 1 });
    const t0 = Date.now();
    await expect(stopAllDashboards()).resolves.toBe(2);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(1800);
    expect(elapsed).toBeLessThan(3000);
  }, 5000);

  it('does not publish a dashboard after a shutdown that raced its start', async () => {
    const startGate = deferred();
    state.startImpl = () => startGate.promise;
    const starting = graphDashboard({ repoRoot: 'start-race', port: 1 });
    await vi.waitFor(() => expect(state.starts).toHaveLength(1));

    await expect(stopAllDashboards()).resolves.toBe(0);
    startGate.resolve({ url: 'u', port: 1, server: { close: (cb) => cb?.() } });
    await starting;

    expect(activeDashboardCount(), 'shutdown completion must be a barrier against an earlier start').toBe(0);
  });

  it('closes a dashboard that becomes active while another dashboard shutdown is in flight', async () => {
    const oldCloseGate = deferred();
    const lateClose = vi.fn((cb) => cb?.());
    state.startImpl = async () => ({
      url: 'old', port: 1,
      server: { close: (cb) => { oldCloseGate.promise.then(cb); } },
    });
    await graphDashboard({ repoRoot: 'old', port: 1 });

    const stopping = stopAllDashboards();
    state.startImpl = async () => ({ url: 'late', port: 2, server: { close: lateClose } });
    await graphDashboard({ repoRoot: 'late', port: 2 });
    oldCloseGate.resolve();
    await stopping;

    expect(lateClose, 'a late listener must not be erased from ownership without close').toHaveBeenCalledOnce();
    expect(activeDashboardCount()).toBe(0);
  });
});
