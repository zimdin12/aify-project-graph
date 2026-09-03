// WHAT DOES A MAXIMUM WAIT COST, AND WHAT DOES IT BUY?
//
// ⛔ READ docs/evidence/m3-freshness/PREREGISTRATION-watcher-max-wait.md FIRST. The arms, the two
// reported quantities, the decision rule, the controls and the abandon rule were all fixed before
// this file existed.
//
// ⭐ THIS REPORTS A TRADE, NOT A COST. A max-wait buys bounded STALENESS and spends DUTY CYCLE.
// Reporting only the cost would make "off" win every time by construction, which is how a
// measurement smuggles in a decision.
//
// STALENESS is the agent-facing quantity: wall time between an edit landing on disk and a sync that
// began after it. Reported as the MAXIMUM over the run — a mean hides exactly the interval that
// hurts, which is the long one.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SOURCE = process.env.APG_PROBE_SOURCE_REPO ?? process.cwd();
const EDIT_EVERY_MS = 250;
const EDIT_FOR_MS = Number(process.env.APG_PROBE_EDIT_MS ?? 60_000);
const ARMS = [null, 5_000, 15_000, 30_000]; // W = off, 5 s, 15 s, 30 s — preregistered

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);

const workdir = mkdtempSync(join(tmpdir(), 'apg-maxwait-probe-'));
const results = [];

