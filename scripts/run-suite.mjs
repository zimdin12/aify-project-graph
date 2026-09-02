// Run the full suite and land its log in the repo WITHOUT perturbing the run.
//
//   node scripts/run-suite.mjs            # exits with vitest's real code
//
// ⛔ WHY THIS EXISTS. Un-ignoring docs/evidence/**/*.log put the suite log under version control —
// correct, evidence must be reachable from git — and I kept writing it LIVE into the tracked tree.
// The repo was then tracked-dirty during its own suite run, and packet-snapshot-line.test.js, which
// compares `git diff` against the packet's `dirty=` field on the REAL repo, went red. The evidence
// artifact had started perturbing the measurement it existed to record.
//
// "Never write into the tree while a suite measures it" is a rule I have to remember. This is the
// door: the live handle is a scratch file, and only the FINISHED log is copied into the repo.
//
// ⚠ The exit code is vitest's own, taken from the child process — not from a pipeline, a wrapper, or
// a harness summary. A harness notification has twice reported "exit code 0" for a RED suite in this
// project, so the log carries VITEST_EXIT and the log is the authority.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(REPO, 'docs/evidence/suite/latest.log');
const SCRATCH = join(tmpdir(), `apg-suite-${process.pid}-${Date.now()}.log`);

mkdirSync(dirname(DEST), { recursive: true });

// ⛔ THE LOG MUST NAME THE COMMIT IT IS A VERDICT FOR.
//
// The copy lands only when vitest exits, so for the ~11 minutes a run takes, latest.log still holds
// the PREVIOUS run's complete log — VITEST_EXIT=0 and all. Grepping it mid-run returns last time's
// pass, and a wait-loop watching for VITEST_EXIT exits instantly on a file that already has one. I
// read 445/3686 as this run's result for a tree that already contained a new 4-test file; only the
// counts failing to move exposed it. A stale PASS and a fresh PASS look identical.
//
// ⚠ The obvious fix — blank the destination at start — is WRONG HERE, and I wrote it before catching
// it: latest.log is TRACKED, so writing to it mid-run makes the tree tracked-dirty and turns
// packet-snapshot-line red. That is the very defect this script exists to prevent.
//
// So the file is still written only at the end, and it NAMES ITS COMMIT. A reader checks that header
// against HEAD: a log for another commit is visibly stale rather than silently authoritative.
const headAtStart = (() => {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
})();

// ⛔ REFUSE TO RUN ON A TRACKED-DIRTY TREE.
//
// This script copies the finished log to a TRACKED path, so every completed run leaves the tree
// dirty until that log is committed. Start the next run before committing and the suite measures a
// dirty repo — `packet-snapshot-line.test.js` compares `git diff` against the packet's `dirty=` field
// on the REAL repo and goes red. Observed 2026-09-02: run 1 left latest.log modified, run 2 failed
// on exactly that, for a reason that had nothing to do with the code under test.
//
// The earlier fix stopped the log being written DURING a run. This closes the other half — the log
// left over AFTER one. A self-inflicted red is worse than a missing check: it burns eleven minutes
// and looks like a real defect.
const trackedDirty = (() => {
  try {
    const unstaged = execFileSync('git', ['-C', REPO, 'diff', '--name-only'], { encoding: 'utf8' });
    const staged = execFileSync('git', ['-C', REPO, 'diff', '--cached', '--name-only'], { encoding: 'utf8' });
    return `${unstaged}${staged}`.split('\n').filter(Boolean);
  } catch { return []; }
})();
if (trackedDirty.length > 0) {
  console.error('REFUSED: the tree has tracked changes, so the suite would measure a dirty repo.');
  for (const f of trackedDirty) console.error(`  M ${f}`);
  console.error('\nCommit them first (the previous run\'s log is the usual culprit), then re-run.');
  process.exit(2);
}

// Strip ANSI: no raw escape codes may reach a tracked file, and a stripped log stays greppable.
const ANSI = /\x1b\[[0-9;]*m/g;
const out = createWriteStream(SCRATCH);
const write = (chunk) => out.write(String(chunk).replace(ANSI, ''));

const child = spawn('npx', ['vitest', 'run', '--reporter=dot'], {
  cwd: REPO, shell: process.platform === 'win32',
});
child.stdout.on('data', write);
child.stderr.on('data', write);

child.on('close', (code) => {
  out.end();
  out.on('finish', () => {
    appendFileSync(SCRATCH, `\nSUITE FOR COMMIT ${headAtStart}\nFINISHED ${new Date().toISOString()}\nVITEST_EXIT=${code}\n`);
    copyFileSync(SCRATCH, DEST);
    console.log(`suite exit ${code} — log copied to docs/evidence/suite/latest.log`);
    console.log(`verdict is for commit ${headAtStart}`);
    console.log(code === 0
      ? 'GREEN. Commit the log with the work it vouches for, then push.'
      : 'RED. Do not push. Read VITEST_EXIT in the log, not any harness summary.');
    process.exit(code);
  });
});
