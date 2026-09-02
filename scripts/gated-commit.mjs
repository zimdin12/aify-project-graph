// Commit ONLY if the fast documentation/evidence gates pass. Message on stdin.
//
//   node scripts/gated-commit.mjs <<'MSG'
//   subject line
//
//   body...
//   MSG
//
// ⛔ WHY THIS EXISTS. Twice in this arc a check ran, went RED, and the work landed anyway — a push
// after a RED suite, and a commit after a RED citation gate. Both times the mechanism was identical
// and had nothing to do with the check: I chained it with `;` instead of `&&`, so nothing consumed
// the result. A check whose result nothing consumes is not a gate.
//
// "Remember to use &&" is a rule I have to remember, and a rule is not a remedy. This script owns the
// sequence, so there is no separator left for me to get wrong.
//
// ⚠ SCOPE, so this is not mistaken for the push gate: it runs the SUB-SECOND doc/evidence gates only.
// It does NOT run the full suite, and passing here is NOT permission to push. The full suite still
// has to be green for the commit being pushed, read from VITEST_EXIT in the log.
//
// ⚠ The message arrives on STDIN and reaches git through `commit -F -`. It is never interpolated
// into a shell command, so backslashes, quotes and newlines survive intact — the failure mode that
// has corrupted content in this project repeatedly.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATES = 'tests/unit/docs/';

const message = readFileSync(0, 'utf8');
if (!message.trim()) {
  console.error('REFUSED: empty commit message on stdin.');
  process.exit(2);
}

console.log(`running the fast gates (${GATES}) before committing...`);
const gate = spawnSync('npx', ['vitest', 'run', GATES, '--reporter=dot'], {
  cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32',
});
const out = `${gate.stdout ?? ''}${gate.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');

if (gate.status !== 0) {
  console.error(out.split('\n').filter((l) => /FAIL|AssertionError|Tests |✗|×/.test(l)).join('\n'));
  console.error(`\nREFUSED: the gates are RED (exit ${gate.status}). Nothing was committed.`);
  console.error('Fix the failure — do not bypass this by calling git directly.');
  process.exit(1);
}
console.log(out.split('\n').filter((l) => /Tests /.test(l)).join('\n') || 'gates passed');

// ⛔ Only reached on a GREEN gate. add and commit are the same step as the check, by construction.
const add = spawnSync('git', ['add', '-A'], { cwd: REPO, encoding: 'utf8' });
if (add.status !== 0) {
  console.error(`REFUSED: git add failed: ${add.stderr}`);
  process.exit(1);
}
const commit = spawnSync('git', ['commit', '-q', '-F', '-'], { cwd: REPO, input: message, encoding: 'utf8' });
if (commit.status !== 0) {
  console.error(`git commit failed: ${commit.stdout}${commit.stderr}`);
  process.exit(commit.status ?? 1);
}
const log = spawnSync('git', ['log', '--oneline', '-1'], { cwd: REPO, encoding: 'utf8' });
console.log(`committed: ${log.stdout.trim()}`);
console.log('⚠ the full suite still has to be green for this commit before it may be pushed.');
