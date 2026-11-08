// The push gate refuses an UNTRACKED file in the tree, not only a tracked change.
//
// 2026-11-08: a gate run for three committed fixes went RED (1 of 4397) because an uncommitted test file for the next
// issue sat in the tree. run-suite checked `git diff` (tracked) only; vitest collects every tests/**/*.test.js on
// disk; the suite-composition guard failed on the stray file. The verdict described no commit and cost a ~12-minute run.
//
// Run as the real script in a scratch clone, never in this checkout, where an untracked file would disturb the suite
// that is running this test. The clone has no node_modules and npx runs offline, so a refusal that regresses ends in a
// fast vitest-not-found failure, never a download or a full suite.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTreeChanges } from '../../../scripts/lib/tree-changes.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let clone;
beforeAll(() => {
  clone = join(mkdtempSync(join(tmpdir(), 'apg-gate-')), 'repo');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${REPO.replaceAll('\\', '/')}`, clone]);
  // The clone holds HEAD; the code under test is this checkout's. Commit the working copy of the gate into the clone so
  // the test (and the pre-commit hook, which runs before HEAD moves) measures the script being changed.
  cpSync(join(REPO, 'scripts', 'run-suite.mjs'), join(clone, 'scripts', 'run-suite.mjs'));
  cpSync(join(REPO, 'scripts', 'lib'), join(clone, 'scripts', 'lib'), { recursive: true });
  execFileSync('git', ['-C', clone, '-c', 'core.safecrlf=false', 'add', '-A', 'scripts'], { stdio: 'ignore' });
  execFileSync('git', ['-C', clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'working copy']);
}, 120_000);
// A regressed gate runs vitest in the clone and leaves a log there; every test starts from the committed clone.
beforeEach(() => {
  execFileSync('git', ['-C', clone, 'reset', '-q', '--hard']);
  execFileSync('git', ['-C', clone, 'clean', '-q', '-fd']);
});
afterAll(() => { try { rmSync(join(clone, '..'), { recursive: true, force: true }); } catch { /* win lock */ } });

const gate = () => spawnSync(process.execPath, [join(clone, 'scripts', 'run-suite.mjs')], {
  cwd: clone, encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_config_offline: 'true' },
});

describe('run-suite refuses an untracked file', () => {
  it('★★★ an untracked test file is refused before vitest starts, and named', () => {
    const stray = join(clone, 'tests', 'unit', 'stray.test.js');
    writeFileSync(stray, 'it("x", () => {});\n');
    try {
      const run = gate();
      expect(run.status, run.stderr).toBe(2);
      expect(run.stderr).toMatch(/untracked/iu);
      expect(run.stderr).toContain('tests/unit/stray.test.js');
    } finally { rmSync(stray); }
  }, 90_000);
});

describe('readTreeChanges', () => {
  it('★★★ a clean clone has nothing (control); an untracked file is listed; a .gitignore\'d one is not', () => {
    expect(readTreeChanges(clone)).toEqual({ tracked: [], untracked: [] });
    writeFileSync(join(clone, 'stray.txt'), 'x\n');
    mkdirSync(join(clone, '.aify-graph'), { recursive: true });
    writeFileSync(join(clone, '.aify-graph', 'graph.sqlite'), 'x\n');
    try {
      expect(readTreeChanges(clone)).toEqual({ tracked: [], untracked: ['stray.txt'] });
    } finally { rmSync(join(clone, 'stray.txt')); rmSync(join(clone, '.aify-graph'), { recursive: true }); }
  });

  it('★★ a tracked change is still listed (the existing refusal is kept)', () => {
    writeFileSync(join(clone, 'README.md'), 'changed\n');
    try {
      expect(readTreeChanges(clone).tracked).toEqual(['README.md']);
    } finally { execFileSync('git', ['-C', clone, 'checkout', '--', 'README.md']); }
  });
});
