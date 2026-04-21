// Installer for the post-commit hook: idempotent install, safe refusal
// when a foreign hook is present, clean uninstall.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const INSTALLER = join(process.cwd(), 'scripts', 'install-hooks.mjs');

function runInstaller(repoRoot, extraArgs = []) {
  return spawnSync('node', [INSTALLER, repoRoot, ...extraArgs], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
}

describe('install-hooks.mjs', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-hooks-'));
    const run = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    run('init', '-q');
    run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
  });

  afterEach(async () => {
    for (let i = 0; i < 10; i++) {
      try { await rm(repoRoot, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('installs a post-commit hook marked with our identifier', () => {
    const r = runInstaller(repoRoot);
    expect(r.status).toBe(0);
    const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
    expect(existsSync(hookPath)).toBe(true);
  });

  it('is idempotent — re-install overwrites our own hook without --force', () => {
    expect(runInstaller(repoRoot).status).toBe(0);
    const second = runInstaller(repoRoot);
    expect(second.status).toBe(0);
  });

  it('refuses to overwrite a foreign hook without --force', async () => {
    const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
    await writeFile(hookPath, '#!/bin/sh\necho unrelated\n', 'utf8');
    const r = runInstaller(repoRoot);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unrelated.*hook|already exists/i);
    // Original content preserved
    const body = await readFile(hookPath, 'utf8');
    expect(body).toContain('unrelated');
  });

  it('overwrites foreign hook with --force', async () => {
    const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
    await writeFile(hookPath, '#!/bin/sh\necho unrelated\n', 'utf8');
    const r = runInstaller(repoRoot, ['--force']);
    expect(r.status).toBe(0);
    const body = await readFile(hookPath, 'utf8');
    expect(body).toContain('aify-project-graph post-commit hook');
  });

  it('--remove uninstalls our own hook', () => {
    expect(runInstaller(repoRoot).status).toBe(0);
    const r = runInstaller(repoRoot, ['--remove']);
    expect(r.status).toBe(0);
    expect(existsSync(join(repoRoot, '.git', 'hooks', 'post-commit'))).toBe(false);
  });

  it('--remove refuses to delete a foreign hook without --force', async () => {
    const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
    await writeFile(hookPath, '#!/bin/sh\necho unrelated\n', 'utf8');
    const r = runInstaller(repoRoot, ['--remove']);
    expect(r.status).not.toBe(0);
    expect(existsSync(hookPath)).toBe(true);
  });
});
