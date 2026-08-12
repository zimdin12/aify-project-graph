#!/usr/bin/env node
// MUTATE YOUR OWN WORK BEFORE THE REVIEWER DOES.
//
// Every substantive finding against this repo in the last two days came from someone
// changing production and observing that the tests stayed GREEN. Nothing about writing a
// test tells you whether it can fail; only breaking the thing it guards does. This turns
// that loop into something runnable instead of something remembered.
//
//   node scripts/self-review.mjs <spec.json>
//
// The spec is a list of mutations, each naming the file, an anchor to replace, its
// replacement, and the test files that SHOULD go red:
//
//   [{ "name": "drop a claim from the route",
//      "file": "mcp/stdio/stale-warning-claims.js",
//      "from": "CLAIM.VERIFY_BY_STARTED_AT, ",
//      "to": "",
//      "tests": ["tests/unit/query/stale-warning-claim-schema.test.js"],
//      "case":  "every route claim is pinned",          // REQUIRED for CAUGHT credit
//      "expect": "route must carry VERIFY_BY_STARTED_AT" }]  // the witness assertion
//
// ★★ FOUR STATES, not two. `tests[]` alone is not enough authority to credit a catch:
//
//   CAUGHT   — the tests were GREEN before the mutation, the NAMED case executed, and it
//              failed carrying the PREREGISTERED assertion message. Only this earns credit.
//   SURVIVED — exit 0 under the mutation. The guarantee does not exist. A finding.
//   INVALID  — anything structural: parse, import, config, zero-tests, hook, timeout, a
//              failure in some OTHER case, or a failure on a DIFFERENT assertion than the
//              one named. Nonzero exit, ZERO credit. Also a finding — against the spec.
//   APPARATUS_ERROR — restore/hash/parse of the apparatus itself cannot be established.
//
// ⇒ Raw per-arm vitest output is written to `.self-review-raw/` BEFORE restoration and its
// hash is printed beside each verdict. The summary line is NOT the evidence; the raw file
// is. A summary that cannot be traced to retained output is exactly how every historical
// "caught" from this tool became unverifiable.
//
// ★★ THREE CARRIER RULES, each of which I violated today at real cost:
//
//  1. RESTORE FROM AN IMMUTABLE OBJECT. Not a working-tree copy — a git blob. I restored
//     from a scratch backup taken AFTER a mutation, shipped the mutation, and the
//     contaminated tree reported GREEN because the contaminant also satisfied the
//     exemption that hid it.
//  2. ASSERT THE MUTATION APPLIED. A replacement whose anchor has drifted silently does
//     nothing, and "no test failed" then means "nothing was tested". Twice today a
//     no-op mutation read as a surviving one.
//  3. VERIFY THE RESTORE BY HASH before running anything else. A partial restore is a
//     second contaminated carrier, and the next result is about a tree nobody has seen.
//
// ⚠ Requires a CLEAN working tree for the files it touches: it restores from HEAD, so
// uncommitted edits to those files would be destroyed. It refuses to run otherwise —
// I have lost work to exactly that three times.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: self-review.mjs <spec.json>');
  process.exit(2);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const files = [...new Set(spec.map((m) => m.file))];

