#!/usr/bin/env node
// MUTATE YOUR OWN WORK BEFORE THE REVIEWER DOES.
//
//   node scripts/self-review.mjs <spec.json>
//
// Spec entries REQUIRE a preregistered witness. `case` and `expect` are not optional:
//
//   [{ "name":   "resolver returns sample as population",
//      "file":   "mcp/stdio/query/verbs/packet.js",
//      "from":   "if (Number.isInteger(total) && total >= sampleLength) ...",
//      "to":     "return { attested: true, total: sampleLength };",
//      "tests":  ["tests/unit/query/packet-population-fail-closed.test.js"],
//      "case":   "RESOLVER — only a producer-attested",      // must match EXACTLY ONE case
//      "expect": "population is carried even when it equals the sample", // in ITS failureMessages
//      "expectFailures": 1 }]                                 // optional; defaults to 1
//
// ★★★ THIS TOOL HAS BEEN WRONG THREE TIMES, EACH TIME BY READING SHAPE INSTEAD OF ROUTE.
//
//  v1  `|| 1` minted an assertion count from ANY nonzero exit. A `(((` syntax error that no
//      assertion could evaluate was reported RED and the run concluded "every mutation was
//      caught."
//  v2  I "fixed" it by accepting a parsed `×` line — a narrower version of the same defect.
//      graph-senior-dev-hermes then executed three more forgeries against v2:
//        A. `expect` was OPTIONAL, so CAUGHT could be credited on case-name shape alone.
//        B. `out.includes(expect)` was a WHOLE-OUTPUT predicate, unbound from the failed
//           case — text in a case NAME, a console log or a sibling failure satisfied it.
//        C. The STRUCTURAL regex list fired on VOCABULARY: a genuine intended assertion whose
//           message contained "Unhandled error" was classified INVALID and its real CAUGHT
//           discarded. A matcher that censors correct findings is worse than an absent one.
//
// ⇒ v3 STOPS PARSING HUMAN TEXT. Vitest's JSON reporter yields per-case `fullName`, `status`
// and `failureMessages`, so identity and attribution come from structure, not vocabulary.
// There is no global text predicate anywhere in this file, by design.
//
// ★★ CARRIER RULES, each violated at real cost:
//  1. RESTORE FROM AN IMMUTABLE OBJECT — a git blob, never a working-tree copy.
//  2. ASSERT THE MUTATION APPLIED — a drifted anchor does nothing, and "no test failed" then
//     means "nothing was tested".
//  3. VERIFY THE RESTORE BY HASH, in a `finally`, before anything else runs.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: self-review.mjs <spec.json>');
  process.exit(2);
}

const VERDICT = { SURVIVED: 'SURVIVED', CAUGHT: 'CAUGHT', INVALID: 'INVALID', APPARATUS: 'APPARATUS_ERROR' };
const sha = (s) => createHash('sha256').update(s).digest('hex');
// ⚠ TWO HELPERS, AND THE DISTINCTION IS LOAD-BEARING. `git()` trims, which is right for
// rev-parse/status and CATASTROPHIC for blob content: reusing it for `git show` stripped the
// trailing newline from every restored file, so each run silently rewrote a byte of the
// source. Worse, `restoreAndVerify()` hashed that SAME trimmed content, so the check
// validated against its own corruption and reported OK — a verifier that cannot see the
// defect it was written to catch. Found because the next run refused on a dirty tree.
const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const gitRaw = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const specRaw = readFileSync(specPath, 'utf8');
const spec = JSON.parse(specRaw);

// ── SPEC VALIDATION. `case` and `expect` were optional in v2 and dev credited a CAUGHT with
// no assertion authority at all. Required now, before any mutation runs.
for (const [i, m] of spec.entries()) {
  for (const k of ['name', 'file', 'from', 'to', 'tests', 'case', 'expect']) {
    if (!m[k] || (Array.isArray(m[k]) && !m[k].length)) {
      console.error(`⛔ spec[${i}] "${m.name || '?'}" is missing required field "${k}" — a witness is not optional`);
      process.exit(2);
    }
  }
}

