// M3a blocker 2, COST HALF — does sustained editing make the watcher do pathological work?
//
// ⛔ READ docs/evidence/m3-freshness/PREREGISTRATION-sustained-edit-cost.md FIRST. The decision rule,
// the controls and the abandon rule were fixed before this ran; nothing here may be reinterpreted
// against the numbers it produces.
//
// ⚠ THIS ARM USES THE REAL ensureFresh. The correctness test injects a fake one deliberately; this
// one cannot, because the question IS the indexer's behaviour under load.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = process.env.APG_PROBE_SOURCE_REPO ?? process.cwd();
const EDIT_INTERVAL_MS = 250;
const DURATION_MS = Number(process.env.APG_PROBE_DURATION_MS ?? 60_000);
const IDLE_MS = Number(process.env.APG_PROBE_IDLE_MS ?? 15_000);
const STRUCTURAL_BASELINE_MS = 42; // preregistered, from the single-burst measurement
const PATHOLOGICAL_MEAN_MS = STRUCTURAL_BASELINE_MS * 5;
const DRAIN_LIMIT_MS = 2 * 750; // two debounce windows

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const workdir = mkdtempSync(join(tmpdir(), 'apg-sustained-'));
const clone = join(workdir, 'repo');

function say(...a) { console.log(...a); }

