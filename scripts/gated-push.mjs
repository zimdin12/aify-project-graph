// REFUSE TO PUSH WHAT THE SUITE HAS NOT MEASURED.
//
// ⛔ WHY THIS EXISTS. This repo's rule is "full suite green before push", with no docs-only
// exemption. On 2026-09-03 I pushed a plan edit on the fast doc gates alone, having run the full
// suite for docs-only commits earlier the same session. It happened to be green; that is luck, not
// process.
//
// ⭐ THE PATTERN THAT MADE IT WORTH AUTOMATING: every OTHER rule that caught me that night was
// MECHANICAL — run-suite refusing on a dirty tree, the commit stamp exposing a suite that never ran,
// the negative-assertions ratchet, the citation gate. This rule had nothing to fire, because it
// relied on me remembering. A rule with no instrument is a rule with a failure rate.
//
// ⚠ IT READS THE LOG, NEVER AN EXIT STATUS. `run-suite` writes `SUITE FOR COMMIT <sha>` and
// `VITEST_EXIT=<n>` into docs/evidence/suite/latest.log. Both are needed: the harness notification
// has reported "exit code 0" for a RED suite, and a pipe through `tail` has masked a refusal — both
// observed in this repo. The log is the only channel that has not lied.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(REPO, 'docs/evidence/suite/latest.log');

// The ONLY file a commit may touch and still count as "already measured": the suite log itself,
// which is written BY the run it records. Anything else is content the suite never saw.
export const EVIDENCE_ONLY = new Set(['docs/evidence/suite/latest.log']);

export function readStamp(text) {
  const sha = text.match(/SUITE FOR COMMIT ([0-9a-f]{7,40})/)?.[1] ?? null;
  const exitMatch = text.match(/VITEST_EXIT=(-?\d+)/);
  return { sha, exit: exitMatch ? Number(exitMatch[1]) : null };
}

/**
 * Decide whether HEAD is covered by the stamped run.
 *
 * ⚠ PURE, so it is testable without a git repo or a push. The caller supplies what git observed.
 */
export function verdict({ stamp, headSha, commitsAfterStamp, stampIsAncestor }) {
  if (!stamp.sha) return { ok: false, why: 'no SUITE FOR COMMIT stamp in the suite log — no run to trust' };
  if (stamp.exit === null) return { ok: false, why: 'no VITEST_EXIT in the suite log — the run did not finish' };
  if (stamp.exit !== 0) return { ok: false, why: `the last suite was RED (VITEST_EXIT=${stamp.exit})` };
  if (stamp.sha === headSha) return { ok: true, why: `HEAD is the measured commit (${headSha.slice(0, 7)})` };
  if (!stampIsAncestor) {
    return { ok: false, why: `the stamped commit ${stamp.sha.slice(0, 7)} is NOT an ancestor of HEAD — `
      + 'that log describes a different line of history' };
  }
  // ⛔ A commit after the stamp is allowed ONLY if it touches nothing but the suite log. That is the
  // evidence commit, produced by the very run being trusted. Everything else is unmeasured content.
  const unmeasured = commitsAfterStamp.filter((c) => !c.files.every((f) => EVIDENCE_ONLY.has(f)));
  if (unmeasured.length > 0) {
    return { ok: false, why: `${unmeasured.length} commit(s) after the measured one change files the `
      + `suite never saw: ${unmeasured.map((c) => `${c.sha.slice(0, 7)} (${c.files.slice(0, 3).join(', ')})`).join('; ')}` };
  }
  return { ok: true, why: `HEAD is ${commitsAfterStamp.length} evidence-only commit(s) past the measured ${stamp.sha.slice(0, 7)}` };
}

/**
 * Turn a verdict plus argv into the ONE action to take. Pure, so it is testable.
 *
 * ⛔ WHY THIS IS NOT INLINE IN main(). The hook calls this script DURING a push. If the --check
 * path ever falls through to the push, the hook re-enters git push and recurses. That is a
 * behaviour worth a test, and a branch buried inside main() next to `git push` and `process.exit`
 * cannot be tested without either pushing or killing the test runner.
 *
 * ⚠ Extracting it does not by itself prove main() USES it — that is the wired-not-consumed gap, and
 * it is why main() below is a five-line switch you can read in one glance rather than a flow.
 */
export function pushPlan({ ok, argv }) {
  if (!ok) return { action: 'refuse' };
  if (argv.includes('--check')) return { action: 'check-only' };
  // No --check filtering here: the branch above already returned, so argv cannot still contain it.
  // A filter for a case that cannot arrive reads as a handled case and is not one.
  return { action: 'push', args: argv.length ? argv : ['origin', 'main'] };
}

function git(...args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
}

function main() {
  if (!existsSync(LOG)) {
    console.error('REFUSED: no suite log at docs/evidence/suite/latest.log. Run scripts/run-suite.mjs first.');
    process.exit(2);
  }
  const stamp = readStamp(readFileSync(LOG, 'utf8'));
  const headSha = git('rev-parse', 'HEAD');

  let stampIsAncestor = false;
  try { git('merge-base', '--is-ancestor', stamp.sha ?? 'HEAD', 'HEAD'); stampIsAncestor = true; }
  catch { stampIsAncestor = false; }

  const commitsAfterStamp = stamp.sha && stampIsAncestor && stamp.sha !== headSha
    ? git('rev-list', `${stamp.sha}..HEAD`).split('\n').filter(Boolean).map((sha) => ({
      sha,
      files: git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean),
    }))
    : [];

  const { ok, why } = verdict({ stamp, headSha, commitsAfterStamp, stampIsAncestor });
  if (!ok) {
    console.error(`REFUSED TO PUSH: ${why}`);
    console.error('\nRun `node scripts/run-suite.mjs`, commit the log, then push.');
    console.error('This rule has no docs-only exemption — it was broken exactly once by assuming one.');
    process.exit(2);
  }

  console.log(`suite coverage OK — ${why}`);

  // ⛔ --check EXISTS SO THIS CAN BE A FORCED DOOR, NOT A TOOL I MUST REMEMBER.
  //
  // A gate you have to invoke is still a rule with a failure rate: a plain `git push` walks straight
  // past it, which is the same "relies on memory" defect one level up from the one this file fixes.
  // The pre-push hook calls `--check`, so the verdict runs during ANY push and aborts by exit code.
  //
  // ⚠ The hook must NOT push: it runs mid-push, so pushing here would recurse.
  const plan = pushPlan({ ok, argv: process.argv.slice(2) });
  if (plan.action === 'check-only') return;

  execFileSync('git', ['-C', REPO, 'push', ...plan.args], { stdio: 'inherit' });
}

// ⛔ SELF-EXECUTE ONLY WHEN RUN AS A SCRIPT, NEVER ON IMPORT — AND NOT VIA AN ENV VAR.
//
// `linkage-scope-runner.mjs` guards this with `if (!process.env.APG_LINKAGE_RUNNER_NO_MAIN)`, and on
// 2026-09-03 three test files I wrote imported it WITHOUT setting that var: every suite run then
// executed the whole harness three times and wrote junk into the tracked tree. An env-var guard only
// works if every future caller remembers it — which is the same "rule with no instrument" failure
// this file exists to fix, one level down.
//
// ⚠ AND THE STAKES HERE ARE HIGHER THAN JUNK FILES. main() ends in `git push`. A test that imported
// this module unguarded would PUSH during the suite.
//
// Comparing import.meta.url to argv[1] needs nothing from the caller: importing is safe by
// construction, running it as a script still works.
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
