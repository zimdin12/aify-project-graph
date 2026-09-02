// WHAT ONE AUTO-SYNC BURST COSTS, BY EDIT KIND.
//
// Preregistered: docs/evidence/m3-freshness/PREREGISTRATION-auto-sync-burst-cost.md.
// Thresholds, controls and the abandon rule were fixed before this file existed.
//
//   node scripts/m3a-auto-sync-burst-cost.mjs
//
// ⛔ THIS EDITS A TRACKED FILE. It reverts after every burst and verifies a clean tree at the end.
// Commit before running — `git checkout --` has eaten uncommitted work in this repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(REPO, 'mcp/stdio/query/param-signature.js');
const ORIGINAL = readFileSync(TARGET, 'utf8');

// ⛔ EVERY EDIT IS VERIFIED APPLIED BEFORE TIMING. An edit that silently failed to match would
// measure the noop kind four times over and report it as A–D — a false "auto-sync is free".
const EDITS = {
  A: (s) => s.replace('export function normalizedParamList(signature) {',
    '// __probe cosmetic\nexport function normalizedParamList(signature) {'),
  B: (s) => s.replace('  const inner = signature.slice(open + 1, close).trim();',
    "  const __probe = 'body-only';\n  const inner = signature.slice(open + 1, close).trim();"),
  C: (s) => s.replace('export function normalizedParamList(signature) {',
    'export function normalizedParamList(signature, __probeArg) {'),
  D: (s) => s.replace('  const lists = signatures.map(normalizedParamList);',
    "  normalizedParamList('__probe');\n  const lists = signatures.map(normalizedParamList);"),
  E: (s) => s,
  F: (s) => s,
};
const KINDS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LABEL = {
  A: 'cosmetic (comment)', B: 'body-only (local const)', C: 'signature change',
  D: 'added call', E: 'noop (no edit)', F: 'forced rebuild',
};
const REPEATS = 3;

async function timeBurst(kind) {
  const mutated = EDITS[kind](ORIGINAL);
  if (kind !== 'E' && kind !== 'F' && mutated === ORIGINAL) {
    throw new Error(`edit ${kind} did not apply — the anchor no longer matches; result would be a false noop`);
  }
  writeFileSync(TARGET, mutated, 'utf8');
  const applied = readFileSync(TARGET, 'utf8') === mutated;
  if (!applied) throw new Error(`edit ${kind} did not reach disk`);
  const t0 = performance.now();
  let status = '';
  try {
    const r = await ensureFresh({ repoRoot: REPO, force: kind === 'F' });
    status = [r?.status, r?.action, r?.reason].filter(Boolean).join('/').slice(0, 48);
  } catch (e) {
    status = `ERROR:${e.message.slice(0, 40)}`;
  }
  const ms = performance.now() - t0;
  writeFileSync(TARGET, ORIGINAL, 'utf8');
  return { ms, status };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const warm = await timeBurst('E');
console.log(`warm-up (kind E, recorded separately, NOT folded in): ${warm.ms.toFixed(0)}ms  ${warm.status}`);

const results = Object.fromEntries(KINDS.map((k) => [k, []]));
// Interleaved, not grouped: load on this machine drifts over minutes, and grouping aliases that
// drift onto the variable under test. That produced a false pre/post verdict earlier in this arc.
for (let round = 0; round < REPEATS; round += 1) {
  for (const kind of KINDS) {
    const { ms, status } = await timeBurst(kind);
    results[kind].push(ms);
    console.log(`  round ${round + 1}  ${kind} ${LABEL[kind].padEnd(24)} ${ms.toFixed(0).padStart(7)}ms  ${status}`);
  }
}

console.log('\n──── MEDIAN PER KIND');
const med = {};
for (const kind of KINDS) {
  med[kind] = median(results[kind]);
  console.log(`  ${kind} ${LABEL[kind].padEnd(24)} ${med[kind].toFixed(0).padStart(8)}ms   raw ${results[kind].map((x) => x.toFixed(0)).join(', ')}`);
}

console.log('\n──── CONTROLS');
const ordering = med.E <= med.A && med.F >= med.C;
const resolves = med.E > 0 ? med.F / med.E : Infinity;
console.log(`ORDERING  noop <= cosmetic AND forced >= signature -> ${ordering ? 'PASS' : 'FAIL'}`);
console.log(`RESOLVING forced/noop ratio ${resolves.toFixed(2)} (> 2 required)      -> ${resolves > 2 ? 'PASS' : 'FAIL'}`);

console.log('\n──── PREREGISTERED DECISION');
if (!ordering || !(resolves > 2)) {
  console.log('UNMEASURED — a control failed. The default stays OPT-IN because nothing was established.');
} else {
  const on = med.A < 2000 && med.B < 2000 && med.C < 15000 && med.D < 15000;
  console.log(`A<2000:${med.A < 2000}  B<2000:${med.B < 2000}  C<15000:${med.C < 15000}  D<15000:${med.D < 15000}`);
  console.log(on ? 'RECOMMEND DEFAULT ON' : 'RECOMMEND KEEP OPT-IN');
}

const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(`\nrestored clean: ${dirty === '' ? 'YES' : `NO -> ${dirty}`}`);
