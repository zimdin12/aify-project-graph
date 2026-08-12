// THE DASHBOARD MUST INSPECT THE REPO IT WAS ASKED ABOUT, NOT THE ONE IT IS RUNNING IN.
//
// startDashboard defaults repoRoot to process.cwd(). For an MCP server that is the
// directory the HOST happened to launch it from — not the repo in the request. A
// dashboard that silently falls back to cwd serves another project's overlay and another
// project's source under the queried repo's name, and every panel looks plausible.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11 — the last of the wiring-shaped files.
//
// The previous version matched three regexes across two files, one of them
// `startDashboard\(\{[^}]*repoRoot[^}]*\}\)`. That pattern is satisfied by the identifier
// APPEARING between the braces: `startDashboard({ db, port, repoRoot: undefined })` passes
// it, and so does a call that passes a repoRoot the verb computed wrongly. It asserts the
// argument is mentioned, not that the right value arrives — and the defect is a wrong
// value, not a missing word.
//
// Both halves are checked here for real: the verb is observed passing its caller's
// repoRoot, and the server is observed serving that repo's bytes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// Captures what the verb actually hands the server. Nothing is asserted about the source
// text — only about the value that arrives.
const started = [];
// Lets a case park a start inside its await, so teardown can be raced against it.
let startDelay = null;
// Lets a case hold a server close open, so a second start can land mid-teardown.
let closeDelay = null;
// Lets a case make startDashboard throw, to exercise the startup-failure cleanup path.
let startFailure = null;
vi.mock('../../../mcp/stdio/dashboard/server.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startDashboard: async (args) => {
      started.push(args);
      if (startDelay) { const d = startDelay; startDelay = null; await d; }
      if (startFailure) { const e = startFailure; startFailure = null; throw e; }
      // ⚠ The stub must honour the node http contract it is standing in for: close(cb)
      // INVOKES cb. The first version ignored it, and shutdown — which awaits that
      // callback — deadlocked the whole file. A stub that is unfaithful on the exact
      // method under test turns a real defect into a hang and hides both.
      return Promise.resolve({
        url: 'http://127.0.0.1:0',
        port: 0,
        // ⚠ ONE-SHOT. A persistent closeDelay also gates the close a RELEASING start
        // performs on itself, which deadlocks the fixture — and that deadlock is what
        // stopped me writing the schedule where a start COMPLETES while teardown is still
        // running. Consuming the delay on first use lets exactly one close be held open.
        server: {
          close: (cb) => {
            const d = closeDelay;
            closeDelay = null;
            if (d) { d.then(() => { if (typeof cb === 'function') cb(); }); }
            else if (typeof cb === 'function') cb();
          },
        },
      });
    },
  };
});

const { graphDashboard, stopAllDashboards, activeDashboardCount } = await import('../../../mcp/stdio/query/verbs/dashboard.js');

// ⚠ The mock above replaces startDashboard for EVERY importer, including this file. The
// last two cases need the REAL server, so they take it via importActual — reaching for the
// plain import here would have quietly tested the stub against itself.
const { startDashboard } = await vi.importActual('../../../mcp/stdio/dashboard/server.js');

let repoRoot;
let running;
let db; // hoisted so a throw mid-case cannot strand the handle outside afterEach

// A file whose content exists ONLY in the fixture. If the dashboard falls back to cwd it
// cannot produce this line — it would read this test repo instead, or fail outright.
const CANARY = 'this line exists only in the fixture repo, never in the server cwd';

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-dashroot-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  await writeFile(join(repo, 'src', 'probe.cpp'), `${CANARY}\nsecond line\n`);
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  // /api/source refuses paths that are not indexed, so the node has to exist.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('p', 'File', 'probe', 'src/probe.cpp', 1, 2, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

