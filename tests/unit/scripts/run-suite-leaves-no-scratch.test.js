// run-suite writes its live log and the json reporter's output to scratch files in the temp directory, copies the
// finished log into the repo, and used to leave both scratch files behind: two per gate run (found 2026-11-08, 26
// files from one day's runs). The repo copy is the record; the scratch files are not.
//
// Run as the real script in a scratch clone with its own temp directory. The clone has no node_modules and npx runs
// offline, so vitest fails at once, and the script's finish path (append, copy, integrity check) still runs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let base; let clone; let temp;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'apg-scratch-'));
  clone = join(base, 'repo');
  temp = join(base, 'temp');
  mkdirSync(temp);
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${REPO.replaceAll('\\', '/')}`, clone]);
  // The clone holds HEAD; the code under test is this checkout's gate.
  cpSync(join(REPO, 'scripts', 'run-suite.mjs'), join(clone, 'scripts', 'run-suite.mjs'));
  cpSync(join(REPO, 'scripts', 'lib'), join(clone, 'scripts', 'lib'), { recursive: true });
  execFileSync('git', ['-C', clone, '-c', 'core.safecrlf=false', 'add', '-A', 'scripts'], { stdio: 'ignore' });
  execFileSync('git', ['-C', clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'working copy']);
}, 120_000);
afterAll(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* win lock */ } });

describe('run-suite leaves no scratch files behind', () => {
  it('★★★ a finished run leaves its log in the repo and nothing named apg-suite-* in the temp directory', () => {
    const env = { ...process.env, npm_config_offline: 'true', TEMP: temp, TMP: temp, TMPDIR: temp };
    const run = spawnSync(process.execPath, [join(clone, 'scripts', 'run-suite.mjs')], { cwd: clone, encoding: 'utf8', env, timeout: 90_000 });
    expectAbsentWithLiveMatcher(/REFUSED/u,
      { forbidden: 'REFUSED: the tree has tracked changes or untracked files', allowed: 'suite exit 1' },
      run.stderr, 'control: the gate did not refuse at entry');
    expect(existsSync(join(clone, 'docs', 'evidence', 'suite', 'latest.log')), 'control: the finish path ran').toBe(true);
    expect(readdirSync(temp).filter((f) => f.startsWith('apg-suite-'))).toEqual([]);
  }, 120_000);
});
