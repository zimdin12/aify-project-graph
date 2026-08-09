// A hook that refreshes the graph but not the briefs is worse than no hook: the
// session-start skill tells every agent to read brief.agent.md FIRST, so the
// result is fresh graph + stale brief + a mechanism reporting ok. graph_health
// tracks briefStaleVsManifest and unresolvedCategorizationStaleVsManifest
// separately from graph staleness precisely because they can diverge.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..');
const src = readFileSync(join(REPO, 'scripts', 'reindex.mjs'), 'utf8');

describe('the hook payload refreshes everything a reader depends on', () => {
  it('refreshes the graph', () => {
    expect(src).toMatch(/ensureFresh/);
  });

  it('★ regenerates briefs — agents read these before anything else', () => {
    expect(src).toMatch(/generateBrief/);
  });

  it('★ refreshes the unresolved categorization', () => {
    expect(src).toMatch(/writeUnresolvedCategorization/);
  });

  it('never fails the git operation', () => {
    // Backgrounded hooks cannot report through an exit code anyway, but an
    // uncaught throw would still print to the hook log and confuse the reader.
    expect(src).toMatch(/process\.exit\(0\)/);
  });

  it('the superseded installers and payload are gone', () => {
    // Two installers with two markers fighting over .git/hooks/post-commit is
    // the two-sources-of-truth pattern that produced most of this repo's
    // defects. One job, one mechanism.
    for (const dead of [
      'scripts/install-hooks.mjs',
      'scripts/hooks/post-commit',
      'scripts/graph-reindex-hook.mjs',
    ]) {
      expect(existsSync(join(REPO, dead)), `${dead} deleted`).toBe(false);
    }
  });

  it('the unrelated SessionStart hook survives', () => {
    // Same directory, completely different mechanism. Deleting it would remove
    // the managed-session discoverability nudge.
    expect(existsSync(join(REPO, 'scripts/hooks/session-start-hint.mjs'))).toBe(true);
  });
});

describe('the hook log survives an early failure', () => {
  it('a failing refresh still writes its FAILED line to the hook log', async () => {
    // ★ THIS DOES NOT GUARD THE mkdir IN log(), AND IS NOT CLAIMED TO.
    //
    // It was written to. It passes with that mkdir removed, because ensureFresh
    // creates `.aify-graph/` before anything that can throw — verified by running
    // both variants against a non-existent repoRoot. A test that passes with and
    // without the change under test is not a regression guard for that change,
    // and calling it one is how this repo shipped two tests asserting the buggy
    // invariant they were meant to catch.
    //
    // Kept for the PROPERTY it does guard, which is real and worth holding: a
    // refresh that fails must leave a diagnostic behind. If ensureFresh's ordering
    // ever changes so `.aify-graph/` is created later, this catches it.
    const { mkdtempSync, existsSync, readFileSync, rmSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const { tmpdir } = await import('node:os');

    // A directory with no .aify-graph/ and no git repo, so ensureFresh fails early.
    const bare = mkdtempSync(join(tmpdir(), 'apg-earlyfail-'));
    try {
      execFileSync('node', [join(REPO, 'scripts', 'reindex.mjs'), bare, 'post-commit'],
        { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
      const logPath = join(bare, '.aify-graph', 'hook.log');
      expect(existsSync(logPath), 'hook.log written even though .aify-graph did not exist').toBe(true);
      expect(readFileSync(logPath, 'utf8')).toMatch(/post-commit/);
    } finally {
      try { rmSync(bare, { recursive: true, force: true }); } catch { /* windows lock */ }
    }
  }, 150000);
});
