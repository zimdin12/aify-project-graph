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
//      review, hermes session then executed three more forgeries against v2:
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
import {
  mainRepoWorkspace, openArmWorkspace, disposeArmWorkspace, ARM_WORKTREE_ROOT,
} from './lib/arm-workspace.mjs';
// ⛔ ONE anchor authority, shared with the suite-time inventory that gates it. A second
// interpretation in a test would be a different opinion about what 'the site' means.
import { applyAnchor } from './lib/anchor.mjs';
// ⛔ The loadability contract is a callable function: 0 of 35 specs were unloadable for
// nine days because nothing could ask the question without launching the apparatus.
import { validateV3Spec } from './lib/spec-schema.mjs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// THE CHECKOUT THE TEAM IS WORKING IN, AND IT HAS NO WORKING `write`.
//
// Every mutation and every restore now goes through a Workspace. This one is constructed
// read-only, so a write aimed at it THROWS instead of landing. That is the difference between
// "we were careful" and "it cannot happen": the thirty-first arm can copy the wrong line and
// still not leave mutant bytes here.
//
// Reads stay open, because reading pristine source is exactly what an arm must do.
const MAIN = mainRepoWorkspace(REPO);
const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: self-review.mjs <spec.json>');
  process.exit(2);
}

// ⛔⛔ `CAUGHT` IS RETIRED. It is not renamed, not narrowed — REMOVED as a credit.
//
// Six independent forgeries were executed against v1–v5, by review, hermes session and by me.
// EVERY ONE OF THEM FORGED A CATCH. Not one ever manufactured a survivor. Positive credit is
// the forgeable direction, and each of my five patches rejected the exact construction shown
// and left the class. When a fix has been refuted five times, the defect is the patching.
//
// dev's ruling, which this implements: the runner may retain case/message evidence for
// DEBUGGING, but must not print a catch, a credit, a coverage numerator, or any positive
// certification. A mutation tool that only reports holes cannot launder confidence.
const VERDICT = {
  SURVIVED: 'SURVIVED',                              // candidate hole; still not proof of one
  FAILURE_OBSERVED: 'FAILURE_OBSERVED_UNATTRIBUTED', // diagnostic only, ZERO coverage credit
  INVALID: 'INVALID',
  APPARATUS: 'APPARATUS_ERROR',
};
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
const validation = validateV3Spec(spec);
if (!validation.loadable) {
  for (const p of validation.problems) console.error(`⛔ ${p} — a witness is not optional`);
  process.exit(2);
}

// ⛔ THE GAUGE MUST NOT BE IN THE SUBJECT POPULATION. Dev mutated ONLY the evidence reporter
// — inserting logic that flipped a passing case to `fail` with a chosen message — and v4
// credited CAUGHT while no production guarantee was broken. `runTests` loads the reporter from
// the WORKING TREE, so a mutation to the gauge adjudicates itself.
const APPARATUS = [
  'scripts/self-review.mjs',
  'scripts/self-review-reporter.mjs',
  'vitest.config.js',
  'package.json',
  'package-lock.json',
];
for (const [i, m] of spec.entries()) {
  const f = String(m.file).replace(/\\/g, '/');
  if (APPARATUS.some((a) => f === a || f.endsWith(`/${a}`))) {
    console.error(`⛔ spec[${i}] targets APPARATUS "${m.file}". The instrument cannot be the subject:`);
    console.error('   a mutation to the gauge would be adjudicated by the mutated gauge.');
    process.exit(2);
  }
}