try {
  say('cloning ' + REPO_ROOT + ' -> ' + clone + ' ...');
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', REPO_ROOT, clone], { stdio: 'pipe' });

  // ⛔ The edited file must be one the graph actually holds, or every sync is a cheap noop and the
  // measurement is of nothing. Pick a real source file and verify it exists before starting.
  const target = join(clone, 'mcp/stdio/sync/watcher.js');
  if (!existsSync(target)) throw new Error('probe target missing in the clone: ' + target);
  const original = readFileSync(target, 'utf8');

  const { startAutoSync, AUTO_SYNC_ENV_VAR } = await import('../mcp/stdio/sync/auto-sync.js');
  const { ensureFresh } = await import('../mcp/stdio/freshness/orchestrator.js');

  say('building the initial graph (a full rebuild; NOT part of the measurement) ...');
  const buildStart = Date.now();
  await ensureFresh({ repoRoot: clone, force: true });
  say('  initial build: ' + (Date.now() - buildStart) + ' ms');

  const syncs = [];
  let inFlight = 0;
  let overlappedAnEdit = false;
  let editing = false;

  const instrumented = async (args) => {
    inFlight += 1;
    if (editing) overlappedAnEdit = true;
    const t0 = Date.now();
    try { return await ensureFresh(args); }
    finally { syncs.push({ ms: Date.now() - t0, at: Date.now() }); inFlight -= 1; }
  };

  const loop = startAutoSync({
    repoRoot: clone,
    ensureFresh: instrumented,
    env: { ...process.env, [AUTO_SYNC_ENV_VAR]: '1' },
  });
  if (loop.status !== 'running') {
    throw new Error('watcher not running: ' + loop.status + ' ' + (loop.reason ?? ''));
  }

  // ---- ARM: sustained structural editing -------------------------------------------------
  say('sustained editing for ' + DURATION_MS + ' ms, one structural edit every ' + EDIT_INTERVAL_MS + ' ms ...');
  const cpu0 = process.cpuUsage();
  const wall0 = Date.now();
  editing = true;
  let edits = 0;
  while (Date.now() - wall0 < DURATION_MS) {
    edits += 1;
    // Structural, not cosmetic: a new function name each time forces re-extraction and
    // re-resolution, which is the expensive path an editing agent actually produces.
    writeFileSync(target, original + '\nexport function probeFn' + edits + '() { return ' + edits + '; }\n');
    await sleep(EDIT_INTERVAL_MS);
  }
  editing = false;
  const lastEditAt = Date.now();

  // Drain: how long until nothing is in flight and no new sync starts?
  let drainedAt = null;
  while (Date.now() - lastEditAt < 30_000) {
    await sleep(100);
    if (inFlight === 0) {
      const lastSyncAt = syncs.length ? syncs[syncs.length - 1].at : lastEditAt;
      if (Date.now() - lastSyncAt > 1500) { drainedAt = Date.now(); break; }
    }
  }
  const cpuUsed = process.cpuUsage(cpu0);
  const wallUsed = Date.now() - wall0;
  loop.stop();

  // ---- CONTROL: idle ---------------------------------------------------------------------
  say('idle control for ' + IDLE_MS + ' ms (watcher running, no edits) ...');
  const idleSyncs = [];
  const idleLoop = startAutoSync({
    repoRoot: clone,
    ensureFresh: async (a) => {
      const t = Date.now();
      try { return await ensureFresh(a); } finally { idleSyncs.push(Date.now() - t); }
    },
    env: { ...process.env, [AUTO_SYNC_ENV_VAR]: '1' },
  });
  const idleCpu0 = process.cpuUsage();
  await sleep(IDLE_MS);
  const idleCpu = process.cpuUsage(idleCpu0);
  idleLoop.stop();

  // ---- CONTROL: the meter can see cost ---------------------------------------------------
  const meterCpu0 = process.cpuUsage();
  const spinUntil = Date.now() + 500;
  while (Date.now() < spinUntil) { /* deliberate busy loop */ }
  const meterCpu = process.cpuUsage(meterCpu0);

  // ---- REPORT ----------------------------------------------------------------------------
  const totalCpuMs = (cpuUsed.user + cpuUsed.system) / 1000;
  const idleCpuMs = (idleCpu.user + idleCpu.system) / 1000;
  const meterCpuMs = (meterCpu.user + meterCpu.system) / 1000;
  const meanMs = syncs.length ? syncs.reduce((a, s) => a + s.ms, 0) / syncs.length : null;
  const maxMs = syncs.length ? Math.max(...syncs.map((s) => s.ms)) : null;
  const cpuPct = (totalCpuMs / wallUsed) * 100;
  const drainMs = drainedAt ? drainedAt - lastEditAt : null;

  say('');
  say('=== CONTROLS ===');
  say('METER can see cost:      ' + meterCpuMs.toFixed(1) + ' ms CPU for a 500 ms busy loop  '
    + (meterCpuMs > 100 ? 'PASS' : 'FAIL — meter is blind, every zero below is unreadable'));
  say('IDLE arm:                ' + idleSyncs.length + ' sync(s), ' + idleCpuMs.toFixed(1)
    + ' ms CPU over ' + IDLE_MS + ' ms');
  say('');
  say('=== SUSTAINED EDITING ARM ===');
  say('edits issued:            ' + edits);
  say('syncs run:               ' + syncs.length);
  say('a sync overlapped edits: ' + overlappedAnEdit);
  say('mean sync wall:          ' + (meanMs === null ? 'n/a' : meanMs.toFixed(1) + ' ms')
    + '   (preregistered pathological threshold: > ' + PATHOLOGICAL_MEAN_MS + ' ms)');
  say('max sync wall:           ' + (maxMs === null ? 'n/a' : maxMs + ' ms'));
  say('process CPU:             ' + totalCpuMs.toFixed(0) + ' ms over ' + wallUsed + ' ms wall = '
    + cpuPct.toFixed(1) + '% of one core  (threshold: > 30%)');
  say('drained after last edit: ' + (drainMs === null ? 'DID NOT DRAIN within 30 s' : drainMs + ' ms')
    + '   (threshold: > ' + DRAIN_LIMIT_MS + ' ms)');
  say('');

  // ---- ABANDON RULE, applied before any verdict ------------------------------------------
  if (syncs.length < 5 || !overlappedAnEdit) {
    say('⛔ ABANDON RULE FIRED: sustained load was never produced');
    say('   (syncs=' + syncs.length + ', overlap=' + overlappedAnEdit + '). CONCLUDE NOTHING about sustained cost.');
    process.exitCode = 2;
  } else if (meterCpuMs <= 100) {
    say('⛔ CONTROL FAILED: the CPU meter is blind. CONCLUDE NOTHING.');
    process.exitCode = 2;
  } else {
    const trips = [];
    if (meanMs > PATHOLOGICAL_MEAN_MS) trips.push('mean sync ' + meanMs.toFixed(0) + ' ms > ' + PATHOLOGICAL_MEAN_MS + ' ms');
    if (cpuPct > 30) trips.push('CPU ' + cpuPct.toFixed(1) + '% > 30%');
    if (drainMs === null || drainMs > DRAIN_LIMIT_MS) {
      trips.push('drain ' + (drainMs === null ? 'never' : drainMs + ' ms') + ' > ' + DRAIN_LIMIT_MS + ' ms');
    }
    say(trips.length === 0
      ? 'VERDICT: ACCEPTABLE — no preregistered threshold tripped.'
      : 'VERDICT: PATHOLOGICAL — tripped: ' + trips.join('; '));
    process.exitCode = trips.length === 0 ? 0 : 1;
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
