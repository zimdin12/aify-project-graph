import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installGraphHook, hooksLocation, HookInstallRefused, AIFY_HOOK_MARKER, AIFY_HOOKS } from '../../../scripts/install-graph-hook.mjs';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });

describe('installGraphHook', () => {
  let repo;
  // A real repository: the installer asks git where its hooks live, and a directory named .git is not one. The local
  // hooksPath pins git to the repository's own hooks, so a global core.hooksPath on a dev machine cannot move them.
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-hook-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'core.hooksPath', '.git/hooks');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('writes a post-commit hook containing the aify block', () => {
    installGraphHook(repo);
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    expect(existsSync(hookPath)).toBe(true);
    const body = readFileSync(hookPath, 'utf8');
    expect(body).toContain(AIFY_HOOK_MARKER);
    expect(body).toContain('reindex.mjs');
  });

  it('is idempotent: re-running replaces the aify block, does not duplicate it', () => {
    installGraphHook(repo); installGraphHook(repo);
    const body = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8');
    // marker appears exactly twice (BEGIN + END), proving a single block
    expect(body.split(AIFY_HOOK_MARKER).length - 1).toBe(2);
  });

  it('preserves a pre-existing unrelated hook body', () => {
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho custom-thing\n');
    installGraphHook(repo);
    const body = readFileSync(hookPath, 'utf8');
    expect(body).toContain('echo custom-thing');
    expect(body).toContain(AIFY_HOOK_MARKER);
  });

  it('installs all four HEAD-moving hooks', () => {
    const paths = installGraphHook(repo);
    expect(AIFY_HOOKS).toEqual(['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']);
    expect(paths).toHaveLength(4);
    for (const hook of AIFY_HOOKS) {
      const p = join(repo, '.git', 'hooks', hook);
      expect(existsSync(p), `${hook} exists`).toBe(true);
      expect(readFileSync(p, 'utf8')).toContain(AIFY_HOOK_MARKER);
    }
  });

  it('post-checkout only reindexes on BRANCH checkout, not file checkout', () => {
    // git passes $3 = 1 for a branch checkout, 0 for a file checkout. Without
    // this guard, `git checkout -- somefile` triggers a full reindex.
    installGraphHook(repo);
    const body = readFileSync(join(repo, '.git', 'hooks', 'post-checkout'), 'utf8');
    expect(body).toContain('[ "$3" = "1" ]');
  });

  it('the other three hooks do NOT carry the branch-checkout guard', () => {
    installGraphHook(repo);
    for (const hook of ['post-commit', 'post-merge', 'post-rewrite']) {
      const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
      expect(body, `${hook} unguarded`).not.toContain('[ "$3" = "1" ]');
    }
  });

  it('is idempotent across all four hooks', () => {
    installGraphHook(repo); installGraphHook(repo);
    for (const hook of AIFY_HOOKS) {
      const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
      expect(body.split(AIFY_HOOK_MARKER).length - 1, `${hook} single block`).toBe(2);
    }
  });

  it('preserves pre-existing unrelated content in every hook', () => {
    for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']) {
      writeFileSync(join(repo, '.git', 'hooks', hook), `#!/bin/sh\necho keep-${hook}\n`);
    }
    installGraphHook(repo);
    for (const hook of AIFY_HOOKS) {
      const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
      expect(body).toContain(`echo keep-${hook}`);
      expect(body).toContain(AIFY_HOOK_MARKER);
    }
  });

  it('★★★ a configured hooks directory is REFUSED, and nothing is written anywhere', () => {
    // dashboard-manager, 2026-10-17: aify-dashboard sets core.hooksPath=.githooks, and the install reported success
    // into .git/hooks, which git never reads there.
    git(repo, 'config', 'core.hooksPath', '.githooks');
    // CONTROL: git itself says the hooks moved, so the refusal below is answering the real configuration.
    expect(hooksLocation(repo)).toEqual({ dir: join(repo, '.githooks'), configured: true });
    expect(() => installGraphHook(repo)).toThrow(HookInstallRefused);
    expect(() => installGraphHook(repo)).toThrow(/\.githooks.*core\.hooksPath/su);
    for (const dir of ['.git/hooks', '.githooks']) {
      for (const hook of AIFY_HOOKS) {
        const p = join(repo, dir, hook);
        expect(existsSync(p) && readFileSync(p, 'utf8').includes(AIFY_HOOK_MARKER), `${dir}/${hook}`).toBe(false);
      }
    }
  });

  it('★★★ asked to, it writes into the configured directory, which is where git reads them', () => {
    git(repo, 'config', 'core.hooksPath', '.githooks');
    const paths = installGraphHook(repo, undefined, { intoHooksPath: true });
    expect(paths).toEqual(AIFY_HOOKS.map((h) => join(repo, '.githooks', h)));
    for (const p of paths) expect(readFileSync(p, 'utf8')).toContain(AIFY_HOOK_MARKER);
  });

  it('★★★ the repository\'s own hooks directory is not "configured", whether or not hooksPath names it', () => {
    expect(hooksLocation(repo)).toEqual({ dir: join(repo, '.git', 'hooks'), configured: false });
    git(repo, 'config', '--unset', 'core.hooksPath');
    expect(hooksLocation(repo)).toEqual({ dir: join(repo, '.git', 'hooks'), configured: false });
  });

  it('★★★ a directory git cannot read as a repository is refused, not given a .git/hooks', () => {
    const bare = mkdtempSync(join(tmpdir(), 'apg-hook-nogit-'));
    try {
      expect(hooksLocation(bare)).toBeNull();
      expect(() => installGraphHook(bare)).toThrow(/not a git repository/u);
      expect(existsSync(join(bare, '.git'))).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('hook bodies are pure LF — sh rejects CRLF', () => {
    installGraphHook(repo);
    for (const hook of AIFY_HOOKS) {
      expect(readFileSync(join(repo, '.git', 'hooks', hook), 'utf8')).not.toContain('\r');
    }
  });
});
