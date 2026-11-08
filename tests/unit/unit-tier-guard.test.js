// The unit tier's language-server guard (#10): it refuses, it RECORDS even when the refusal is swallowed, it reaches a
// child process, and it leaves the wrapped functions' shapes intact.
//
// Each arm points the record at a scratch file, so the refusals made here never reach the run's own record (which
// fails the run at teardown). Runs in the unit tier, where tests/helpers/unit-tier.setup.js installed the guard.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

let dir; let realRecord;
const recorded = () => (existsSync(join(dir, 'record')) ? readFileSync(join(dir, 'record'), 'utf8') : '');
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-guard-'));
  realRecord = process.env.APG_LANGUAGE_SERVER_REFUSALS;
  process.env.APG_LANGUAGE_SERVER_REFUSALS = join(dir, 'record');
});
afterEach(() => {
  process.env.APG_LANGUAGE_SERVER_REFUSALS = realRecord;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* win lock */ }
});

describe('the unit-tier language-server guard', () => {
  it('★★★ a refusal that the caller swallows is still recorded, with this file named', () => {
    try { spawnSync('clangd-apg-guard-probe', ['--version']); } catch { /* product code does this */ }
    expect(recorded()).toContain('unit-tier-guard.test.js');
    expect(recorded()).toContain('clangd-apg-guard-probe --version');
  });

  it('★★★ a node child the test starts carries the guard, and its refusal is recorded too', () => {
    const script = join(dir, 'child.cjs');
    writeFileSync(script, 'try { require("child_process").spawnSync("pyright" + "-langserver", ["--stdio"]); }'
      + ' catch { process.exit(7); }');
    expect(spawnSync(process.execPath, [script]).status, 'the child refused').toBe(7);
    expect(recorded()).toContain('pyright-langserver --stdio');
  });

  it('★★ control: an ordinary child runs and nothing is recorded', () => {
    expect(spawnSync(process.execPath, ['-e', 'process.exit(3)']).status).toBe(3);
    expect(recorded()).toBe('');
  });

  it('★★★ promisify(execFile) still resolves {stdout, stderr}, and its promisified form is guarded', async () => {
    const out = await promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("o"); process.stderr.write("e")']);
    expect(out).toEqual({ stdout: 'o', stderr: 'e' });
    await expect(promisify(execFile)('clangd-apg-guard-probe', [])).rejects.toThrow(/language server/u);
    expect(recorded()).toContain('clangd-apg-guard-probe');
  });
});