// ⛔ CLEANUP THAT DOES NOT CLEAN UP LOOKS EXACTLY LIKE CLEANUP THAT DOES.
//
// graph-senior-dev-hermes found this on a GREEN run: the mocked case calls the real
// graphDashboard, which opens SQLite and files {db, server} in a module-global registry —
// and the mock's `close()` is a no-op, so nothing ever released the handle. Every
// repetition left an `apg-dashroot-*` directory on Windows; 72 accumulated across their
// probes. Linux hides it (an open file can be unlinked), which is worse, not better.
//
// ⚠⚠ MY FIRST REPAIR OF THIS WAS TEMPORALLY VACUOUS, and the ordering is the whole point.
//
// I recorded the removal failure into `removalError` inside afterEach, and asserted on it
// from a TEST BODY — which runs BEFORE afterEach. The assertion could only ever observe the
// initial `undefined`. graph-senior-dev-hermes replaced the teardown `rm()` with an
// unconditional throw caught into that variable: 5/5 GREEN. Teardown was still silently
// absorbing every failure.
//
// ⇒ Teardown must FAIL, not record. A cleanup error is reported by throwing out of
// afterEach, where vitest attributes it to the file — not stored for an assertion that has
// already run. Nothing here is allowed to swallow it.
afterEach(async () => {
  started.length = 0;
  startFailure = null;
  // Release the production registry FIRST — it owns the handle the fixture directory
  // depends on, and the real-server cases file entries there too.
  await stopAllDashboards();
  if (running) { await new Promise((r) => running.server.close(r)); running = undefined; }
  if (db) { try { db.close(); } catch { /* already closed */ } db = undefined; }
  const target = repoRoot;
  repoRoot = undefined;
  if (target) {
    // No try/catch. If a handle is still held the removal throws, and that throw IS the
    // report — on Windows it surfaces as EBUSY, which is precisely the leak symptom.
    await rm(target, { recursive: true, force: true });
  }
});

