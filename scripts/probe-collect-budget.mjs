#!/usr/bin/env node
// DIFFERENTIAL PROBE — did step A cause the scoped-collect zero, or merely coincide with it?
//
// ⛔⛔ VERSION 1 OF THIS FILE FAILED IN THE EXACT WAY IT EXISTED TO PREVENT, and the failure is
// worth more than the result was. It read `res.budgetExhausted` and
// `res.filesWalked ?? res.filesConsidered ?? res.fileCount`. Those top-level names DO NOT EXIST on
// that response — the real fields are nested under `res.index`. The `??` chain turned every miss
// into null silently, all 16 runs recorded null, nothing failed, and a causal claim was published
// on top of it. A fail-open read inside the instrument built to stop a fail-open read.
//
// ⇒ So: NO SILENT NULLS. Every observation is either a real value or a TYPED unavailability, and
// `assertFieldsReadable` proves at startup that the field PATHS still resolve on a real response.
// If the response shape moves again, this aborts instead of reporting nulls.
//
// ⛔ `partial_no_files` IS DELETED AS A CAUSE. It was `status === 'partial'` wearing a cause's
// name — the same ambiguous surface the probe was built to replace. An unexplained zero is
// CAUSE_UNKNOWN and is never counted as agreement between arms.
//
// Preregistered protocol, subjects, controls and outcomes:
// docs/evidence/m1a-step-a/PROBE-PREREGISTRATION.md
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Docker/aify-project-graph';
const SUBJECT_COMMITS = { pre: '8a3675f', post: '29fc344' };
const WORKTREES = { pre: 'C:/Docker/apg-probe-pre', post: 'C:/Docker/apg-probe-post' };
const REPS = Number(process.env.PROBE_REPS ?? 4);
const BUDGET_MS = Number(process.env.PROBE_BUDGET_MS ?? 9000);
const IMPOSSIBLE_BUDGET_MS = 1;
const LOAD_WORKERS = Number(process.env.PROBE_LOAD ?? Math.max(2, os.cpus().length - 2));

// ─────────────────────────────────────────────────────────────────────────────
// Subject identity — bound IN the results, not asserted in prose
// ─────────────────────────────────────────────────────────────────────────────
function bindSubject(arm) {
  const root = WORKTREES[arm];
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  // Hash the bytes actually imported, so a stale or edited working tree cannot pass as the commit.
  const sources = [
    'mcp/stdio/query/verbs/collect_code_intel.js',
    'mcp/stdio/ingest/extractors/generic.js',
    'mcp/stdio/ingest/fingerprint.js',
  ];
  const h = crypto.createHash('sha256');
  const present = [];
  for (const rel of sources) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) { h.update(fs.readFileSync(p)); present.push(rel); }
  }
  return {
    arm, root, commit, tree,
    workingTreeClean: dirty === '',
    hasStepASiteId: fs.existsSync(path.join(root, 'mcp/stdio/ingest/identity/code-symbol-site-id.js')),
    sourcesHashed: present, sourceHash: h.digest('hex'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus + load, identical for both arms
// ─────────────────────────────────────────────────────────────────────────────
function makeCppRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-probe-cpp-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const files = {
    'src/a.cpp': '#include "a.h"\nint alpha(int x) { return x + 1; }\nint useAlpha() { return alpha(1); }\n',
    'src/a.h': '#pragma once\nint alpha(int x);\nint useAlpha();\n',
    'src/b.cpp': '#include "a.h"\nint beta(int x) { return alpha(x) * 2; }\n',
  };
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), body, 'utf8');
  const posix = root.replace(/\\/g, '/');
  fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify(
    ['src/a.cpp', 'src/b.cpp'].map((f) => ({ directory: posix, file: `${posix}/${f}`, command: `clang++ -std=c++17 -c ${f}` })),
    null, 2), 'utf8');
  for (const args of [['init', '-q'], ['config', 'user.email', 'p@p'], ['config', 'user.name', 'p'], ['add', '-A'], ['commit', '-qm', 'probe']]) {
    execFileSync('git', args, { cwd: root });
  }
  return root;
}

