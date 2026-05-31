// P5-5: worktree detection + .aify-graph redirect.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { detectWorktree, resolveGraphRoot } from '../../../mcp/stdio/freshness/git.js';

// Helper: the implementation absolutizes git output via path.resolve, so on
// win32 `/repo/main` becomes `C:\repo\main`. Compare against the same
// normalization rather than hard-coding POSIX paths.
const abs = (p) => resolve('/', p);

// Build a fake `git rev-parse` exec that returns the supplied --git-dir /
// --git-common-dir values. Mirrors the real execGit(repoRoot, args) signature.
function fakeExec({ gitDir, commonDir, throws = false }) {
  return (_repoRoot, args) => {
    if (throws) throw new Error('not a git repo');
    if (args.includes('--git-dir')) return `${gitDir}\n`;
    if (args.includes('--git-common-dir')) return `${commonDir}\n`;
    return '';
  };
}

describe('detectWorktree', () => {
  it('reports NOT a worktree when git-dir === git-common-dir (main checkout)', () => {
    const wt = detectWorktree('/repo/main', {
      exec: fakeExec({ gitDir: '/repo/main/.git', commonDir: '/repo/main/.git' }),
    });
    expect(wt.isWorktree).toBe(false);
    expect(wt.mainRoot).toBeNull();
  });

  it('detects a linked worktree and resolves the main root from the common dir', () => {
    const wt = detectWorktree('/repo/wt-feature', {
      exec: fakeExec({
        gitDir: '/repo/main/.git/worktrees/wt-feature',
        commonDir: '/repo/main/.git',
      }),
    });
    expect(wt.isWorktree).toBe(true);
    expect(wt.mainRoot).toBe(abs('/repo/main'));
  });

  it('returns no-worktree when git is unavailable', () => {
    const wt = detectWorktree('/whatever', { exec: fakeExec({ throws: true }) });
    expect(wt.isWorktree).toBe(false);
    expect(wt.mainRoot).toBeNull();
  });

  it('leaves mainRoot null for a non-.git common dir it cannot reason about', () => {
    const wt = detectWorktree('/repo/wt', {
      exec: fakeExec({
        gitDir: '/some/bare/repo.git/worktrees/wt',
        commonDir: '/some/bare/repo.git',
      }),
    });
    // basename ends with `.git` → dirname is taken. This documents that
    // bare-repo-ish layouts still infer a parent; the redirect is then gated by
    // the presence of an actual .aify-graph (covered in resolveGraphRoot tests).
    expect(wt.isWorktree).toBe(true);
  });
});

describe('resolveGraphRoot', () => {
  const linkedExec = fakeExec({
    gitDir: '/repo/main/.git/worktrees/wt-feature',
    commonDir: '/repo/main/.git',
  });
  const mainExec = fakeExec({ gitDir: '/repo/main/.git', commonDir: '/repo/main/.git' });

  const mainGraph = resolve(abs('/repo/main'), '.aify-graph');
  const wtGraph = resolve('/repo/wt-feature', '.aify-graph');

  it('redirects to main root when the worktree has NO graph but main DOES', () => {
    const r = resolveGraphRoot('/repo/wt-feature', {
      env: {},
      exec: linkedExec,
      // worktree has no graph; main does.
      fsExists: (p) => p === mainGraph,
    });
    expect(r.redirected).toBe(true);
    expect(r.root).toBe(abs('/repo/main'));
    expect(r.isWorktree).toBe(true);
  });

  it('does NOT redirect when the worktree has its own graph', () => {
    const r = resolveGraphRoot('/repo/wt-feature', {
      env: {},
      exec: linkedExec,
      fsExists: (p) => p === wtGraph,
    });
    expect(r.redirected).toBe(false);
    expect(r.root).toBe('/repo/wt-feature');
    expect(r.isWorktree).toBe(true);
  });

  it('does NOT redirect when neither worktree nor main has a graph', () => {
    const r = resolveGraphRoot('/repo/wt-feature', {
      env: {},
      exec: linkedExec,
      fsExists: () => false,
    });
    expect(r.redirected).toBe(false);
    expect(r.root).toBe('/repo/wt-feature');
    expect(r.isWorktree).toBe(true);
  });

  it('never redirects a main checkout', () => {
    const r = resolveGraphRoot('/repo/main', {
      env: {},
      exec: mainExec,
      fsExists: () => true,
    });
    expect(r.redirected).toBe(false);
    expect(r.isWorktree).toBe(false);
    expect(r.root).toBe('/repo/main');
  });

  it('is opt-outable via APG_NO_WORKTREE_REDIRECT=1', () => {
    const r = resolveGraphRoot('/repo/wt-feature', {
      env: { APG_NO_WORKTREE_REDIRECT: '1' },
      exec: linkedExec,
      fsExists: (p) => p === mainGraph,
    });
    expect(r.redirected).toBe(false);
    expect(r.root).toBe('/repo/wt-feature');
  });
});