const files = [...new Set(spec.map((m) => m.file))];
const pristine = new Map();
// ⛔ THE CARRIER IS RESOLVED FIRST, AND A RUN THAT CANNOT NAME IT MUST NOT PROCEED.
//
// Both fields fall back to `null` when git cannot answer, and a manifest recording `commit: null`
// binds its verdict to nothing -- the same defect as a hash whose preimage nobody kept. Every
// artifact such a run produced would be unattributable to any repository state.
//
// ⚠ ORDERING IS THE WHOLE POINT, AND I GOT IT WRONG FIRST. I originally placed this check after the
// per-file "committed at HEAD" loop below, where it was SHADOWED: any repo whose HEAD cannot be
// resolved fails that loop first, so nothing could ever reach my guard. Three separate probes hit
// three different earlier guards before I noticed. A guard no input can reach is decoration.
//
// ⇒ The carrier precedes the contents. Declared OPEN in this file's header as "null commit/tree
// refusal before mutation"; closed here, before any byte is written.
const HEAD_COMMIT = (() => { try { return git('rev-parse', 'HEAD'); } catch { return null; } })();
const HEAD_TREE = (() => { try { return git('rev-parse', 'HEAD^{tree}'); } catch { return null; } })();
if (HEAD_COMMIT == null || HEAD_TREE == null) {
  console.error('⛔ APPARATUS_ERROR: cannot resolve HEAD commit/tree — a run that cannot name '
    + 'its carrier must not mutate, because nothing it produced could be attributed to a repository state.');
  process.exit(4);
}


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
  commit: HEAD_COMMIT,
  tree: HEAD_TREE,
  specPath,
  specSha256: sha(specRaw),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  arms: [],
};
const writeManifest = () => writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));


