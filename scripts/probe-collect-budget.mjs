#!/usr/bin/env node
// DIFFERENTIAL PROBE — did step A cause the scoped-collect zero, or merely coincide with it?
//
// ⛔ A BARE ZERO IS NOT EVIDENCE. `expected 0 to be greater than 0` is emitted identically by a
// starved clangd and by a broken graph join, so the test and the product share one ambiguous
// failure string and no number of reruns can tell them apart. This records a CAUSE per run.
//
// Preregistered protocol, subjects, controls and outcomes:
// docs/evidence/m1a-step-a/PROBE-PREREGISTRATION.md
//
// ⚠ ALTERNATING A/B, never all of one arm then all of the other — otherwise drift in machine
// state (thermal, page cache, another process starting) aligns with the subject and is
// indistinguishable from it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SUBJECTS = {
  pre: 'C:/Docker/apg-probe-pre',
  post: 'C:/Docker/apg-probe-post',
};
const REPS = Number(process.env.PROBE_REPS ?? 6);
const BUDGET_MS = Number(process.env.PROBE_BUDGET_MS ?? 9000);
const LOAD_WORKERS = Number(process.env.PROBE_LOAD ?? Math.max(2, os.cpus().length - 2));

/** Build the same tiny C++ corpus the integration test uses, so both arms see identical input. */
function makeCppRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-probe-cpp-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const files = {
    'src/a.cpp': '#include "a.h"\nint alpha(int x) { return x + 1; }\nint useAlpha() { return alpha(1); }\n',
    'src/a.h': '#pragma once\nint alpha(int x);\nint useAlpha();\n',
    'src/b.cpp': '#include "a.h"\nint beta(int x) { return alpha(x) * 2; }\n',
  };
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body, 'utf8');
  fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify(
    ['src/a.cpp', 'src/b.cpp'].map((f) => ({
      directory: root.replace(/\\/g, '/'),
      file: `${root.replace(/\\/g, '/')}/${f}`,
      command: `clang++ -std=c++17 -c ${f}`,
    })), null, 2), 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'p@p'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'p'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'probe'], { cwd: root });
  return root;
}

/** Background CPU pressure, applied identically to both arms. */
function startLoad(workers) {
  const kids = [];
  for (let i = 0; i < workers; i += 1) kids.push(spawnBusy());
  return () => { for (const k of kids) { try { k.kill(); } catch { /* already gone */ } } };
}

function spawnBusy() {
  return spawn(process.execPath, ['-e', 'const e=Date.now()+600000;let x=0;while(Date.now()<e){x=(x+Math.random())%1e6;}'],
    { stdio: 'ignore', detached: false });
}

async function runOnce(subjectRoot) {
  const repo = makeCppRepo();
  const started = Date.now();
  let status = null; let error = null; let collected = null; let denominator = null; let budgetExhausted = null;
  try {
    const mod = await import(`${pathToFileURL(path.join(subjectRoot, 'mcp/stdio/query/verbs/collect_code_intel.js')).href}?t=${Date.now()}`);
    const res = await mod.graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all', budgetMs: BUDGET_MS,
      operations: ['definitions', 'references', 'diagnostics'],
    });
    status = res?.status ?? null;
    budgetExhausted = res?.budgetExhausted ?? null;
    denominator = res?.filesWalked ?? res?.filesConsidered ?? res?.fileCount ?? null;
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 200);
  }
  const elapsedMs = Date.now() - started;
  try {
    const ledger = JSON.parse(fs.readFileSync(
      path.join(repo, '.aify-graph', 'code-intel', 'collect-progress.json'), 'utf8'));
    collected = Array.isArray(ledger.collected) ? ledger.collected.length : null;
  } catch { collected = null; }
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* windows lock */ }

  // A zero with no captured cause is reported as such, never as evidence for either side.
  const cause = error ? 'error'
    : collected > 0 ? 'collected'
      : budgetExhausted === true ? 'budget_exhausted'
        : status === 'partial' ? 'partial_no_files'
          : 'zero_cause_unknown';
  return { status, collected, denominator, budgetExhausted, elapsedMs, error, cause };
}

async function main() {
  const stop = LOAD_WORKERS > 0 ? startLoad(LOAD_WORKERS) : () => {};
  const runs = [];
  try {
    for (let i = 0; i < REPS; i += 1) {
      // ⛔ COUNTERBALANCED, NOT MERELY ALTERNATING. My first version ran pre-then-post every rep.
      // That controls for slow drift across reps but leaves WITHIN-REP ORDER confounded with the
      // arm: whichever runs first pays any per-rep warm-up (cold clangd after the previous run
      // exited), so an order effect is indistinguishable from a subject effect. The first result
      // it produced happened to flatter the change under test, which is exactly when the design
      // deserves more scrutiny rather than less.
      const order = i % 2 === 0 ? ['pre', 'post'] : ['post', 'pre'];
      for (const arm of order) {
        const r = await runOnce(SUBJECTS[arm]);
        runs.push({ rep: i, arm, position: order.indexOf(arm), ...r });
        process.stdout.write(`${String(i).padStart(2)} ${arm.padEnd(5)} status=${String(r.status).padEnd(8)} `
          + `collected=${String(r.collected).padStart(3)} cause=${r.cause.padEnd(18)} ${r.elapsedMs}ms`
          + `${r.error ? ` err=${r.error.slice(0, 60)}` : ''}\n`);
      }
    }
  } finally { stop(); }

  const summarise = (arm) => {
    const a = runs.filter((r) => r.arm === arm);
    const zero = a.filter((r) => !(r.collected > 0));
    return {
      arm, n: a.length,
      collectedAtLeastOne: a.length - zero.length,
      zeroRuns: zero.length,
      causes: zero.reduce((acc, r) => { acc[r.cause] = (acc[r.cause] ?? 0) + 1; return acc; }, {}),
      medianElapsedMs: a.map((r) => r.elapsedMs).sort((x, y) => x - y)[Math.floor(a.length / 2)],
    };
  };
  const out = {
    takenAt: new Date().toISOString(),
    subjects: SUBJECTS, reps: REPS, budgetMs: BUDGET_MS, loadWorkers: LOAD_WORKERS,
    cpus: os.cpus().length,
    controls: {
      // POSITIVE: each arm must collect > 0 at least once, or that arm's zeros carry no information.
      positive_eachArmCollectedAtLeastOnce:
        ['pre', 'post'].every((arm) => runs.some((r) => r.arm === arm && r.collected > 0)),
    },
    pre: summarise('pre'), post: summarise('post'),
    // The confound check itself: if position dominates, the arm comparison is not readable.
    byPosition: [0, 1].map((pos) => {
      const a = runs.filter((r) => r.position === pos);
      return { position: pos, n: a.length, zeroRuns: a.filter((r) => !(r.collected > 0)).length };
    }),
    runs,
  };
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'docs', 'evidence', 'm1a-step-a');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROBE-RESULTS.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(`\npre : ${JSON.stringify(out.pre)}\npost: ${JSON.stringify(out.post)}\n`);
  process.stdout.write(`positive control (each arm collected at least once): ${out.controls.positive_eachArmCollectedAtLeastOnce ? 'PASS' : 'FAIL'}\n`);
}

await main();