try {
  const { startAutoSync, AUTO_SYNC_ENV_VAR } = await import('../mcp/stdio/sync/auto-sync.js');
  const { ensureFresh } = await import('../mcp/stdio/freshness/orchestrator.js');
  const { openExistingDb } = await import('../mcp/stdio/storage/db.js');

  // CONTROL: the CPU meter can see cost. A blind meter makes every low number below unreadable.
  const meter0 = process.cpuUsage();
  const spin = Date.now() + 500;
  while (Date.now() < spin) { /* deliberate busy loop */ }
  const meterMs = (() => { const c = process.cpuUsage(meter0); return (c.user + c.system) / 1000; })();
  say(`METER control: ${meterMs.toFixed(0)} ms CPU for a 500 ms busy loop  ${meterMs > 100 ? 'PASS' : 'FAIL'}`);
  say('');

  for (const W of ARMS) {
    const label = W === null ? 'off' : `${W / 1000}s`;
    const repo = join(workdir, `arm-${label}`);
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', SOURCE, repo], { stdio: 'pipe' });
    const target = join(repo, 'mcp/stdio/sync/watcher.js');
    if (!existsSync(target)) throw new Error(`probe target missing: ${target}`);
    const original = readFileSync(target, 'utf8');

    say(`--- ARM W=${label} : building the initial graph (not measured) ...`);
    await ensureFresh({ repoRoot: repo, force: true });

    const syncs = [];
    let inFlight = 0;
    let lastEditAt = null;      // when the most recent unobserved edit landed
    let maxStalenessMs = 0;

    const instrumented = async (args) => {
      inFlight += 1;
      const startedAt = Date.now();
      // Any edit that landed before this sync began is observed by it.
      if (lastEditAt !== null) {
        maxStalenessMs = Math.max(maxStalenessMs, startedAt - lastEditAt);
        lastEditAt = null;
      }
      try { return await ensureFresh(args); }
      finally { syncs.push({ startedAt, ms: Date.now() - startedAt }); inFlight -= 1; }
    };

    const loop = startAutoSync({
      repoRoot: repo,
      ensureFresh: instrumented,
      maxWaitMs: W,
      env: { ...process.env, [AUTO_SYNC_ENV_VAR]: '1' },
    });
    if (loop.status !== 'running') throw new Error(`watcher not running: ${loop.status}`);

    const cpu0 = process.cpuUsage();
    const t0 = Date.now();
    let edits = 0;
    let busyMs = 0;
    let lastTick = Date.now();
    while (Date.now() - t0 < EDIT_FOR_MS) {
      edits += 1;
      writeFileSync(target, `${original}\nexport function probeFn${edits}() { return ${edits}; }\n`);
      lastEditAt = Date.now();
      await sleep(EDIT_EVERY_MS);
      const nowTick = Date.now();
      if (inFlight > 0) busyMs += nowTick - lastTick;
      lastTick = nowTick;
    }
    const editingEndedAt = Date.now();

    // Drain, so the final state is indexed before the presence control below.
    while (Date.now() - editingEndedAt < 90_000) {
      await sleep(200);
      if (inFlight === 0 && syncs.length && Date.now() - syncs[syncs.length - 1].startedAt - syncs[syncs.length - 1].ms > 2000) break;
    }
    if (lastEditAt !== null) maxStalenessMs = Math.max(maxStalenessMs, Date.now() - lastEditAt);
    const cpu = process.cpuUsage(cpu0);
    loop.stop();

    // CONTROL: the last edit is actually IN the graph. An arm that is cheap because it indexed
    // nothing must not read as a cheap arm.
    const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
    let present = 0;
    try { present = db.get(`SELECT COUNT(*) AS c FROM nodes WHERE label = $l`, { l: `probeFn${edits}` })?.c ?? 0; }
    finally { db.close?.(); }

    const editingWall = editingEndedAt - t0;
    const duty = (busyMs / editingWall) * 100;
    const meanSync = syncs.length ? syncs.reduce((a, s) => a + s.ms, 0) / syncs.length : null;
    const duringBurst = syncs.filter((s) => s.startedAt < editingEndedAt).length;

    results.push({ label, W, edits, syncs: syncs.length, duringBurst, duty, meanSync, maxStalenessMs, present,
      cpuMs: (cpu.user + cpu.system) / 1000 });
    say(`    edits=${edits} syncs=${syncs.length} (during burst ${duringBurst}) duty=${duty.toFixed(1)}%`
      + ` meanSync=${meanSync === null ? 'n/a' : meanSync.toFixed(0) + 'ms'}`
      + ` maxStale=${(maxStalenessMs / 1000).toFixed(1)}s lastEditIndexed=${present > 0}`);
  }

  // ---- REPORT ----------------------------------------------------------------------------------
  say('');
  say('W        syncs  during  duty%   meanSync   maxStale   lastEditIndexed');
  for (const r of results) {
    say(`${r.label.padEnd(8)} ${String(r.syncs).padStart(5)}  ${String(r.duringBurst).padStart(6)}`
      + `  ${r.duty.toFixed(1).padStart(5)}  ${(r.meanSync === null ? 'n/a' : r.meanSync.toFixed(0) + 'ms').padStart(9)}`
      + `  ${((r.maxStalenessMs / 1000).toFixed(1) + 's').padStart(9)}   ${r.present > 0}`);
  }
  say('');

  // ---- CONTROLS AND ABANDON RULE, before any verdict --------------------------------------------
  const off = results.find((r) => r.W === null);
  if (meterMs <= 100) {
    say('⛔ METER CONTROL FAILED — conclude nothing.');
    process.exitCode = 2;
  } else if (!off || off.duringBurst > 1) {
    say(`⛔ ABANDON RULE FIRED: the W=off arm did NOT reproduce starvation (${off?.duringBurst} flushes during the burst).`);
    say('   The harness is not driving the watcher the way the real one behaves. CONCLUDE NOTHING about any W.');
    process.exitCode = 2;
  } else if (results.some((r) => r.present === 0)) {
    say('⛔ PRESENCE CONTROL FAILED: an arm ended without the last edit in the graph. CONCLUDE NOTHING.');
    process.exitCode = 2;
  } else {
    const ok = results.filter((r) => r.W !== null
      && r.duty < 25
      && r.maxStalenessMs <= r.W + 2 * (r.meanSync ?? 0));
    say(ok.length === 0
      ? 'VERDICT: NO DEFAULT MAX-WAIT — no arm satisfied the preregistered rule. The starvation stays a documented limitation.'
      : `VERDICT: candidates satisfying the preregistered rule: ${ok.map((r) => r.label).join(', ')}`
        + ` (smallest duty: ${ok.reduce((a, b) => (a.duty <= b.duty ? a : b)).label})`);
    process.exitCode = 0;
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
