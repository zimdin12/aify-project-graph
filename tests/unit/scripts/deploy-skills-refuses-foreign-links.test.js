// #21: deploy-skills never writes through a link that leads outside the install root.
//
// Seen on this host: ~/.claude/skills/blast-radius is a junction into another product's skill source, and apg ships a
// skill of the same name. deploy-skills wrote join(root, name, 'SKILL.md') for every row not in sync, so a deploy
// (with --force for a diverged copy, without it for a stale one) overwrote that other source through the junction.
//
// Run as the real script, in a child process whose home is a scratch directory: the real install roots are never the
// test. CODEX_HOME and HERMES_HOME are removed so no other runtime root resolves outside the scratch home.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { foreignTarget } from '../../../scripts/lib/skill-deployment.mjs';

const SCRIPT = new URL('../../../scripts/deploy-skills.mjs', import.meta.url);
const LINK = process.platform === 'win32' ? 'junction' : 'dir';
const OUTSIDE_BYTES = '---\nname: blast-radius\n---\nANOTHER PRODUCT OWNS THIS FILE\n';
let base; let home; let root; let outsideDir;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apg-deploy-'));
  home = join(base, 'home');
  root = join(home, '.claude', 'skills');
  mkdirSync(root, { recursive: true });
  outsideDir = join(base, 'other-product', 'blast-radius');
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, 'SKILL.md'), OUTSIDE_BYTES);
  symlinkSync(outsideDir, join(root, 'blast-radius'), LINK);
});
afterEach(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* win lock */ } });

function deploy(...flags) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CODEX_HOME; delete env.HERMES_HOME;
  // ⛔ FAIL CLOSED BEFORE ANY WRITE: the child must see the scratch home, or a deploy would reach the real install roots.
  const seen = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], { env, encoding: 'utf8' }).stdout;
  if (seen !== home) throw new Error(`refusing to run deploy-skills: the child's home is ${seen}, not the scratch ${home}`);
  const run = spawnSync(process.execPath, [SCRIPT.pathname.replace(/^\/(\w:)/u, '$1'), ...flags], { env, encoding: 'utf8' });
  const report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
  const rows = report.runtimes.find((r) => r.runtime === 'claude-code').roots[0];
  return { status: run.status, rows };
}
const outsideNow = () => readFileSync(join(outsideDir, 'SKILL.md'), 'utf8');
const age = (seconds) => { const t = Date.now() / 1000 + seconds; utimesSync(join(outsideDir, 'SKILL.md'), t, t); };

describe('foreignTarget', () => {
  it('★★★ names the outside target of a junction; an ordinary folder and an absent name are inside (controls)', () => {
    mkdirSync(join(root, 'ordinary'));
    expect(foreignTarget(root, 'blast-radius')).toBeTruthy();
    expect(foreignTarget(root, 'ordinary')).toBeNull();
    expect(foreignTarget(root, 'not-there')).toBeNull();
  });
});

describe('deploy-skills and a skill name that is a link out of the root', () => {
  it('★★★ a STALE copy behind the junction is reported foreign and not written; a normal skill deploys (control)', () => {
    age(-10 * 365 * 86400);
    const { rows } = deploy();
    expect(outsideNow()).toBe(OUTSIDE_BYTES);
    expect(rows.failures.find((f) => f.name === 'blast-radius')?.state).toBe('foreign');
    expect(existsSync(join(root, 'graph-guide', 'SKILL.md')), 'control: an ordinary skill directory is deployed').toBe(true);
  });

  it('★★★ a DIVERGED copy is not written even with --force', () => {
    age(10 * 365 * 86400);
    const { rows } = deploy('--force');
    expect(outsideNow()).toBe(OUTSIDE_BYTES);
    expect(rows.failures.find((f) => f.name === 'blast-radius')?.state).toBe('foreign');
  });

  it('★★★ a DANGLING junction is foreign too, and nothing is created at its target', () => {
    const gone = join(base, 'other-product', 'safe-to-delete');
    mkdirSync(gone);
    symlinkSync(gone, join(root, 'safe-to-delete'), LINK);
    rmSync(gone, { recursive: true });
    const { rows } = deploy('--force');
    expect(existsSync(gone), 'the dangling target must not be recreated').toBe(false);
    expect(rows.failures.find((f) => f.name === 'safe-to-delete')?.state).toBe('foreign');
  });

  // Seen on this host 2026-11-08: blast-radius is agents-setup's junction in ~/.claude/skills and absent from
  // ~/.codex/skills, so a plain deploy would have CREATED apg's same-named skill there, beside agents-setup's copy in
  // ~/.agents/skills. A name another owner holds in any root is not apg's to create in another.
  it('★★★ a name that is foreign in one root is not created in another; an ordinary skill still is (control)', () => {
    const codex = join(home, '.codex', 'skills');
    mkdirSync(codex, { recursive: true });
    const { status, report } = deployReport();
    expect(existsSync(join(codex, 'blast-radius')), 'apg must not create a name another owner holds').toBe(false);
    expect(existsSync(join(codex, 'graph-guide', 'SKILL.md')), 'control: an ordinary skill is deployed there').toBe(true);
    const codexRoot = report.runtimes.find((r) => r.runtime === 'codex').roots[0];
    expect(codexRoot.refusals).toEqual([{ name: 'blast-radius', reason: 'owned_elsewhere' }]);
    expect(codexRoot.written).toContain('graph-guide');
    expect(status, 'a refused name leaves the root out of sync, so the run says so').toBe(1);
  });
});

function deployReport(...flags) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CODEX_HOME; delete env.HERMES_HOME;
  const seen = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], { env, encoding: 'utf8' }).stdout;
  if (seen !== home) throw new Error(`refusing to run deploy-skills: the child's home is ${seen}, not the scratch ${home}`);
  const run = spawnSync(process.execPath, [SCRIPT.pathname.replace(/^\/(\w:)/u, '$1'), ...flags], { env, encoding: 'utf8' });
  return { status: run.status, report: JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) };
}
