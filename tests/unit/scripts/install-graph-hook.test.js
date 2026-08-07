import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGraphHook, AIFY_HOOK_MARKER, AIFY_HOOKS } from '../../../scripts/install-graph-hook.mjs';

describe('installGraphHook', () => {
  let repo;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'apg-hook-')); mkdirSync(join(repo, '.git', 'hooks'), { recursive: true }); });
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

  it('hook bodies are pure LF — sh rejects CRLF', () => {
    installGraphHook(repo);
    for (const hook of AIFY_HOOKS) {
      expect(readFileSync(join(repo, '.git', 'hooks', hook), 'utf8')).not.toContain('\r');
    }
  });
});
