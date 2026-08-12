#!/usr/bin/env node
// A SUITE COUNT WITHOUT ITS CARRIER IS NOT PORTABLE.
//
// I reported "1760 pass" across many status messages. Every one was a function of
// untracked state (`.aify-graph/`, gitignored) and an undeclared Vitest pool default. A
// reviewer could not reproduce any of them, said so repeatedly, and I filed that as a
// residual limit instead of testing it. When I finally did, both dependencies were real.
//
// graph-senior-dev-hermes's ruling, which this implements: a commit cannot inherit
// evidence from untracked state or an undeclared default. A minimum receipt must BIND:
//
//   · commit + tree hash            — which bytes produced this
//   · tracked status                — clean, or exactly what is dirty
//   · .aify-graph presence/identity — or a TYPED ABSENCE, so "not indexed" is a stated
//                                     condition rather than an unremarked one
//   · Vitest pool + config          — the setting, not whatever the tool defaulted to
//   · platform + runtime            — os, arch, node
//   · selected-file population      — how many test files the run actually chose
//
//   node scripts/suite-receipt.mjs [--json]
//
// ⇒ The point is not paperwork. Each field is a dependency that silently changed a result
// at least once in this repo. A count is a claim about a CARRIER, and naming the carrier
// is what turns an anecdote into evidence someone else can check.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => {
  try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim(); }
  catch { return null; }
};

// ★ TYPED ABSENCE. "no .aify-graph" must be a recorded value, not a missing key — an
// absent field reads as "nobody looked", which is the ambiguity this whole exercise is about.
//
// ⚠ A CORRECTION, recorded here because the claim was made and needs unmaking. I reported
// that "the suite mutates its own carrier", having watched this digest move across runs
// (7 → 12 → 14 entries). MEASURED TWICE AFTERWARDS, and it is false:
//   · digest before a full suite run == digest after (8f0500941ff523ac, unchanged)
//   · with the directory moved away, a full query-suite run does NOT recreate it
// The movement was entirely MY OWN contamination — an `mv` that landed inside a directory
// recreated between steps, leaving a 37MB nested copy.
//
// ⇒ I attributed a cause from a correlation I had not checked, in the same message where I
// was reporting on the danger of unattributed claims. The digest field below is what makes
// that checkable by anyone, including me.
function graphIdentity() {
  const dir = join(REPO, '.aify-graph');
  if (!existsSync(dir)) return { present: false, reason: 'absent (gitignored; repo not indexed here)' };
  const h = createHash('sha256');
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    files.push(name);
    h.update(name).update(readFileSync(p));
  }
  return { present: true, files, digest: h.digest('hex').slice(0, 16) };
}

function vitestCarrier() {
  const cfgPath = join(REPO, 'vitest.config.js');
  const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : '';
  const pool = cfg.match(/pool:\s*'([^']+)'/)?.[1];
  return {
    configPresent: Boolean(cfg),
    // ⚠ An INHERITED pool is reported as such rather than as a value. The suite passed on
    // an inherited `forks` for months while requiring it — that is the defect this names.
    pool: pool ?? 'INHERITED FROM VITEST DEFAULT (undeclared — a default is not a decision)',
    fileParallelism: /fileParallelism:\s*false/.test(cfg) ? false : 'default',
    configDigest: cfg ? createHash('sha256').update(cfg).digest('hex').slice(0, 12) : null,
  };
}

const carrier = {
  commit: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  trackedStatus: (() => {
    const s = git('status', '--porcelain');
    if (s === null) return 'unknown (not a git repo?)';
    const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length === 0 ? 'clean' : { dirty: lines.length, files: lines.slice(0, 20) };
  })(),
  aifyGraph: graphIdentity(),
  vitest: vitestCarrier(),
  platform: { os: process.platform, arch: process.arch, node: process.version },
};

console.log('running the suite to bind counts to this carrier…\n');
let raw = '';
try {
  raw = execFileSync('npx', ['vitest', 'run', '--reporter=basic'], {
    cwd: REPO, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  raw = `${e.stdout || ''}${e.stderr || ''}`;
}

// ⚠ ANCHORED TO THE SUMMARY LINES, and ANSI stripped first. My first version matched
// /(\d+) skipped/ against the whole output and reported 1 where the suite said 2 — because
// PER-FILE lines also carry "N skipped", and it matched the first one it met.
//
// ★ A receipt that misreports is worse than no receipt: it launders a wrong number through
// a format that looks rigorous. Same class as every wrong-instance regex in this repo —
// the pattern was right and the SUBJECT was wrong.
const plain = raw.replace(/\x1b\[[0-9;]*m/g, '');
const summaryOf = (label) => plain.split('\n').find((l) => new RegExp(`^\\s*${label}\\s`).test(l)) ?? '';
const filesLine = summaryOf('Test Files');
const testsLine = summaryOf('Tests');
const num = (line, re) => Number(line.match(re)?.[1] ?? -1);
const counts = {
  testFiles: num(filesLine, /(\d+) passed/),
  testFilesFailed: num(filesLine, /(\d+) failed/),
  passed: num(testsLine, /(\d+) passed/),
  failed: num(testsLine, /(\d+) failed/),
  skipped: num(testsLine, /(\d+) skipped/),
  // If the summary lines were not found at all, every count above is -1 — say so rather
  // than emit a receipt full of sentinels that read like real numbers.
  parsed: Boolean(filesLine && testsLine),
};

const receipt = { counts, carrier, generatedAt: new Date().toISOString() };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log('SUITE RECEIPT');
  if (!counts.parsed) console.log('  ⛔ SUMMARY LINES NOT FOUND — counts below are unparsed sentinels');
  console.log(`  counts        ${counts.passed} passed · ${counts.failed > 0 ? `${counts.failed} FAILED · ` : ''}${counts.skipped} skipped · ${counts.testFiles} files`);
  console.log(`  commit        ${carrier.commit}  (tree ${carrier.tree?.slice(0, 12)})`);
  console.log(`  tracked       ${typeof carrier.trackedStatus === 'string' ? carrier.trackedStatus : `DIRTY (${carrier.trackedStatus.dirty} files)`}`);
  console.log(`  .aify-graph   ${carrier.aifyGraph.present ? `present, ${carrier.aifyGraph.files.length} files, digest ${carrier.aifyGraph.digest}` : carrier.aifyGraph.reason}`);
  console.log(`  vitest pool   ${carrier.vitest.pool}`);
  console.log(`  platform      ${carrier.platform.os}/${carrier.platform.arch} node ${carrier.platform.node}`);
}

// A dirty tree does not invalidate the run, but it does mean the count is NOT attributable
// to the commit — so it is refused as a commit-bound receipt rather than quietly reported.
if (typeof carrier.trackedStatus !== 'string') {
  console.error('\n⚠ TREE IS DIRTY — this count is not attributable to the commit above.');
  process.exit(1);
}
if (counts.failed > 0) process.exit(1);