describe('the dashboard is wired to the repo it is inspecting', () => {
  it('★★ the verb hands the server the CALLER\'S repoRoot, not the process cwd', async () => {
    repoRoot = await makeRepo();
    await graphDashboard({ repoRoot, port: 0 });

    expect(started, 'harness sanity: the verb must have started a dashboard').toHaveLength(1);
    expect(started[0].repoRoot, 'the value must arrive, not merely the key').toBe(repoRoot);
    expect(started[0].repoRoot, 'and it must not be where the server happens to be running')
      .not.toBe(process.cwd());
  }, 20_000);

  it('★★ the handle it opens is RELEASABLE — a green response is not cleanup evidence', async () => {
    // dev's finding, as an assertion. graphDashboard opens SQLite and files it in a
    // module-global registry; before this there was no path that ever took it out, so
    // every call leaked a handle and every run stayed green. Their probes accumulated 72
    // stale fixture directories on Windows.
    //
    // ★ Asserted on the REGISTRY, not on the response. The response was always fine —
    // that is precisely why the leak survived. And the removal is checked for failure
    // rather than swallowed, since a swallowed rmdir error is how a held handle stays
    // invisible.
    repoRoot = await makeRepo();
    await graphDashboard({ repoRoot, port: 0 });

    expect(activeDashboardCount(), 'harness sanity: the call must register something').toBe(1);
    const released = await stopAllDashboards();
    expect(released, 'shutdown must report what it released').toBe(1);
    expect(activeDashboardCount(), 'the registry must actually drain').toBe(0);

    // With the handle released the fixture is removable — on Windows, where an open
    // SQLite file cannot be unlinked. This is the observable the leak actually produced.
    await rm(repoRoot, { recursive: true, force: true });
    repoRoot = undefined;
  }, 20_000);

  it('★★ a SECOND shutdown joins the first instead of racing it', async () => {
    // dev's addendum: concurrent calls were not joinable. The first cleared the registry
    // before any close completed, so the second returned 0 while live cleanup was still
    // running — a caller could believe teardown had finished when it had not. Both calls
    // must now describe the same completed work.
    repoRoot = await makeRepo();
    await graphDashboard({ repoRoot, port: 0 });
    expect(activeDashboardCount(), 'harness sanity: one dashboard must be registered').toBe(1);

    const [a, b] = await Promise.all([stopAllDashboards(), stopAllDashboards()]);
    expect(a, 'both callers see the same completed shutdown').toBe(1);
    expect(b).toBe(1);
    expect(activeDashboardCount(), 'and the registry is drained exactly once').toBe(0);
  }, 20_000);

  it('★★ a start IN FLIGHT during shutdown does not publish an orphan', async () => {
    // dev's schedule 1. graphDashboard used to register ownership only AFTER
    // `await startDashboard()` returned, so a start held at that await was invisible to
    // teardown: shutdown snapshotted an empty registry, reported 0/completed, and the
    // start then published a live server + DB that nothing would ever close.
    //
    // ★ The process-exit test opens a FULLY STARTED dashboard and structurally cannot see
    // this boundary — which is why it stayed green while the window was open.
    repoRoot = await makeRepo();
    let releaseStart;
    const held = new Promise((r) => { releaseStart = r; });
    started.length = 0;
    startDelay = held; // the mock awaits this before resolving

    const starting = graphDashboard({ repoRoot, port: 0 });
    // Teardown runs while the start is parked inside its await.
    await stopAllDashboards();
    releaseStart();
    const result = await starting;

    expect(activeDashboardCount(), 'nothing may be registered after teardown completed').toBe(0);
    expect(result?.status, 'the racing start must release itself, not publish')
      .toBe('shutting_down');
  }, 20_000);

  it('★★ a shutdown does not ERASE a dashboard that started after its snapshot', async () => {
    // dev's schedule 2. The old teardown ended with an unconditional
    // `activeDashboards.clear()`, so a dashboard registered after the snapshot was dropped
    // from the registry WITHOUT its server or DB ever being closed. Erasing a resource is
    // not releasing it, and from outside the two are indistinguishable.
    repoRoot = await makeRepo();
    await graphDashboard({ repoRoot, port: 0 });
    expect(activeDashboardCount()).toBe(1);

    // ⚠ B must register WHILE A is closing, not after teardown finishes. My first version
    // started B afterwards, which an unconditional clear() cannot affect — so the mutant
    // survived and the case proved nothing. Holding A's close open creates the real window.
    let releaseClose;
    closeDelay = new Promise((r) => { releaseClose = r; });

    const tearing = stopAllDashboards();          // parks inside A's server.close
    const second = await makeRepo();
    try {
      // ⚠ NOT awaited before the release: B's own close now uses the same held promise, so
      // awaiting here deadlocks the fixture. That deadlock is a property of my mock, not of
      // production — but it is exactly the kind of self-inflicted hang that looks like a
      // product bug, so it is worth naming.
      const startingB = graphDashboard({ repoRoot: second, port: 0 });
      releaseClose();
      const closed = await tearing;
      const resultB = await startingB;

      expect(closed, 'the snapshotted dashboard was closed').toBe(1);

      // ⇒ CORRECTED EXPECTATION. My first version asserted B must SURVIVE. dev's A2 shows
      // that is wrong: a start completing while a teardown is ACTIVE is orphaned relative
      // to that teardown — the snapshot cannot contain it, so nothing in that teardown
      // will ever close it. It must release itself, not publish.
      expect(resultB?.status, 'a start completing during teardown must not publish')
        .toBe('shutting_down');
      expect(activeDashboardCount(), 'and must leave nothing registered').toBe(0);
    } finally {
      closeDelay = null;
      await rm(second, { recursive: true, force: true });
    }
  }, 20_000);

  it('★★ a SECOND same-key call joins the in-flight start, it is not told a lie', async () => {
    // dev's A1: the reservation marker was read as a completed dashboard, so a second
    // same-key call settled early with `status:'already_running'` and url/port UNDEFINED.
    // The caller was handed a success it could not use — worse than an error, because an
    // error is actionable and this looks like it worked.
    repoRoot = await makeRepo();
    let releaseStart;
    startDelay = new Promise((r) => { releaseStart = r; });

    const first = graphDashboard({ repoRoot, port: 0 });
    // ⚠ SEQUENCING IS THE TEST. Issuing both calls back-to-back does NOT create the race:
    // graphDashboard awaits freshness before registering its marker, so the second call
    // can read an empty registry and simply start its own. Both of dev's mutants survived
    // my first version for exactly that reason — the schedule I meant to exercise never
    // occurred. Waiting until the marker EXISTS is what makes the second call a joiner.
    await vi.waitFor(() => expect(started.length).toBe(1), { timeout: 5000 });
    const second = graphDashboard({ repoRoot, port: 0 });   // arrives while first is parked
    // ⚠ And the joiner needs time to GET to the registry read. graphDashboard awaits
    // freshness first, so releasing immediately let the first call finish and the second
    // find a COMPLETED entry — the join branch never executed and both of dev's mutants
    // survived a test that looked like it covered them. Draining the microtask queue is
    // what puts the second call inside the window.
    // A real delay, not microtasks: inspectReadFreshness does file and git I/O, so the
    // joiner needs wall-clock time to reach the registry read while the first is parked.
    await new Promise((r) => setTimeout(r, 250));
    releaseStart();
    const [a, b] = await Promise.all([first, second]);

    expect(a?.status, 'the first call starts it').toBe('running');
    expect(b?.url, 'the joiner must receive a usable url, never undefined').toBeTruthy();
    expect(b?.url, 'and it must be the SAME dashboard, not a second one').toBe(a.url);
    expect(started, 'exactly one start may occur per key').toHaveLength(1);
  }, 20_000);

  it('★★ a start COMPLETING while teardown is still running releases itself', async () => {
    // ⛔ SELF-REVIEW SURVIVOR D3. My existing cases all let teardown FINISH before the
    // racing start resumes, so the generation had already moved and the generation check
    // alone caught them. Removing the shutdown-ACTIVE check survived every one of them.
    //
    // ⇒ This is the schedule that needs it: teardown is still closing (generation NOT yet
    // advanced) when a new-key start completes. Without the active check it publishes into
    // a registry whose snapshot cannot contain it, so nothing in that teardown will ever
    // release it.
    repoRoot = await makeRepo();
    await graphDashboard({ repoRoot, port: 0 });

    let releaseClose;
    closeDelay = new Promise((r) => { releaseClose = r; });   // one-shot: holds A's close
    const tearing = stopAllDashboards();

    const second = await makeRepo();
    try {
      // B starts AND completes while teardown is parked. Its own close is not gated,
      // because the delay was consumed by A.
      const resultB = await graphDashboard({ repoRoot: second, port: 0 });

      expect(resultB?.status, 'a start finishing mid-teardown must release itself')
        .toBe('shutting_down');
      // ⚠ A is STILL registered here — teardown is parked inside its close, which is
      // correct. My first assertion demanded 0 and failed against working code: I was
      // asserting the end state at a moment that is deliberately mid-flight. What matters
      // is that B added NOTHING to the one entry already being released.
      expect(activeDashboardCount(), 'B must not have registered; only A remains, mid-close')
        .toBe(1);

      releaseClose();
      await tearing;
      expect(activeDashboardCount(), 'teardown completes with nothing left').toBe(0);
    } finally {
      closeDelay = null;
      await rm(second, { recursive: true, force: true });
    }
  }, 20_000);

  it('★★ a startup failure reports the STARTUP cause, not the cleanup error', async () => {
    // ⛔ SELF-REVIEW SURVIVOR D8 — dev reported this and I fixed it with no test at all,
    // so the fix was carried by nothing. `startDashboard` throwing "listen failed"
    // followed by a throwing db.close() must still surface the listen failure: the caller
    // needs the fire, not the janitor.
    repoRoot = await makeRepo();
    startFailure = new Error('listen failed');

    await expect(graphDashboard({ repoRoot, port: 0 }), 'the startup cause must propagate')
      .rejects.toThrow(/listen failed/);
    expect(activeDashboardCount(), 'and the reservation must not outlive the failed start')
      .toBe(0);
  }, 20_000);

  it('★★ an explicitly-rooted server serves THAT repo\'s bytes', async () => {
    // The half the old file could only gesture at with /resolve\(repoRoot, rel\)/. That
    // regex is true of code that resolves against repoRoot and then reads somewhere else.
    // Fetching the canary is not.
    repoRoot = await makeRepo();
    db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    running = await startDashboard({ db, port: 0, repoRoot });

    const res = await fetch(`${running.url}/api/source?path=src/probe.cpp&from=1&to=2`);
    const body = await res.json();

    expect(body.error, `the fixture file must be readable: ${JSON.stringify(body)}`).toBeUndefined();
    expect(body.lines?.[0], 'served from the fixture, not from cwd').toBe(CANARY);
  }, 20_000);

  it('★ refuses a path that escapes the configured root', async () => {
    // The containment check is what makes an explicit root meaningful. Without it the
    // wiring is decoration: any caller could read outside the repo it named.
    repoRoot = await makeRepo();
    db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Indexed under a traversing path, so the not_indexed guard cannot be what stops it —
    // the containment check has to be.
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ('esc', 'File', 'esc', '../../../etc/passwd', 1, 2, 'cpp', 1, '{}')`,
    );
    running = await startDashboard({ db, port: 0, repoRoot });

    const res = await fetch(`${running.url}/api/source?path=../../../etc/passwd&from=1&to=2`);
    const body = await res.json();

    expect(body.lines, 'nothing outside the root may be served').toBeUndefined();
    expect(body.error).toBe('out_of_tree');
  }, 20_000);
});