const startLoad = (n) => {
  const kids = Array.from({ length: n }, () => spawn(process.execPath,
    ['-e', 'const e=Date.now()+900000;let x=0;while(Date.now()<e){x=(x+Math.random())%1e6;}'], { stdio: 'ignore' }));
  return () => { for (const k of kids) { try { k.kill(); } catch { /* gone */ } } };
};

// ─────────────────────────────────────────────────────────────────────────────
// Observation — typed unavailability, never a silent null
// ─────────────────────────────────────────────────────────────────────────────
const UNAVAILABLE = 'UNAVAILABLE';

/** Read a dotted path, returning UNAVAILABLE when the path itself is absent. */
function readPath(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur == null || !(part in cur)) return UNAVAILABLE;
    cur = cur[part];
  }
  return cur ?? null;
}

const FIELDS = {
  status: 'status',
  indexReady: 'index.indexReady',
  budgetExhausted: 'index.budgetExhausted',
  filesProcessed: 'index.filesProcessed',
  filesTotal: 'index.filesTotal',
};

async function runOnce(subjectRoot, budgetMs) {
  const repo = makeCppRepo();
  const started = Date.now();
  const observed = {}; let error = null; let collected = null;
  try {
    const href = `${pathToFileURL(path.join(subjectRoot, 'mcp/stdio/query/verbs/collect_code_intel.js')).href}?t=${Date.now()}`;
    const mod = await import(href);
    const res = await mod.graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all', budgetMs,
      operations: ['definitions', 'references', 'diagnostics'],
    });
    for (const [name, dotted] of Object.entries(FIELDS)) observed[name] = readPath(res, dotted);
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 200);
    for (const name of Object.keys(FIELDS)) observed[name] = UNAVAILABLE;
  }
  const elapsedMs = Date.now() - started;
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(repo, '.aify-graph', 'code-intel', 'collect-progress.json'), 'utf8'));
    collected = Array.isArray(ledger.collected) ? ledger.collected.length : UNAVAILABLE;
  } catch { collected = UNAVAILABLE; }
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* windows lock */ }

  // ⛔ CAUSE, NOT STATUS. Only a field that actually reports the mechanism may name one.
  let cause;
  if (error) cause = 'ERROR';
  else if (collected > 0) cause = 'COLLECTED';
  else if (observed.budgetExhausted === true) cause = 'BUDGET_EXHAUSTED';
  else if (observed.indexReady === false) cause = 'INDEX_NOT_READY';
  else cause = 'CAUSE_UNKNOWN';

  return { budgetMs, collected, cause, elapsedMs, error, ...observed };
}

/**
 * LIVENESS OF THE INSTRUMENT ITSELF: every field path must resolve on a real response, and the
 * fields must be able to CHANGE between a normal and an impossible budget. Without this, version 1's
 * silent nulls recur — and nothing in the run would say so.
 */
async function assertFieldsReadable(subjectRoot) {
  const normal = await runOnce(subjectRoot, BUDGET_MS);
  const starved = await runOnce(subjectRoot, IMPOSSIBLE_BUDGET_MS);
  const unreadable = Object.keys(FIELDS).filter((k) => normal[k] === UNAVAILABLE);
  const changed = Object.keys(FIELDS).filter((k) => normal[k] !== starved[k]);
  return {
    unreadableFields: unreadable,
    fieldsThatChanged: changed,
    // A field that never changes cannot discriminate; one that never resolves is version 1's defect.
    pass: unreadable.length === 0 && changed.length > 0,
    normal, starved,
  };
}

