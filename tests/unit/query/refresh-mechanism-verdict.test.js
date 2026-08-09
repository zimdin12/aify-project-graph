// An un-hooked repo is UNCONFIGURED, not degraded. Fail-closed applies to a
// mechanism that is supposed to be running, because silence from it cannot be
// told apart from success. A mechanism never enabled is a known state — and
// marking every un-hooked repo degraded would make the signal worthless in the
// repos that later install hooks and need it to mean something.
//
// The case this exists for, measured 2026-08-07: sand_castle 20 commits stale,
// aify-project-graph 130. Neither was an indexing bug. The hooks were never
// installed, and nothing reported that the mechanism was absent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshMechanismVerdict } from '../../../mcp/stdio/freshness/refresh-verdict.js';
import { installGraphHook } from '../../../scripts/install-graph-hook.mjs';
import { writeRefreshBreadcrumb } from '../../../mcp/stdio/freshness/refresh-breadcrumb.js';

describe('refresh mechanism verdict', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-refresh-'));
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* windows lock */ } });

  it('no hooks installed → unconfigured, with the install command', () => {
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('unconfigured');
    expect(v.hooks_installed).toBe(0);
    expect(v.remedy).toContain('install-graph-hook');
  });

  it('hooks installed + last refresh ok → ok', () => {
    installGraphHook(repo);
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'ok' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('ok');
    expect(v.hooks_installed).toBe(4);
    expect(v.remedy).toBeNull();
  });

  it('★ hooks installed + last refresh FAILED → degraded, naming the error', () => {
    installGraphHook(repo);
    writeRefreshBreadcrumb(repo, { trigger: 'post-merge', from: 'a', to: 'b', status: 'failed', error: 'ENOSPC: no space left' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.consequence).toMatch(/ENOSPC/);
    expect(v.remedy).toBeTruthy();
  });

  it('★ hooks installed + NO breadcrumb → degraded (fail-closed)', () => {
    // The silently-dead-hook case: installed, never observed to run. Unknown is
    // not healthy — a hook that fails to execute looks exactly like one that has
    // simply not been needed yet.
    installGraphHook(repo);
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.consequence).toMatch(/never observed|no refresh has been recorded/i);
  });

  it('partial install (some hooks missing) → degraded', () => {
    installGraphHook(repo);
    rmSync(join(repo, '.git', 'hooks', 'post-merge'));
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'ok' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.hooks_installed).toBe(3);
    expect(v.hooks_expected).toBe(4);
  });

  it('not a git repo → not_a_git_repo, not degraded', () => {
    const bare = mkdtempSync(join(tmpdir(), 'apg-nogit-'));
    mkdirSync(join(bare, '.aify-graph'), { recursive: true });
    expect(refreshMechanismVerdict(bare).state).toBe('not_a_git_repo');
    try { rmSync(bare, { recursive: true, force: true }); } catch { /* windows lock */ }
  });

  it('a foreign post-commit hook does not count as installed', () => {
    // Someone else's hook in the right place is not our mechanism. This repo
    // shipped two competing installers with different markers; counting by path
    // rather than by marker would have reported the wrong one as ours.
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho unrelated\n');
    expect(refreshMechanismVerdict(repo).hooks_installed).toBe(0);
  });

  it('★ collapses newlines in the error — a verdict is one line', () => {
    // Flagged by Task 2's implementer: reindex failures carry raw git stderr, e.g.
    // "Command failed: git rev-parse HEAD\nfatal: not a git repository". Interpolated
    // straight into a verdict string that gets joined into graph_health's one-line
    // summary, that breaks the summary into fragments mid-sentence.
    installGraphHook(repo);
    writeRefreshBreadcrumb(repo, {
      trigger: 'post-commit', from: 'a', to: 'b', status: 'failed',
      error: 'Command failed: git rev-parse HEAD\nfatal: not a git repository\n',
    });
    const v = refreshMechanismVerdict(repo);
    expect(v.consequence).not.toMatch(/\n/);
    expect(v.consequence).toMatch(/fatal: not a git repository/);
  });
});