const files = [...new Set(spec.map((m) => m.file))];
const pristine = new Map();
for (const f of files) {
  try { pristine.set(f, gitRaw('show', `HEAD:${f}`)); }
  catch { console.error(`⛔ ${f} is not committed at HEAD — nothing immutable to restore from`); process.exit(2); }
}
// ⛔ THE CLEAN CHECK USED TO COVER ONLY THE MUTATION TARGETS, AND DEV MINTED A COMMIT-SHAPED
// CAUGHT THROUGH THE HOLE. They left the production target pristine at HEAD, made an
// UNCOMMITTED edit to the selected TEST file so its assertion fired on an arbitrary token,
// then mutated a production comment to add that token. Verdict: CAUGHT, exit 0 — while the
// manifest presented HEAD/tree identity and the decisive witness came from unbound bytes.
//
// ⇒ THE WHOLE TREE MUST BE CLEAN. Not the target files, not "target files plus the tests" —
// enumerating the apparatus (tests, vitest config, setup files, transitive helpers, package
// and lock, wrapper scripts) is a closure I cannot compute reliably, and every item I forgot
// would be another authoring surface. Refusing an ambient working-tree superset outright is
// the only version of this I can actually defend.
const dirtyAll = git('status', '--porcelain').split('\n').map((l) => l.trim()).filter(Boolean);
if (dirtyAll.length) {
  console.error('⛔ WORKING TREE IS NOT CLEAN. Every verdict this tool emits is bound to a commit,');
  console.error('   and uncommitted bytes anywhere — a test file, vitest config, a helper — can author');
  console.error('   the witness that gets credited. Commit or stash first.');
  for (const d of dirtyAll.slice(0, 20)) console.error(`   ${d}`);
  if (dirtyAll.length > 20) console.error(`   … and ${dirtyAll.length - 20} more`);
  process.exit(2);
}
const baselineHash = new Map([...pristine].map(([f, s]) => [f, sha(s)]));

// ── RUN CUSTODY. v2 wrote `arm-NN.txt` into a fixed directory, so every run overwrote the
// previous run's evidence and a printed hash had no durable referent. A unique run directory,
// created EXCLUSIVELY (recursive:false throws on collision), plus a manifest binding
// commit/tree/spec/mutation bytes to every artifact.
const runId = randomUUID();
const runDir = join(REPO, '.self-review-raw', runId);
try { mkdirSync(runDir, { recursive: false }); }
catch (e) {
  if (e.code !== 'ENOENT') { console.error(`⛔ APPARATUS_ERROR: run directory collision or unwritable: ${e.message}`); process.exit(4); }
  mkdirSync(join(REPO, '.self-review-raw'), { recursive: true });
  try { mkdirSync(runDir, { recursive: false }); }
  catch (e2) { console.error(`⛔ APPARATUS_ERROR: cannot create run dir: ${e2.message}`); process.exit(4); }
}
const manifest = {
  runId,
  startedAtIso: new Date().toISOString(),
  commit: (() => { try { return git('rev-parse', 'HEAD'); } catch { return null; } })(),
  tree: (() => { try { return git('rev-parse', 'HEAD^{tree}'); } catch { return null; } })(),
  specPath,
  specSha256: sha(specRaw),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  arms: [],
};
const writeManifest = () => writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

function restoreAndVerify() {
  for (const [f, content] of pristine) writeFileSync(join(REPO, f), content);
  for (const [f, h] of baselineHash) {
    if (sha(readFileSync(join(REPO, f), 'utf8')) !== h) {
      return { ok: false, file: f };
    }
  }
  return { ok: true };
}

// ── EXECUTION. Apparatus failures (spawn, signal, unparseable report) are TYPED, not folded
// into test results. v2 collapsed ENOENT, signals and maxBuffer into the same classifier,
// where some became INVALID by luck and none could become APPARATUS_ERROR.
// ⛔ THE BUILT-IN JSON REPORTER CANNOT SEE THE DEFECT DEV FORGED WITH. Measured: one file,
// one failing case, with and without an `afterAll` throw — the two reports are IDENTICAL in
// every scalar field and the error text appears nowhere in either. `numFailedTestSuites` reads
// 2 in BOTH, so it is not a discriminator (the nearby-negative control caught that before I
// shipped it). We therefore emit our own evidence via scripts/self-review-reporter.mjs, which
// carries the non-case error population — suite-level hook failures included.
const REPORTER = './scripts/self-review-reporter.mjs';
function runTests(tests, outFile) {
  const argv = ['vitest', 'run', `--reporter=${REPORTER}`, ...tests];
  let exit = 0; let signal = null; let stdio = '';
  try {
    stdio = execFileSync('npx', argv, { cwd: REPO, encoding: 'utf8', shell: true, stdio: 'pipe', env: { ...process.env, SELF_REVIEW_OUT: outFile } });
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EACCES') return { apparatus: `spawn failed: ${e.code}` };
    if (e.signal) return { apparatus: `terminated by signal ${e.signal}` };
    exit = e.status ?? 1; signal = e.signal ?? null; stdio = `${e.stdout || ''}${e.stderr || ''}`;
  }
  if (!existsSync(outFile)) return { apparatus: 'reporter produced no evidence file' };
  let json;
  try { json = JSON.parse(readFileSync(outFile, 'utf8')); }
  catch (e) { return { apparatus: `evidence file unparseable: ${e.message}` }; }
  // SCHEMA PIN. An unsupported evidence shape is an APPARATUS failure, not a missing case —
  // otherwise a reporter change would silently degrade every arm to INVALID and read as data.
  if (json.schema !== 'self-review-evidence/1' || !Array.isArray(json.cases) || !Array.isArray(json.fileErrors)) {
    return { apparatus: `evidence schema unsupported (got ${JSON.stringify(json.schema)})` };
  }
  return { exit, signal, json, stdio, argv: argv.join(' ') };
}