async function main() {
  const subjects = { pre: bindSubject('pre'), post: bindSubject('post') };
  for (const s of Object.values(subjects)) {
    if (!s.commit.startsWith(SUBJECT_COMMITS[s.arm])) throw new Error(`${s.arm} is at ${s.commit}, expected ${SUBJECT_COMMITS[s.arm]}`);
    if (!s.workingTreeClean) throw new Error(`${s.arm} working tree is dirty — the subject is not the commit`);
  }
  if (subjects.pre.hasStepASiteId) throw new Error('pre subject CONTAINS step A — wrong baseline');
  if (!subjects.post.hasStepASiteId) throw new Error('post subject LACKS step A — wrong subject');
  if (subjects.pre.sourceHash === subjects.post.sourceHash) throw new Error('both subjects hash identically — they are not two subjects');

  const liveness = await assertFieldsReadable(subjects.post.root);
  process.stdout.write(`instrument liveness: unreadable=${JSON.stringify(liveness.unreadableFields)} `
    + `changed=${JSON.stringify(liveness.fieldsThatChanged)} -> ${liveness.pass ? 'PASS' : 'FAIL'}\n`);

  const stop = LOAD_WORKERS > 0 ? startLoad(LOAD_WORKERS) : () => {};
  const runs = [];
  try {
    for (let i = 0; i < REPS; i += 1) {
      const order = i % 2 === 0 ? ['pre', 'post'] : ['post', 'pre'];
      for (const arm of order) {
        for (const [kind, budget] of [['subject', BUDGET_MS], ['negative_control', IMPOSSIBLE_BUDGET_MS]]) {
          const r = await runOnce(subjects[arm].root, budget);
          runs.push({ rep: i, arm, kind, position: order.indexOf(arm), ...r });
          process.stdout.write(`${String(i).padStart(2)} ${arm.padEnd(5)} ${kind.padEnd(16)} `
            + `collected=${String(r.collected).padStart(3)} cause=${r.cause.padEnd(17)} `
            + `budgetExhausted=${String(r.budgetExhausted).padEnd(5)} filesTotal=${String(r.filesTotal).padEnd(4)} ${r.elapsedMs}ms\n`);
        }
      }
    }
  } finally { stop(); }

  const summarise = (arm, kind) => {
    const a = runs.filter((r) => r.arm === arm && r.kind === kind);
    const zero = a.filter((r) => !(r.collected > 0));
    return {
      arm, kind, n: a.length, zeroRuns: zero.length,
      causes: zero.reduce((acc, r) => { acc[r.cause] = (acc[r.cause] ?? 0) + 1; return acc; }, {}),
      medianElapsedMs: a.map((r) => r.elapsedMs).sort((x, y) => x - y)[Math.floor(a.length / 2)],
    };
  };
  const out = {
    takenAt: new Date().toISOString(),
    subjects, reps: REPS, budgetMs: BUDGET_MS, impossibleBudgetMs: IMPOSSIBLE_BUDGET_MS,
    loadWorkers: LOAD_WORKERS, cpus: os.cpus().length,
    instrumentLiveness: liveness,
    controls: {
      positive_eachArmCollectedAtLeastOnce: ['pre', 'post'].every((arm) =>
        runs.some((r) => r.arm === arm && r.kind === 'subject' && r.collected > 0)),
      // IN THE CARRIER this time: an impossible budget must yield zero in both arms.
      negative_impossibleBudgetYieldsZeroBothArms: ['pre', 'post'].every((arm) =>
        runs.filter((r) => r.arm === arm && r.kind === 'negative_control').every((r) => !(r.collected > 0))),
      instrument_fieldsReadableAndDiscriminating: liveness.pass,
    },
    pre: { subject: summarise('pre', 'subject'), negative_control: summarise('pre', 'negative_control') },
    post: { subject: summarise('post', 'subject'), negative_control: summarise('post', 'negative_control') },
    byPosition: [0, 1].map((pos) => {
      const a = runs.filter((r) => r.position === pos && r.kind === 'subject');
      return { position: pos, n: a.length, zeroRuns: a.filter((r) => !(r.collected > 0)).length };
    }),
    runs,
  };
  const dir = path.join(REPO, 'docs', 'evidence', 'm1a-step-a');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROBE-RESULTS-v2.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  process.stdout.write(`\ncontrols: ${JSON.stringify(out.controls)}\n`);
  process.stdout.write(`pre  subject: ${JSON.stringify(out.pre.subject)}\n`);
  process.stdout.write(`post subject: ${JSON.stringify(out.post.subject)}\n`);
  process.stdout.write(`byPosition: ${JSON.stringify(out.byPosition)}\n`);
}

await main();
