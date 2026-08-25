#!/usr/bin/env node
// A SUITE COUNT WITHOUT ITS CARRIER IS NOT PORTABLE.
//
// I reported "1760 pass" across many status messages. Every one was a function of
// untracked state (`.aify-graph/`, gitignored) and an undeclared Vitest pool default. A
// reviewer could not reproduce any of them, said so repeatedly, and I filed that as a
// residual limit instead of testing it. When I finally did, both dependencies were real.
//
// review, hermes session's ruling, which this implements: a commit cannot inherit
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
import { graphIdentity as graphIdentityOf } from './graph-identity.mjs';
import { parseSummaryLine } from './summary-grammar.mjs';

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
// CARRIER 2: the recursive identity now lives in scripts/graph-identity.mjs, extracted so it
// can be called — and therefore falsified — without running the whole suite on import. Its
// differential matrix is tests/unit/graph-identity-differential.test.js.
const graphIdentity = () => graphIdentityOf(join(REPO, '.aify-graph'));

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

// ⛔ THE CHILD'S TERMINAL STATE WAS THROWN AWAY. The old catch kept stdout/stderr and dropped
// `e.status`, `e.signal` and spawn errors entirely, so success depended only on parsed counts —
// meaning a runner that died, timed out, or exited nonzero while printing a zero-failure
// summary could still produce a successful receipt. The process outcome is evidence; discarding
// it and trusting its stdout is reading the report instead of the run.
console.log('running the suite to bind counts to this carrier…\n');
const invocation = { argv: ['vitest', 'run', '--reporter=basic'], shell: true };
let raw = '';
let child = { status: 0, signal: null, spawnError: null };
try {
  raw = execFileSync('npx', invocation.argv, {
    cwd: REPO, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  raw = `${e.stdout || ''}${e.stderr || ''}`;
  child = {
    status: e.status ?? null,
    signal: e.signal ?? null,
    // ENOENT/EACCES or a signal are APPARATUS failures — the suite did not report, so there is
    // nothing to attribute, and that is categorically different from "tests failed".
    spawnError: (e.code === 'ENOENT' || e.code === 'EACCES' || e.signal) ? (e.signal ? `signal ${e.signal}` : e.code) : null,
  };
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
// review, hermes session: "A suite that changes tracked or generated state can still emit
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
// ⛔ COMPARING DIGESTS ALONE CANNOT SEE A REFUSAL. `graphIdentity()` returns
// `{present:true, digest:null, incomplete:[...]}` when the population is not fully readable —
// and TWO such states both compare `null === null`, so a withheld identity passed the interval
// check and nothing downstream required a usable one. The refusal was produced and never
// consumed. Presence, coverage and population are compared too, and a present-but-withheld
// identity refuses the receipt outright.
if (carrier.aifyGraph.present !== graphAfter.present) {
  intervalProblems.push(`.aify-graph presence changed ${carrier.aifyGraph.present} → ${graphAfter.present} during the run`);
} else if (carrier.aifyGraph.present) {
  if (carrier.aifyGraph.digest !== graphAfter.digest) {
    intervalProblems.push(`.aify-graph digest moved during the run (the suite mutated generated state)`);
  }
  if (carrier.aifyGraph.coverage !== graphAfter.coverage) {
    intervalProblems.push(`.aify-graph coverage changed ${carrier.aifyGraph.coverage} → ${graphAfter.coverage}`);
  }
  if ((carrier.aifyGraph.entries ?? []).length !== (graphAfter.entries ?? []).length) {
    intervalProblems.push(`.aify-graph population moved ${(carrier.aifyGraph.entries ?? []).length} → ${(graphAfter.entries ?? []).length} entries`);
  }
}
// A generated state that is PRESENT but whose identity was withheld cannot back a
// commit-bound receipt. Typed ABSENCE is fine — that is a stated condition, not an unknown one.
const identityProblems = [];
for (const [when, g] of [['before', carrier.aifyGraph], ['after', graphAfter]]) {
  if (g.present && g.digest === null) {
    identityProblems.push(`.aify-graph identity WITHHELD ${when} the run — ${(g.incomplete ?? []).slice(0, 3).join('; ')}`);
  }
}

// ⛔ `num()` RETURNED -1 FOR AN ABSENT CATEGORY, AND VITEST OMITS ZERO CATEGORIES.
//
// An ordinary all-green run prints `Test Files  240 passed (240)` with NO `failed` token, so
// `failed` became -1 and the nonnegative gate I had just added REFUSED — my fix for
// "unparseable output exits 0" made ORDINARY SUCCESS impossible to emit. review, hermes session
// found it from the source and the summary shape; it had never fired here because every run
// since had refused earlier, at the dirty-tree gate.
//
// ★ A missing optional category means ZERO only once the COMPLETE GRAMMAR is recognised.
// Inferring it from a failed token match is the same shape as the original defect: absence
// read as a value rather than as "the parse did not happen".
const plain = raw.replace(/\x1b\[[0-9;]*m/g, '');
const filesSummary = parseSummaryLine('Test Files', plain);
const testsSummary = parseSummaryLine('Tests', plain);
const counts = {
  testFiles: filesSummary.total ?? -1,
  testFilesPassed: filesSummary.passed ?? -1,
  testFilesFailed: filesSummary.failed ?? -1,
  total: testsSummary.total ?? -1,
  passed: testsSummary.passed ?? -1,
  failed: testsSummary.failed ?? -1,
  skipped: testsSummary.skipped ?? -1,
  todo: testsSummary.todo ?? -1,
  parsed: Boolean(filesSummary.recognised && testsSummary.recognised),
  parseProblems: [filesSummary.reason, testsSummary.reason].filter(Boolean),
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
for (const r of counts.parseProblems) countProblems.push(r);
for (const [k, v] of Object.entries(counts)) {
  if (k === 'parsed' || k === 'parseProblems') continue;
  if (!Number.isInteger(v) || v < 0) countProblems.push(`${k} is ${JSON.stringify(v)} — not a nonnegative integer`);
}
if (counts.parsed && counts.testFilesFailed > 0 && counts.failed === 0) {
  countProblems.push(`${counts.testFilesFailed} test file(s) failed but 0 tests failed — counts do not reconcile`);
}
// The child's terminal state is part of the claim, not a detail of how it was obtained.
const apparatusProblems = [];
if (child.spawnError) apparatusProblems.push(`runner did not complete: ${child.spawnError}`);
else if (child.status !== 0) apparatusProblems.push(`runner exited ${child.status} — a receipt requires exit 0 AS WELL AS reconciled counts`);

// ⛔ I CLAIMED THE TERMINAL WAS BOUND AND THEN DID NOT PUT IT IN THE ARTIFACT. `child` and
// `invocation` governed the exit code but appeared nowhere in the emitted receipt, so the thing
// a reader receives retained no command, shell mode, status, signal or spawn outcome — the
// claim lived in the code path, not in the evidence. dev's point, and it is the same
// correction-lives-elsewhere shape as putting a fix in chat instead of in the file.
//
// ⚠ `npx` + `shell:true` is AMBIENT RESOLUTION, stated rather than hidden: the receipt records
// the resolved runner version so a reader can see WHICH vitest produced these counts, but the
// invocation itself is still resolved through the shell and PATH.
const runnerVersion = (() => {
  try { return JSON.parse(readFileSync(join(REPO, 'node_modules', 'vitest', 'package.json'), 'utf8')).version ?? null; }
  catch { return null; }
})();

const receipt = {
  counts, carrier, generatedAt: new Date().toISOString(),
  runner: {
    argv: invocation.argv, shell: invocation.shell,
    // ⚠ NOT PINNED RUNNER CUSTODY, and it must not be described as such. This binds the
    // OBSERVED package version and the command description — not an immutable executable path.
    // `npx` + `shell:true` resolves through PATH and node_modules at run time.
    resolution: 'npx + shell:true — AMBIENT resolution; observed version only, NOT pinned custody',
    vitestVersion: runnerVersion,
    status: child.status, signal: child.signal, spawnError: child.spawnError,
  },
  attributionInterval: { before: validity.state, after: validityAfter.state, problems: intervalProblems },
  countProblems,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  console.log('SUITE RECEIPT');
  if (!counts.parsed) console.log(`  ⛔ SUMMARY NOT RECOGNISED — ${counts.parseProblems.join('; ')}`);
  console.log(`  counts        ${counts.passed} passed · ${counts.failed} failed · ${counts.skipped} skipped`
    + `${counts.todo ? ` · ${counts.todo} todo` : ''} of ${counts.total} in ${counts.testFiles} files`);
  console.log(`  runner        exit ${child.status}${child.signal ? ` signal ${child.signal}` : ''}`);
  console.log(`  commit        ${carrier.commit ?? '(none — not a git working copy)'}  (tree ${carrier.tree?.slice(0, 12) ?? 'n/a'})`
    + `${validity.state === 'ok' ? '' : '   ⚠ NOT the carrier of these counts — see `carrier` below'}`);
  console.log(`  carrier       ${validity.state}${validity.detail ? ` — ${validity.detail}` : ''}${validity.dirty ? ` (${validity.dirty} files)` : ''}`);
  // Coverage is printed with the digest, so nobody reads it as whole-directory identity.
  console.log(`  .aify-graph   ${carrier.aifyGraph.present
    ? `${carrier.aifyGraph.entries.length} entries, digest ${carrier.aifyGraph.digest ?? "WITHHELD"}  [${carrier.aifyGraph.coverage}]`
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
  // ⚠ ENVIRONMENTAL APPLICABILITY LIMIT, stated where someone hitting it will read it.
  //
  // If the movement is `.aify-graph`, the usual cause is SQLite sidecars — `graph.sqlite-wal`
  // and `-shm` — appearing because tests opened the graph database. This refusal is CORRECT
  // and is not a bug to be tuned away:
  //
  // ★ `-wal` IS NOT MERELY A READ ARTIFACT. In WAL mode it can hold COMMITTED database pages
  // that have not yet been checkpointed into `graph.sqlite`. Excluding it by name would let two
  // semantically DIFFERENT committed graph states share one identity — and no test over
  // filename presence could ever establish that a given WAL carried no committed state.
  // review, hermes session's ruling, and the reason I did not know when I proposed excluding it.
  //
  // ⇒ Consequence, accepted rather than worked around: this receipt cannot presently bind a run
  // whose database access changes the byte-total generated state. That is AVAILABILITY, not
  // false authority — the mechanism refusing here is it working, not failing.
  //
  // The way out, if availability ever becomes necessary, is a NEW semantic graph-state identity
  // (a coherent snapshot via the SQLite backup API or a governed checkpoint protocol), keeping
  // this total byte-tree identity under its current name and claim. Not a narrowing of it.
  if (intervalProblems.some((p) => p.includes('.aify-graph'))) {
    // ⛔ EVIDENCE, NOT AN ASSERTED CAUSE. This block previously read ".aify-graph moved BECAUSE
    // the suite opened the graph DB (SQLite -wal/-shm)" — upgrading one observed run into a
    // known cause for every future one. The gate observes MOVEMENT; it does not establish why.
    // A future move could be a hook, a concurrent writer, a test mutation, or another file
    // entirely. Assigning cause from a substring is the same defect this whole file exists to
    // prevent, committed in its own diagnostic.
    const before = new Set(carrier.aifyGraph.entries ?? []);
    const after = new Set(graphAfter.entries ?? []);
    const added = [...after].filter((e) => !before.has(e));
    const removed = [...before].filter((e) => !after.has(e));
    console.error('\n   OBSERVED population change in `.aify-graph`:');
    if (added.length) console.error(`     + ${added.slice(0, 10).join(', ')}${added.length > 10 ? ` … (+${added.length - 10})` : ''}`);
    if (removed.length) console.error(`     - ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ` … (-${removed.length - 10})` : ''}`);
    if (!added.length && !removed.length) console.error('     (population identical — content or coverage changed instead)');
    console.error('   ONE KNOWN CAUSE is SQLite sidecars (-wal/-shm) created during database access;');
    console.error('   inspect the paths above rather than assuming it. `-wal` is NOT excluded by name:');
    console.error('   it can carry COMMITTED pages, so excluding it could give two different committed');
    console.error('   states one identity.');
    console.error('   Remedies: run with `.aify-graph` typed ABSENT if that is the intended carrier;');
    console.error('   eliminate the generated-state writes; or build the separate coherent semantic');
    console.error('   snapshot identity. Quiescence cannot be presumed from a re-run — this suite');
    console.error('   opens the database itself.');
  }
  process.exit(1);
}
// A present generated state with no usable identity cannot back a commit-bound receipt.
if (identityProblems.length) {
  console.error('\n⛔ GENERATED-STATE IDENTITY NOT ESTABLISHED:');
  for (const p of identityProblems) console.error(`   · ${p}`);
  console.error('   .aify-graph is present but could not be identified. No receipt emitted.');
  process.exit(1);
}
// Apparatus first: if the runner did not complete, the counts describe nothing.
if (apparatusProblems.length) {
  console.error('\n⛔ APPARATUS — the suite run itself is not established:');
  for (const p of apparatusProblems) console.error(`   · ${p}`);
  process.exit(1);
}
// Unreadable counts are an apparatus failure and must never exit 0 on a sentinel.
if (countProblems.length) {
  console.error('\n⛔ COUNTS NOT ESTABLISHED — refusing to publish unreadable numbers:');
  for (const p of countProblems) console.error(`   · ${p}`);
  process.exit(1);
}
if (counts.failed > 0) process.exit(1);
