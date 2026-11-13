// run-suite keeps the finished log in the repo, removes its scratch log, and removes reporter JSON only on green.
// A failed run's JSON is the evidence that identifies missing files (#10); losing it left three RPC-timeout runs
// with only totals. Drive the real runner in a scratch clone, using a local vitest executable that writes a known
// JSON report and returns the selected exit code. No live install root or real suite is changed by these controls.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let base; let clone; let temp;
const REPORT = JSON.stringify({ testResults: [{ name: 'known-fixture.test.js', assertionResults: [{ title: 'known fixture', status: 'passed' }] }] });
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apg-scratch-'));
  clone = join(base, 'repo');
  temp = join(base, 'temp');
  mkdirSync(temp);
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${REPO.replaceAll('\\', '/')}`, clone]);
  cpSync(join(REPO, 'scripts', 'run-suite.mjs'), join(clone, 'scripts', 'run-suite.mjs'));
  cpSync(join(REPO, 'scripts', 'lib'), join(clone, 'scripts', 'lib'), { recursive: true });
  execFileSync('git', ['-C', clone, '-c', 'core.safecrlf=false', 'add', '-A', 'scripts'], { stdio: 'ignore' });
  execFileSync('git', ['-C', clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'working copy']);
  // npx uses the scratch checkout's local executable; it never downloads or starts the real suite.
  const bin = join(clone, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'vitest-fixture.mjs'), `import { writeFileSync } from 'node:fs';
const path = process.argv.find((a) => a.startsWith('--outputFile.json=')).split('=').slice(1).join('=');
writeFileSync(path, ${JSON.stringify(REPORT)});
if (process.env.APG_FIXTURE_DIRTY === '1') writeFileSync('untracked-product-file.txt', 'unexpected run-time write');
process.exit(Number(process.env.APG_FIXTURE_EXIT));
`);
  writeFileSync(join(bin, 'vitest.cmd'), '@node "%~dp0vitest-fixture.mjs" %*\r\n');
  writeFileSync(join(bin, 'vitest'), '#!/bin/sh\nexec node "$(dirname "$0")/vitest-fixture.mjs" "$@"\n', { mode: 0o755 });
}, 120_000);
afterEach(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* win lock */ } });

function runWith(exit, dirty = false) {
  const env = { ...process.env, APG_FIXTURE_EXIT: String(exit), APG_FIXTURE_DIRTY: dirty ? '1' : '0', npm_config_offline: 'true', TEMP: temp, TMP: temp, TMPDIR: temp };
  return spawnSync(process.execPath, [join(clone, 'scripts', 'run-suite.mjs')], { cwd: clone, encoding: 'utf8', env, timeout: 90_000 });
}
const scratch = () => readdirSync(temp).filter((f) => f.startsWith('apg-suite-'));
const evidenceDir = () => join(clone, 'docs', 'evidence', 'suite');
const jsonEvidence = () => readdirSync(evidenceDir()).filter((f) => /^apg-suite-.*\.json$/u.test(f));

describe('run-suite scratch cleanup and failed-run evidence', () => {
  it('★★★ green: preserves the finished log and removes both scratch files', () => {
    const run = runWith(0);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(evidenceDir(), 'latest.log'), 'utf8')).toContain('VITEST_EXIT=0');
    expect(scratch()).toEqual([]);
    expect(jsonEvidence()).toEqual([]);
  }, 120_000);

  it('★★★ red: preserves the reporter JSON byte-for-byte beside the finished log and prints its path', () => {
    const run = runWith(1);
    expect(run.status, run.stderr).toBe(1); // not an integrity refusal or a successful test run
    expect(readFileSync(join(evidenceDir(), 'latest.log'), 'utf8')).toContain('VITEST_EXIT=1');
    const reports = jsonEvidence();
    expect(reports).toHaveLength(1);
    expect(readFileSync(join(evidenceDir(), reports[0]), 'utf8')).toBe(REPORT);
    expect(run.stdout).toContain(`docs/evidence/suite/${reports[0]}`);
    expect(scratch(), 'the failure report is retained in the repo, not leaked in temp').toEqual([]);
  }, 120_000);

  it('★★★ a void run retains JSON even when vitest exits zero', () => {
    const run = runWith(0, true);
    expect(run.status, run.stderr).toBe(3);
    expect(run.stderr).toContain('VOID');
    const reports = jsonEvidence();
    expect(reports).toHaveLength(1);
    expect(readFileSync(join(evidenceDir(), reports[0]), 'utf8')).toBe(REPORT);
    expect(scratch()).toEqual([]);
  }, 120_000);
});