// Case identity comes from `fullName`, and must be UNIQUE. v2 matched substrings against the
// whole verbose transcript, where a comment, a console line or a sibling prefix satisfied it.
function findCases(json, needle) {
  const all = json.cases;
  return { all, hits: all.filter((c) => c.fullName.includes(needle)) };
}

// Collection/setup failure is read from STRUCTURE — a file that failed while contributing no
// case results — never from vocabulary. v2's regex list demoted a genuine CAUGHT because its
// assertion message happened to contain "Unhandled error".
// Collection/import failure now shows as ZERO cases plus a non-case error, both structural.
function structuralFailure(json) {
  if (json.cases.length === 0) {
    const e = json.fileErrors[0];
    return e ? `no cases executed; ${e.scope} error: ${String(e.message).slice(0, 80)}` : 'no cases executed at all';
  }
  return null;
}

let credited = 0; let notCredited = 0; let halted = false;
console.log(`self-review v4: ${spec.length} mutation(s)   run ${runId}\n`);

for (const [i, m] of spec.entries()) {
  if (halted) { console.log(`  ${String(m.name).padEnd(46)} — SKIPPED (halted by APPARATUS_ERROR)`); continue; }
  const arm = { index: i, name: m.name, file: m.file, case: m.case, expect: m.expect };
  const record = (verdict, why) => {
    arm.verdict = verdict; arm.why = why; manifest.arms.push(arm); writeManifest();
    const mark = verdict === VERDICT.CAUGHT ? '' : verdict === VERDICT.SURVIVED ? '⚠ ' : '⛔ ';
    console.log(`  ${String(m.name).padEnd(46)} ${mark}${verdict} — ${why}`);
    if (verdict === VERDICT.CAUGHT) credited += 1; else notCredited += 1;
    if (verdict === VERDICT.APPARATUS) halted = true;
  };

  try {
    const r0 = restoreAndVerify();
    if (!r0.ok) { record(VERDICT.APPARATUS, `restore/hash failed for ${r0.file} before baseline`); break; }

    // ── BASELINE, retained. v2 kept only mutant output while claiming baseline discovery.
    const baseFile = join(runDir, `arm-${i}-baseline.json`);
    const base = runTests(m.tests, baseFile);
    if (base.apparatus) { record(VERDICT.APPARATUS, `baseline: ${base.apparatus}`); break; }
    arm.baselineArtifact = { path: `arm-${i}-baseline.json`, sha256: sha(readFileSync(baseFile, 'utf8')), exit: base.exit, command: base.argv };

    const b = findCases(base.json, m.case);
    if (b.hits.length === 0) { record(VERDICT.INVALID, `named case "${m.case}" was not collected in the baseline`); continue; }
    if (b.hits.length > 1) { record(VERDICT.INVALID, `named case "${m.case}" is AMBIGUOUS — matches ${b.hits.length} cases`); continue; }
    const identity = b.hits[0].fullName;   // exact identity carried forward
    arm.caseIdentity = identity;
    if (b.hits[0].status !== 'pass') { record(VERDICT.INVALID, `named case was not PASSING before mutation (${b.hits[0].status})`); continue; }
    // A baseline carrying ANY non-case error is not a clean baseline to measure against.
    if (base.json.fileErrors.length) { record(VERDICT.INVALID, `baseline had ${base.json.fileErrors.length} non-case error(s) — not a clean measurement carrier`); continue; }
    if (base.exit !== 0) { record(VERDICT.INVALID, 'baseline run was not green'); continue; }

    // ── MUTATE
    const before = readFileSync(join(REPO, m.file), 'utf8');
    const after = before.replace(m.from, m.to);
    if (after === before) { record(VERDICT.INVALID, 'anchor missing — nothing was mutated'); continue; }
    arm.mutation = { preSha256: sha(before), postSha256: sha(after) };
    writeFileSync(join(REPO, m.file), after);

    const mutFile = join(runDir, `arm-${i}-mutant.json`);
    const mut = runTests(m.tests, mutFile);
    if (mut.apparatus) { record(VERDICT.APPARATUS, `mutant: ${mut.apparatus}`); break; }
    arm.mutantArtifact = { path: `arm-${i}-mutant.json`, sha256: sha(readFileSync(mutFile, 'utf8')), exit: mut.exit, command: mut.argv };

    const structural = structuralFailure(mut.json);
    const after1 = findCases(mut.json, m.case);
    const same = after1.all.find((c) => c.fullName === identity);

    if (!same) {
      record(VERDICT.INVALID, structural
        ? `the named case did not execute — ${structural}`
        : 'the named case did not execute under the mutant (discovery/selection changed)');
      continue;
    }
    if (same.status === 'pass') { record(VERDICT.SURVIVED, 'the named case executed and still passed — the guarantee does not exist'); continue; }
    if (same.status !== 'fail') { record(VERDICT.INVALID, `named case status was "${same.status}", not a failure`); continue; }

    // ── ATTRIBUTION: the expected witness must appear in THIS case's failureMessages.
    // v2 searched the whole transcript, so a case NAME or console line forged it.
    if (!same.messages.some((msg) => msg.includes(m.expect))) {
      record(VERDICT.INVALID, `named case failed, but NOT on the preregistered assertion "${m.expect}"`);
      continue;
    }
    // ── POPULATION: unrelated sibling failures must not ride along on a credited catch.
    const failed = after1.all.filter((c) => c.status === 'fail');
    const wanted = m.expectFailures ?? 1;
    if (failed.length !== wanted) {
      record(VERDICT.INVALID, `expected ${wanted} failing case(s), observed ${failed.length} — population does not reconcile`);
      continue;
    }
    // ⛔ THE NON-CASE ERROR POPULATION, which v3 did not reconcile at all. Dev credited a
    // CAUGHT while an unrelated `afterAll` threw alongside the intended failure: the classifier
    // counted failing CASES and never asked whether anything else had broken. Expected to be
    // ZERO unless a spec deliberately preregisters otherwise.
    const wantedErrors = m.expectNonCaseErrors ?? 0;
    if (mut.json.fileErrors.length !== wantedErrors) {
      const first = mut.json.fileErrors[0];
      record(VERDICT.INVALID, `expected ${wantedErrors} non-case error(s), observed ${mut.json.fileErrors.length}`
        + (first ? ` — e.g. ${first.scope}: ${String(first.message).slice(0, 60)}` : ''));
      continue;
    }
    record(VERDICT.CAUGHT, 'exact case transitioned pass→fail on the preregistered assertion');
  } finally {
    // RULE 3 — restoration is not optional and not conditional on the path taken.
    const r = restoreAndVerify();
    if (!r.ok) {
      manifest.restorationFailure = r.file;
      writeManifest();
      console.error(`⛔ APPARATUS_ERROR: restore/hash failed for ${r.file} — working tree may hold mutant bytes`);
      halted = true;
    }
  }
}

manifest.finishedAtIso = new Date().toISOString();
manifest.credited = credited;
manifest.notCredited = notCredited;
writeManifest();

console.log(`\nrun custody: ${runDir}`);
console.log(`CAUGHT (credited): ${credited}   not credited: ${notCredited}`);
// ⚠ NOT DONE, stated rather than implied: mutations still run in THIS checkout, not in a
// disposable per-arm worktree. A kill between mutate and restore leaves mutant bytes on disk;
// the manifest records the arm but cannot rewrite history. That is dev's redesign item 7 and
// it is open.
if (notCredited > 0 || halted) {
  console.error(`⛔ ${notCredited} arm(s) SURVIVED / INVALID / APPARATUS — findings, not coverage.`);
  process.exit(1);
}
console.log('✓ every mutation was caught by its exact preregistered witness.');
