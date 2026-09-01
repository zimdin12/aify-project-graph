#!/usr/bin/env node
// Controlled A/B for the document-snapshot cache. Preregistration:
// scratchpad/ab-prereg-snapshot-cache.md — n, order, predicates and claim ceiling fixed BEFORE
// this ran.
//
//   A = 83cf19b  guard v2, one filesystem read per Location
//   B = 19f50cf  identical guard, reads routed through one per-collection snapshot
//
// ⚠ COUNTERBALANCED. Pairs alternate AB / BA. An uncounterbalanced version of this experiment
// earlier in the arc gave the first-running arm a flattering result and had to be discarded.
//
// ⛔ ALL n PAIRS RUN. The loop does not exit early on a pleasing intermediate result.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PAIRS = 6; // fixed in advance
const TEST = 'tests/integration/code-intel/scoped-collect-survives-real.test.js';
const CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
const ARMS = {
  A: { label: 'A no-cache ', dir: 'C:/Docker/apg-ab-nocache', commit: '83cf19b' },
  B: { label: 'B with-cache', dir: 'C:/Docker/apg-ab-cache', commit: '19f50cf' },
};

// Load identity recorded per pair, so a pair run under unusual load is visible rather than
// silently averaged in.
function loadIdentity() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      '(Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Measure-Object).Count'],
    { encoding: 'utf8' });
    return { nodeProcesses: Number(String(out).trim()) };
  } catch { return { nodeProcesses: null }; }
}

function runArm(arm) {
  const t0 = Date.now();
  let out = '';
  let status = 'unknown';
  try {
    out = execFileSync('npx', ['vitest', 'run', TEST, '--reporter=default'], {
      cwd: arm.dir,
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, APG_CLANGD: CLANGD },
      maxBuffer: 1 << 26,
    });
    status = 'pass';
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    status = 'fail';
  }
  const wall = Date.now() - t0;
  const clean = out.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const failed = clean.match(/Tests\s+(\d+) failed/);
  const passed = clean.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/);
  const fileMs = clean.match(new RegExp(`${TEST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\((\\d+) tests\\)\\s*(\\d+)ms`));
  // The narrow case that motivated the experiment, tracked by name.
  const budgetFail = /budget-limited scope=all run CONTINUES|resumed call scopes its authority/.test(clean)
    && /FAIL/.test(clean);
  return {
    status,
    wallMs: wall,
    fileMs: fileMs ? Number(fileMs[2]) : null,
    failed: failed ? Number(failed[1]) : 0,
    passed: passed ? Number(passed[1]) : null,
    budgetAssertionFailed: budgetFail,
  };
}

const rows = [];
for (let pair = 1; pair <= PAIRS; pair += 1) {
  const order = pair % 2 === 1 ? ['A', 'B'] : ['B', 'A'];
  const load = loadIdentity();
  const result = { pair, order: order.join(''), load };
  for (const key of order) result[key] = runArm(ARMS[key]);
  rows.push(result);
  console.log(`pair ${pair} (${result.order}) load=${JSON.stringify(load)}`);
  for (const key of ['A', 'B']) {
    const r = result[key];
    console.log(`   ${ARMS[key].label}  status=${r.status.padEnd(4)} fileMs=${String(r.fileMs).padStart(6)} wallMs=${String(r.wallMs).padStart(6)} failed=${r.failed} budgetAssertionFailed=${r.budgetAssertionFailed}`);
  }
}

const summarise = (key) => {
  const ms = rows.map((r) => r[key].fileMs).filter((v) => Number.isFinite(v));
  const fails = rows.filter((r) => r[key].failed > 0).length;
  const budget = rows.filter((r) => r[key].budgetAssertionFailed).length;
  const median = ms.length ? [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)] : null;
  return { n: ms.length, median, min: ms.length ? Math.min(...ms) : null, max: ms.length ? Math.max(...ms) : null, runsWithFailures: fails, budgetAssertionFailures: budget };
};

console.log('\n=== SUMMARY (n =', PAIRS, 'pairs, counterbalanced) ===');
console.log('  A no-cache  :', JSON.stringify(summarise('A')));
console.log('  B with-cache:', JSON.stringify(summarise('B')));
console.log('\n⚠ Wall time is the SECONDARY predicate and may remain noisy. The primary predicate is');
console.log('  filesystem work, proven separately by the read-collapse and alias gates.');
fs.writeFileSync('C:/Users/ADMINI~1/AppData/Local/Temp/ab-snapshot-rows.json', JSON.stringify(rows, null, 1));
console.log('\nrows written to C:/Users/ADMINI~1/AppData/Local/Temp/ab-snapshot-rows.json');
