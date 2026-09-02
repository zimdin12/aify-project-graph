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
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = join(REPO, 'docs/evidence/suite/latest.log');
const SCRATCH = join(tmpdir(), `apg-suite-${process.pid}-${Date.now()}.log`);

mkdirSync(dirname(DEST), { recursive: true });

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
    appendFileSync(SCRATCH, `\nVITEST_EXIT=${code}\n`);
    copyFileSync(SCRATCH, DEST);
    console.log(`suite exit ${code} — log copied to docs/evidence/suite/latest.log`);
    console.log(code === 0
      ? 'GREEN. Commit the log with the work it vouches for, then push.'
      : 'RED. Do not push. Read VITEST_EXIT in the log, not any harness summary.');
    process.exit(code);
  });
});
