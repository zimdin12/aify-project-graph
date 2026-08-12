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
// ⚠ KNOWN-INCOMPLETE, AND DELIBERATELY LEFT SO ON THIS CARRIER. This walk skips
// subdirectories, so two graph states differing only in nested content share a digest. The
// recursive replacement is a SEPARATE row on its own carrier, because its proof domain is
// different from this file's commit-attribution matrix and it needs a differential fixture
// (nested content change, nested rename, file↔dir type change, empty-dir policy, unreadable
// entry, symlink handling, same-tree stability) that does not exist yet.
//
// ⇒ I originally shipped the recursive version bundled with `carrierValidity()` in one commit
// — not intentionally, just because they share a file. graph-senior-dev-hermes: "same-file
// proximity does not unify the proof domains", and bundling forces either over-crediting the
// weaker row or withholding the stronger one. Split, and this row is the weaker one.
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
  return { present: true, files, digest: h.digest('hex').slice(0, 16), coverage: 'TOP-LEVEL FILES ONLY — nested state not identified' };
}

// ⛔ THE OLD GUARD TESTED THE WRONG PROPERTY. It asked "is the tree dirty"
// (`typeof trackedStatus !== 'string'`) when the claim it defends is "this count is
// ATTRIBUTABLE TO A COMMIT". A non-git carrier set that field to the STRING
// 'unknown (not a git repo?)', so the guard passed and the script emitted `commit: null`
// and exited 0 — an unattributed receipt in a format that reads as rigorous.
//
// ⚠ My FIRST fix for that was also wrong. It chained `commit === null` → `tree === null` →
// `typeof !== 'string'`, which a real work tree whose STATUS LOOKUP FAILS passes cleanly:
// commit and tree resolve, and the status string still claims "not a git repo?" about a repo
// that IS one. Root cause both times: `git()` collapses every failure to null, so "not a repo"
// and "the status call failed" are indistinguishable at the call site.
//
// ⇒ The failure modes are classified HERE, where they are still distinct. Verified against
// four arms — non-git dir; clean tree; dirty tree; and a real work tree with GIT_INDEX_FILE
// pointed at a directory so `status` fails while `rev-parse --is-inside-work-tree` succeeds.
// (`GIT_DIR` does NOT work for that arm: it breaks detection first, so the test silently
// exercises the non-git case under the lookup-failure name.)
function carrierValidity() {
  if (git('rev-parse', '--is-inside-work-tree') !== 'true') {
    return { state: 'not_git', detail: 'not a git working copy — nothing to attribute counts to' };
  }
  const commit = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const status = git('status', '--porcelain');
  const missing = [['commit', commit], ['tree', tree], ['status', status]]
    .filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    return { state: 'lookup_failed', missing, detail: `inside a work tree but git could not report: ${missing.join(', ')}` };
  }
  const dirty = status.split('\n').map((l) => l.trim()).filter(Boolean);
  if (dirty.length) return { state: 'dirty', dirty: dirty.length, files: dirty.slice(0, 20) };
  return { state: 'ok', commit, tree };
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

