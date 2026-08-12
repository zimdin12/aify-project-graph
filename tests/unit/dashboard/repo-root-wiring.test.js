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
vi.mock('../../../mcp/stdio/dashboard/server.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startDashboard: (args) => {
      started.push(args);
      // ⚠ The stub must honour the node http contract it is standing in for: close(cb)
      // INVOKES cb. The first version ignored it, and shutdown — which awaits that
      // callback — deadlocked the whole file. A stub that is unfaithful on the exact
      // method under test turns a real defect into a hang and hides both.
      return Promise.resolve({
        url: 'http://127.0.0.1:0',
        port: 0,
        server: { close: (cb) => { if (typeof cb === 'function') cb(); } },
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
