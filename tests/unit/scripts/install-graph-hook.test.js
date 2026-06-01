import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGraphHook, AIFY_HOOK_MARKER } from '../../../scripts/install-graph-hook.mjs';

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
});
