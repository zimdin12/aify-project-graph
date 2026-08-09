// The unit tests assert the hook FILES contain the right text. This asserts git
// actually RUNS them and the breadcrumb actually lands.
//
// The gap between "the installer wrote a file" and "the mechanism works" is
// exactly where this whole class of bug lives. Measured 2026-08-07: the
// README-documented installer wrote a perfectly good hook file whose body began
// `[ -f "$REPO_ROOT/scripts/graph-reindex-hook.mjs" ] || exit 0` — a file that
// exists only in APG's own tree. Every file-content assertion would have passed.
// The hook did nothing, silently, in every user repo, forever.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGraphHook } from '../../scripts/install-graph-hook.mjs';
import { readRefreshBreadcrumb } from '../../mcp/stdio/freshness/refresh-breadcrumb.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });

/** The hooks are backgrounded, so the commit returns before the reindex finishes. */
async function waitForBreadcrumb(repo, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = readRefreshBreadcrumb(repo);
    if (c) return c;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

describe('refresh hooks end-to-end', () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-e2e-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    // core.hooksPath can be set globally on a dev machine and would silently
    // redirect git away from .git/hooks, making this test vacuous.
    git(repo, 'config', 'core.hooksPath', '.git/hooks');
    writeFileSync(join(repo, 'a.js'), 'export function a() { return 1; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
  });

  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* windows lock */ } });

  it('★ a real commit triggers a real reindex and records the breadcrumb', async () => {
    installGraphHook(repo);
    writeFileSync(join(repo, 'b.js'), 'export function b() { return 2; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'second');

    const crumb = await waitForBreadcrumb(repo);
    expect(crumb, 'breadcrumb written by the backgrounded hook').toBeTruthy();
    expect(crumb.status).toBe('ok');
    expect(crumb.trigger).toBe('post-commit');
    expect(crumb.to).toBeTruthy();
  }, 120000);

  it('★ WITHOUT the hooks installed, nothing happens — proving the assertion is bound to the mechanism', async () => {
    // The control. Without this, the test above would pass just as happily if
    // something else in the toolchain happened to write a breadcrumb.
    writeFileSync(join(repo, 'c.js'), 'export function c() { return 3; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'no-hooks');

    const crumb = await waitForBreadcrumb(repo, 8000);
    expect(crumb, 'no hooks installed → no breadcrumb').toBeNull();
  }, 30000);

  it('a reindex failure never fails the git operation', async () => {
    installGraphHook(repo);
    writeFileSync(join(repo, 'd.js'), 'export function d() { return 4; }\n');
    git(repo, 'add', '-A');
    // Backgrounded + reindex.mjs exits 0 on error, so the commit must succeed
    // regardless of what the refresh does.
    expect(() => git(repo, 'commit', '-q', '-m', 'third')).not.toThrow();
  }, 120000);
});