// ⚠ KEPT EVEN THOUGH DISPOSAL NOW MAKES IT REDUNDANT. A fresh worktree at HEAD already holds
// pristine bytes and is thrown away afterwards, so in principle there is nothing to restore.
// Removing a check because a redesign made it unnecessary is how the redesign's own bug ships
// unnoticed, so it runs against the workspace instead of being deleted.
function restoreAndVerify(ws) {
  for (const [f, content] of pristine) ws.write(f, content);
  for (const [f, h] of baselineHash) {
    if (sha(ws.read(f)) !== h) {
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
// Pinned once, from the committed blob, and re-checked around every invocation. Excluding the
// reporter from the spec is necessary but not sufficient — anything else that rewrites it mid
// run would still be certifying itself.
const REPORTER_SHA = sha(gitRaw('show', 'HEAD:scripts/self-review-reporter.mjs'));
const reporterIntact = (ws) => {
  try { return sha(ws.read('scripts/self-review-reporter.mjs')) === REPORTER_SHA; }
  catch { return false; }
};

// ⛔ NO SHELL. Dev's command-route forgery: `tests[]` flowed through `shell:true`, so one
// crafted selector injected a second process that wrote schema-valid evidence to
// SELF_REVIEW_OUT — reporter bytes still correctly pinned, gauge intact, ARTIFACT SUBSTITUTED.
// Vitest is now invoked as a node script directly, so argv is never interpreted by a shell.
// ⛔ VITEST_CLI (a REPO-rooted runner path) IS DELETED, not left unused. A dead constant pointing
// at the main checkout is the "legacy direct path" that gets copied back into a call site by the
// next person who needs a runner in a hurry. The runner now comes from the workspace, always.

// Selectors are repo-relative test paths and nothing else. Anything that could be an option,
// an absolute path, a traversal or a shell token is refused before it reaches argv.
function selectorProblem(t, ws) {
  if (typeof t !== 'string' || !t.length) return 'not a non-empty string';
  if (/[;&|`$(){}<>*?"'\\\n\r]/.test(t)) return 'contains shell/meta characters';
  if (t.startsWith('-')) return 'looks like a CLI option';
  if (t.includes('..')) return 'contains a path traversal';
  if (/^[a-zA-Z]:/.test(t) || t.startsWith('/')) return 'is absolute; selectors must be repo-relative';
  if (!ws.exists(t)) return 'does not exist in the workspace under test';
  return null;
}

function runTests(tests, outFile, ws) {
  if (!reporterIntact(ws)) return { apparatus: 'evidence reporter bytes differ from HEAD before invocation' };
  // ⚠ `--retry=0` is evidence hygiene, not tuning. Measured: a case with `retry: 2` emits
  // THREE failure messages, so any message-population rule would be reasoning about attempts
  // it never preregistered. Retries are disabled and non-zero retry/repeat counts are refused.
  for (const t of tests) {
    const bad = selectorProblem(t, ws);
    if (bad) return { apparatus: `refused test selector ${JSON.stringify(t)} — ${bad}` };
  }
  // Artifact custody: the evidence file must not pre-exist, and must come back bearing the
  // nonce only this invocation knows.
  if (existsSync(outFile)) return { apparatus: `evidence path already exists before invocation: ${outFile}` };
  const nonce = randomUUID();
  // ⛔ THE RUNNER AND THE CWD COME FROM THE WORKSPACE, NOT FROM REPO. Pointing vitest at the
  // main checkout would execute the UNMUTATED source and report a clean pass over code the arm
  // never touched — a green with no relationship to the mutation, which is worse than a red.
  const argv = [ws.path(join('node_modules', 'vitest', 'vitest.mjs')), 'run', '--retry=0', `--reporter=${REPORTER}`, ...tests];
  let exit = 0; let signal = null; let stdio = '';
  try {
    stdio = execFileSync(process.execPath, argv, { cwd: ws.root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SELF_REVIEW_OUT: outFile, SELF_REVIEW_NONCE: nonce } });
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
  if (json.schema !== 'self-review-evidence/3' || !Array.isArray(json.cases) || !Array.isArray(json.fileErrors)) {
    return { apparatus: `evidence schema unsupported (got ${JSON.stringify(json.schema)})` };
  }
  if (json.nonce !== nonce) return { apparatus: 'evidence file was not written by this invocation (nonce mismatch) — artifact substitution' };
  if (!reporterIntact(ws)) return { apparatus: 'evidence reporter bytes changed DURING invocation' };
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

let survived = 0; let observed = 0; let invalid = 0; let halted = false;
console.log(`self-review v6: ${spec.length} mutation(s)   run ${runId}\n`);

for (const [i, m] of spec.entries()) {
  if (halted) { console.log(`  ${String(m.name).padEnd(46)} — SKIPPED (halted by APPARATUS_ERROR)`); continue; }
  const arm = { index: i, name: m.name, file: m.file, case: m.case, expect: m.expect };
  const record = (verdict, why) => {
    arm.verdict = verdict; arm.why = why; manifest.arms.push(arm); writeManifest();
    const mark = verdict === VERDICT.SURVIVED ? '⚠ ' : verdict === VERDICT.FAILURE_OBSERVED ? '· ' : '⛔ ';
    console.log(`  ${String(m.name).padEnd(46)} ${mark}${verdict} — ${why}`);
    if (verdict === VERDICT.SURVIVED) survived += 1;
    else if (verdict === VERDICT.FAILURE_OBSERVED) observed += 1;
    else invalid += 1;
    if (verdict === VERDICT.APPARATUS) halted = true;
  };

  // ⛔ PER ARM, NOT PER RUN. A shared worktree lets a killed arm contaminate the next one and
  // reintroduces exactly the cross-arm custody this design removes. The ~200-500ms is small beside
  // two vitest executions per arm.
  let ws = null;
  const armPath = join(REPO, ARM_WORKTREE_ROOT, `arm-${runId}-${i}`);
  try {
    let transport = null;
    try { ({ workspace: ws, transport } = openArmWorkspace(REPO, HEAD_COMMIT, armPath)); }
    catch (e) {
      // ⛔ `git worktree add` IS NOT ATOMIC. It can register the worktree and THEN fail — disk full,
      // permissions, a checkout error — leaving the registration behind while this throw leaves
      // `ws` null. The `finally` below is guarded on `if (ws)`, so disposal would be SKIPPED and a
      // surviving registration is exactly the state that blocks the next run. A transient disk-full
      // would convert into a self-inflicted permanent block, recoverable only through the FOREIGN
      // path — which now demands ORPHAN_CONFIRMED with an approver and an outside observation. The
      // cheapest failure would need the most expensive cleanup.
      //
      // ⇒ Safe to dispose here for the same reason the `finally` is: armPath is CONSTRUCTED from
      // this run's own runId and index, so it can only ever name a directory this run created.
      // Self-teardown needs no orphan confirmation; the state machine governs foreign paths.
      // disposeArmWorkspace reports per step rather than throwing, so it cannot worsen the failure.
      //
      // Found in field testing reviewing 7440ceb.
      const cleanup = disposeArmWorkspace(REPO, armPath);
      const failed = cleanup.filter((c) => !c.ok);
      record(VERDICT.APPARATUS, `could not open the isolated workspace: ${e.message}`
        + (failed.length ? ` — and cleanup left ${failed.map((f) => f.step).join(', ')}` : ' — cleaned up'));
      break;
    }
    // Path is environment DISCLOSURE, not identity: commit and tree remain the source identity.
    arm.workspace = { path: armPath, dependencyTransport: transport };

    const r0 = restoreAndVerify(ws);
    if (!r0.ok) { record(VERDICT.APPARATUS, `restore/hash failed for ${r0.file} before baseline`); break; }

    // ── BASELINE, retained. v2 kept only mutant output while claiming baseline discovery.
    const baseFile = join(runDir, `arm-${i}-baseline.json`);
    const base = runTests(m.tests, baseFile, ws);
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
    // ⛔ RESOLVE, THEN MUTATE — they used to be one `String.replace` call. With a string argument
    // it replaces only the FIRST occurrence, so a DUPLICATED anchor mutated one site, satisfied
    // `after !== before`, and let the arm attribute a red test to a site nobody chose. Absent
    // failed closed; ambiguous did not fail at all. This was listed under OPEN in this file's own
    // header as "single-occurrence anchor enforcement" and is now closed.
    const before = ws.read(m.file);
    const applied = applyAnchor(before, m.from, m.to);
    if (!applied.applied) {
      const where = applied.occurrences ? ` at offsets ${applied.occurrences.join(', ')}` : '';
      record(VERDICT.INVALID, `${applied.reason}: anchor resolved as ${applied.state}${where} — nothing was mutated`);
      continue;
    }
    const after = applied.after;
    arm.mutation = { preSha256: sha(before), postSha256: sha(after), anchorOffset: applied.index };
    ws.write(m.file, after);

    const mutFile = join(runDir, `arm-${i}-mutant.json`);
    const mut = runTests(m.tests, mutFile, ws);
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
    // ⚠ ATTEMPT POPULATION. Measured: `retry: 2` yields THREE messages on one case, so any
    // message rule without this is reasoning about attempts nobody preregistered.
    if (same.retryCount || same.repeatCount) {
      record(VERDICT.INVALID, `case was retried/repeated (retry=${same.retryCount}, repeat=${same.repeatCount}) — attempt-multiplied evidence`);
      continue;
    }
    // ⛔ FAIL CLOSED ON UNATTRIBUTABLE ORIGIN. Vitest 3.2.4 gives no lifecycle phase, so a
    // `beforeEach` throw occupies the SAME slot as a body assertion — dev credited a CAUGHT
    // that way while the body never executed. Since origin cannot be established, anything
    // that is not a single AssertionError is refused.
    //
    // ★ THIS IS A CONTAMINATION FILTER, NOT ROUTE AUTHORITY, and saying otherwise would be
    // the same overclaim four rounds running: a hook CAN throw an AssertionError (call
    // `expect` inside `beforeEach`) and would pass this. The class closer is a body-entry
    // witness hooks cannot mint, and it is NOT BUILT.
    if (same.messages.length !== 1) {
      record(VERDICT.INVALID, `case carries ${same.messages.length} failure messages; exactly 1 is accountable — extra: ${same.messages.filter((x) => !x.includes(m.expect))[0]?.slice(0, 50) ?? '(none matched)'}`);
      continue;
    }
    if (same.errorTypes[0] !== 'AssertionError') {
      record(VERDICT.INVALID, `failure is a ${same.errorTypes[0]}, not an AssertionError — body origin cannot be established (hook throw impersonates the witness)`);
      continue;
    }
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
    // ⚠ THIS IS THE END OF THE ROAD FOR THIS ARM, AND IT IS NOT A CATCH. The exact case went
    // pass→fail carrying the preregistered assertion, with one accountable message, no retries
    // and no non-case errors. That is the strongest evidence this instrument can produce — and
    // it is STILL not proof the body executed, because `expect()` inside `beforeEach` produces
    // exactly this shape (measured). Reported as a diagnostic, credited as nothing.
    record(VERDICT.FAILURE_OBSERVED, 'exact case failed on the preregistered assertion — DIAGNOSTIC ONLY, body execution unproven');
  } finally {
    // RULE 3 — restoration is not optional and not conditional on the path taken.
    if (ws) {
      const r = restoreAndVerify(ws);
      if (!r.ok) {
        manifest.restorationFailure = r.file;
        writeManifest();
        console.error(`⛔ APPARATUS_ERROR: restore/hash failed for ${r.file} in the arm workspace`);
        halted = true;
      }
      // ⚠ EVERY REMOVAL STEP'S RESULT TRAVELS, not one boolean. A surviving registration is the
      // state that blocks the next run, so it has to be legible rather than swallowed.
      arm.disposal = disposeArmWorkspace(REPO, armPath);
      const failed = arm.disposal.filter((d) => !d.ok);
      if (failed.length) console.error(`⚠ arm ${i} disposal incomplete: ${failed.map((f) => f.step).join(', ')}`);
      writeManifest();
    }
  }
}

manifest.finishedAtIso = new Date().toISOString();
manifest.survived = survived;
manifest.failureObserved = observed;
manifest.invalid = invalid;
writeManifest();

console.log(`\nrun custody: ${runDir}`);
console.log(`SURVIVED (candidate holes): ${survived}   FAILURE_OBSERVED (diagnostic, no credit): ${observed}   INVALID: ${invalid}`);
console.log('\nTHIS TOOL CERTIFIES NOTHING. It reports candidate holes and diagnostics.');
console.log('No output here is evidence that a guarantee EXISTS; SURVIVED is evidence one may be missing.');
// ⚠ OPEN, stated rather than implied — none of these are closed and none should be read as
// closed by a quiet run:
//   · per-arm worktree isolation: mutations run in THIS checkout, so a hard kill between
//     mutate and restore leaves mutant bytes on disk;
//   · body-entry witness: `expect()` inside `beforeEach` produces the same evidence shape as a
//     body assertion, so even FAILURE_OBSERVED does not prove the body ran;
//   · per-arm APPARATUS_ERROR recording on `finally` restore.
// ⇒ CLOSED SO FAR, and only these three. Each names where it lives, so the claim can be checked
// rather than believed:
//   · single-occurrence anchor enforcement — `scripts/lib/anchor.mjs`; absent and ambiguous are
//     distinct INVALID reasons and neither mutates a byte;
//   · expectFailures type validation — `scripts/lib/spec-schema.mjs`; a non-integer is an
//     uncomparable total and 0 would credit an arm whose mutation broke nothing, which is a
//     SURVIVED hole rather than a witness;
//   · null commit/tree refusal before mutation — above, exiting 4 before any bytes are written.
// The items still listed above are OPEN and are not closed by these.
if (survived > 0 || invalid > 0 || halted) {
  console.error(`\n⛔ ${survived} candidate hole(s), ${invalid} invalid arm(s) — read the manifest, not this line.`);
  process.exit(1);
}
console.log('\nNo candidate holes and no invalid arms in this spec. That is not coverage.');