const validity = carrierValidity();
// ⚠ Resolved for DISPLAY in every state, and attributable in none but `ok`. My first version
// populated these only from the `ok` result, so a dirty tree printed "commit null (tree
// undefined)" — which reads as "this is not a git repo" about a repo that plainly is one.
// That is the same confusion the old `'unknown (not a git repo?)'` string caused, reintroduced
// by the fix for it. The STATE says whether the count is bound; these say what it was bound to.
const carrier = {
  validity,
  commit: validity.commit ?? git('rev-parse', 'HEAD'),
  tree: validity.tree ?? git('rev-parse', 'HEAD^{tree}'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
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
// ⛔ THE ATTRIBUTION INTERVAL — the carrier was read only BEFORE the run.
//
// graph-senior-dev-hermes: "A suite that changes tracked or generated state can still emit
// counts attributed to the pre-run carrier." Correct, and it defeats the entire point of the
// file: the receipt binds counts to a commit that may not have been the commit throughout.
// A carrier is an INTERVAL, not an instant, so both ends are read and they must agree.
const validityAfter = carrierValidity();
const graphAfter = graphIdentity();
const intervalProblems = [];
if (validityAfter.state !== validity.state) intervalProblems.push(`carrier state moved ${validity.state} → ${validityAfter.state} during the run`);
if ((validityAfter.commit ?? null) !== (validity.commit ?? null)) intervalProblems.push('HEAD moved during the run');
if ((validityAfter.tree ?? null) !== (validity.tree ?? null)) intervalProblems.push('tree moved during the run');
// Generated state has a stated temporal policy rather than an assumed one: for a suite that
// does not mutate its carrier, pre must equal post. If that ever fails, the correct reading is
// "this suite writes to .aify-graph", which is a finding — not something to normalise away.
if (carrier.aifyGraph.digest !== graphAfter.digest) {
  intervalProblems.push(`.aify-graph digest moved ${carrier.aifyGraph.digest} → ${graphAfter.digest} during the run (the suite mutated generated state)`);
}

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

// ⛔ PARSE FAILURE WAS ONLY A WARNING, AND THE EXIT PATH LET IT THROUGH.
//
// `counts.parsed === false` printed a line and carried on; the final guard tested
// `counts.failed > 0`, and the sentinel is **-1**, so `-1 > 0` is false and an UNPARSEABLE run
// exited 0 with a rigorous-looking receipt full of sentinels. That is the exact failure this
// file was written to prevent, sitting in its own exit path — a number nobody could read,
// published in a format that says it was read.
//
// ⇒ Unparseable output is an APPARATUS failure, not a low-confidence result. Counts must also
// be nonnegative integers and reconcile, because "two summary lines exist" was never the claim.
const countProblems = [];
if (!counts.parsed) countProblems.push('summary lines not found in reporter output');
for (const [k, v] of Object.entries(counts)) {
  if (k === 'parsed') continue;
  if (!Number.isInteger(v) || v < 0) countProblems.push(`${k} is ${JSON.stringify(v)} — not a nonnegative integer`);
}
if (counts.parsed && Number.isInteger(counts.testFiles) && Number.isInteger(counts.testFilesFailed)
    && counts.testFilesFailed > 0 && counts.failed === 0) {
  countProblems.push(`${counts.testFilesFailed} test file(s) failed but 0 tests failed — counts do not reconcile`);
}

const receipt = {
  counts, carrier, generatedAt: new Date().toISOString(),
  attributionInterval: { before: validity.state, after: validityAfter.state, problems: intervalProblems },
  countProblems,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log('SUITE RECEIPT');
  if (!counts.parsed) console.log('  ⛔ SUMMARY LINES NOT FOUND — counts below are unparsed sentinels');
  console.log(`  counts        ${counts.passed} passed · ${counts.failed > 0 ? `${counts.failed} FAILED · ` : ''}${counts.skipped} skipped · ${counts.testFiles} files`);
  console.log(`  commit        ${carrier.commit ?? '(none — not a git working copy)'}  (tree ${carrier.tree?.slice(0, 12) ?? 'n/a'})`
    + `${validity.state === 'ok' ? '' : '   ⚠ NOT the carrier of these counts — see `carrier` below'}`);
  console.log(`  carrier       ${validity.state}${validity.detail ? ` — ${validity.detail}` : ''}${validity.dirty ? ` (${validity.dirty} files)` : ''}`);
  // Coverage is printed with the digest, so nobody reads it as whole-directory identity.
  console.log(`  .aify-graph   ${carrier.aifyGraph.present
    ? `${carrier.aifyGraph.files.length} top-level files, digest ${carrier.aifyGraph.digest}  [${carrier.aifyGraph.coverage}]`
    : carrier.aifyGraph.reason}`);
  console.log(`  vitest pool   ${carrier.vitest.pool}`);
  console.log(`  platform      ${carrier.platform.os}/${carrier.platform.arch} node ${carrier.platform.node}`);
}

// ONLY `ok` MAY EMIT. The run may be perfectly real in every other state — what fails is the
// ATTRIBUTION, and a receipt whose attribution fails is worse than no receipt because it
// launders an unbound number through a rigorous-looking format.
if (validity.state !== 'ok') {
  console.error(`\n⛔ NOT COMMIT-BOUND [${validity.state}]: ${validity.detail ?? `${validity.dirty} tracked files differ from the commit`}`);
  console.error('   The counts above are real; their ATTRIBUTION is not. No commit-bound receipt emitted.');
  process.exit(1);
}
// The interval must hold at BOTH ends, or the counts belong to no single carrier.
if (intervalProblems.length) {
  console.error('\n⛔ ATTRIBUTION INTERVAL BROKEN — the carrier changed while the suite ran:');
  for (const p of intervalProblems) console.error(`   · ${p}`);
  console.error('   These counts cannot be attributed to the commit above. No receipt emitted.');
  process.exit(1);
}
// Unreadable counts are an apparatus failure and must never exit 0 on a sentinel.
if (countProblems.length) {
  console.error('\n⛔ COUNTS NOT ESTABLISHED — refusing to publish unreadable numbers:');
  for (const p of countProblems) console.error(`   · ${p}`);
  process.exit(1);
}
if (counts.failed > 0) process.exit(1);