// RULE 1 — the pristine copy comes from git, not from the working tree.
const pristine = new Map();
for (const f of files) {
  try {
    pristine.set(f, execFileSync('git', ['show', `HEAD:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    console.error(`⛔ ${f} is not committed at HEAD — nothing immutable to restore from`);
    process.exit(2);
  }
}

// Refuse to run against uncommitted edits in the target files.
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: REPO, encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
if (dirty.length) {
  console.error('⛔ uncommitted changes in target files — commit or stash first, or this tool will destroy them:');
  for (const d of dirty) console.error(`   ${d}`);
  process.exit(2);
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const baseline = new Map([...pristine].map(([f, s]) => [f, hash(s)]));

// RULE 3 — restore, then PROVE the restore.
function restoreAndVerify() {
  for (const [f, content] of pristine) writeFileSync(join(REPO, f), content);
  for (const [f, h] of baseline) {
    const now = hash(readFileSync(join(REPO, f), 'utf8'));
    if (now !== h) {
      console.error(`⛔ RESTORE FAILED for ${f} (${now} != ${h}) — refusing to continue`);
      process.exit(3);
    }
  }
}

// ⛔ THE OLD VERSION MINTED A CATCH FROM ANY NONZERO EXIT, AND I PROVED IT AGAINST MYSELF.
//
//   catch (e) { return out.split('\n').filter(l => /^\s+×/.test(l)).length || 1; }
//
// A mutation injecting `(((` into a function signature — a pure syntax error that no
// assertion can evaluate — was reported `RED (1)` and the run concluded "✓ every mutation
// was caught." The `|| 1` fabricated the count: with no `×` lines at all (parse, import,
// collection, config or missing-file failure) it invented one.
//
// graph-senior-dev-hermes's ruling, and the part I got wrong when proposing the fix: a
// parsed `×` line or a generic AssertionError is STILL too weak. Vitest prints `×` for
// import, collection, setup, afterEach and timeout failures, and an AssertionError can
// arise before the intended witness ever runs. I proposed a narrower version of the same
// shape-reading defect as its own remedy.
//
// ⇒ The authority must be the PREREGISTERED WITNESS: the named case executed, and the
// expected failure signature appeared. Everything else is INVALID and earns zero credit.
const VERDICT = { SURVIVED: 'SURVIVED', CAUGHT: 'CAUGHT', INVALID: 'INVALID', APPARATUS: 'APPARATUS_ERROR' };

// ⚠ `--reporter=verbose` IS LOad-BEARING, not cosmetic. The default reporter does not print
// the names of PASSING tests, so baseline case-discovery could never find the witness and
// every arm classified INVALID — fail-closed, but useless. Caught by running the repaired
// tool against a spec I knew should produce one INVALID and one CAUGHT, and getting two
// INVALIDs. A tool that refuses everything is as uninformative as one that credits everything.
function runTests(tests) {
  const argv = ['vitest', 'run', '--reporter=verbose', ...tests];
  try {
    const out = execFileSync('npx', argv, { cwd: REPO, encoding: 'utf8', shell: true, stdio: 'pipe' });
    return { exit: 0, out };
  } catch (e) {
    return { exit: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const strip = (s) => s.replace(/\x1B\[[0-9;]*m/g, '');

// Structural failures prove nothing about the guarantee — they say the apparatus broke.
//
// ⚠ UNEXERCISED, STATED SO RATHER THAN IMPLIED. On the syntax-error forgery this list did
// NOT fire: vitest reported a file-level failure and the arm was rejected one rule later, by
// case-attribution ("something failed, but not the named case"). So the outcome was right
// and THESE PATTERNS ARE UNTESTED. They are defence in depth behind a rule that already
// works; do not read their presence as evidence they match anything real.
const STRUCTURAL = [
  [/Error: Failed to load|Cannot find module|ERR_MODULE_NOT_FOUND/, 'import/module resolution'],
  [/SyntaxError|Transform failed|Unexpected token|Expected .* but found/, 'parse/transform'],
  [/No test files found|no tests? (were )?(found|run)/i, 'zero tests collected'],
  [/Error: Vitest failed to (access|load) its config|Failed to resolve config/, 'config'],
  // ⚠ ANCHORED TO FAILURE, not to the hook's NAME. My first version listed a bare
  // `beforeAll`, which matches any output merely mentioning it — that would classify a
  // genuine CAUGHT as INVALID, i.e. discard real findings. A matcher that over-fires on the
  // conservative side is still a wrong matcher.
  [/Unhandled error|Error: Hook .* failed|(beforeAll|beforeEach|afterAll|afterEach)[^\n]{0,40}failed/, 'setup/teardown hook'],
  [/Test timed out in \d+ms/, 'timeout'],
];

// `m` carries the preregistered witness: `case` (stable name substring) and `expect`
// (substring of the assertion message that MUST be the one that fails).
function classify(m, result, baselineOk) {
  const out = strip(result.out);
  if (!baselineOk) return { verdict: VERDICT.INVALID, why: 'named case was not green BEFORE mutation' };
  for (const [re, label] of STRUCTURAL) {
    if (re.test(out)) return { verdict: VERDICT.INVALID, why: `structural failure (${label}) — no assertion evaluated` };
  }
  if (result.exit === 0) return { verdict: VERDICT.SURVIVED, why: 'exit 0, nothing failed' };
  if (!m.case) return { verdict: VERDICT.INVALID, why: 'spec names no witness case — cannot attribute the failure' };
  // The named case must be the one reported failing, and the expected message must appear.
  const failedNamed = new RegExp(`[×✗]\\s.*${escapeRe(m.case)}`).test(out);
  if (!failedNamed) return { verdict: VERDICT.INVALID, why: `something failed, but not the named case "${m.case}"` };
  if (m.expect && !out.includes(m.expect)) {
    return { verdict: VERDICT.INVALID, why: `named case failed on a DIFFERENT assertion than "${m.expect}"` };
  }
  return { verdict: VERDICT.CAUGHT, why: m.expect ? `named case failed on the preregistered assertion` : 'named case failed' };
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let credited = 0;
let notCredited = 0;
const rawDir = join(REPO, '.self-review-raw');
mkdirSync(rawDir, { recursive: true });
console.log(`self-review: ${spec.length} mutation(s)\n`);

for (const [i, m] of spec.entries()) {
  restoreAndVerify();

  // ⚠ PRE-MUTATION BASELINE, per dev: without it an ALREADY-RED test makes every mutation
  // look caught. The named case must be discovered and green before the mutation is applied.
  const base = runTests(m.tests);
  const baseOut = strip(base.out);
  const caseFound = !m.case || new RegExp(escapeRe(m.case)).test(baseOut);
  const baselineOk = base.exit === 0 && caseFound;
  if (!baselineOk) {
    const why = base.exit !== 0 ? 'selected tests were NOT GREEN before mutation' : `named case "${m.case}" was never collected`;
    console.log(`  ${String(m.name).padEnd(50)} ⛔ ${VERDICT.INVALID} — ${why}`);
    notCredited += 1;
    continue;
  }

  const before = readFileSync(join(REPO, m.file), 'utf8');
  const after = before.replace(m.from, m.to);
  // RULE 2 — a mutation that did not apply is not a surviving mutation.
  if (after === before) {
    console.log(`  ${String(m.name).padEnd(50)} ⛔ ${VERDICT.INVALID} — anchor missing, nothing was mutated`);
    notCredited += 1;
    continue;
  }
  writeFileSync(join(REPO, m.file), after);
  const result = runTests(m.tests);

  // RAW OUTPUT IS THE EVIDENCE CARRIER, not this summary — stored BEFORE restoration so it
  // describes the tree that produced it, and hashed so the summary cannot drift from it.
  const rawPath = join(rawDir, `arm-${String(i).padStart(2, '0')}.txt`);
  writeFileSync(rawPath, result.out);
  const rawHash = createHash('sha256').update(result.out).digest('hex').slice(0, 12);

  const { verdict, why } = classify(m, result, true);
  const mark = verdict === VERDICT.CAUGHT ? '' : verdict === VERDICT.SURVIVED ? '⚠ ' : '⛔ ';
  console.log(`  ${String(m.name).padEnd(50)} ${mark}${verdict} — ${why}  [raw ${rawHash}]`);
  if (verdict === VERDICT.CAUGHT) credited += 1; else notCredited += 1;
}
restoreAndVerify();

console.log(`\nrestore verified against HEAD blobs. raw output: ${rawDir}`);
console.log(`CAUGHT (credited): ${credited}   not credited: ${notCredited}`);
// ★ Only CAUGHT earns credit. INVALID exits nonzero and earns ZERO — a structural failure
// is not a guarantee, and treating it as one is precisely what made every historical
// "caught" from this tool unverifiable.
if (notCredited > 0) {
  console.error(`⛔ ${notCredited} arm(s) SURVIVED or were INVALID — findings, not coverage.`);
  process.exit(1);
}
console.log('✓ every mutation was caught by its preregistered witness.');
