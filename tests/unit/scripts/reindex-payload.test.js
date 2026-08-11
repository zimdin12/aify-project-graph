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
  // ★★ THESE THREE WERE `toMatch(/ensureFresh/)` AND FRIENDS — a regex for a function
  // NAME, which passes whether or not the call ever runs, and fails on a rename that
  // changes nothing. ef-manager adjudicated them as "gave up" and named the observable
  // signals: graph_health already reports briefStaleVsManifest and
  // unresolvedCategorizationStaleVsManifest precisely BECAUSE they can diverge from
  // graph freshness.
  //
  // So the property is asserted end to end: index a repo, make the graph stale by
  // committing a change, run the hook payload, and confirm the graph AND both derived
  // artifacts came back in step. That is the actual claim the file's header makes —
  // "a hook that refreshes the graph but not the briefs is worse than no hook" — and no
  // regex over function names could ever check it.
  it('★★ refreshes graph AND briefs AND categorization together — RUN, not grepped', async () => {
    const { mkdtemp, rm, writeFile, mkdir, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { execFileSync } = await import('node:child_process');
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');

    const repo = await mkdtemp(join(tmpdir(), 'apg-hook-payload-'));
    try {
      await mkdir(join(repo, 'src'), { recursive: true });
      await writeFile(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'one'], { cwd: repo });
      await ensureFresh({ repoRoot: repo });

      // Move HEAD so the snapshot is genuinely behind the checkout.
      await writeFile(join(repo, 'src', 'b.js'), 'export function beta() { return alpha(); }\n');
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'two'], { cwd: repo });

      execFileSync(process.execPath, [join(REPO, 'scripts', 'reindex.mjs'), repo, 'test'], { stdio: 'ignore' });

      const health = await graphHealth({ repoRoot: repo });
      const text = typeof health === 'string' ? health : JSON.stringify(health);

      // The graph caught up...
      expect(text, 'the hook must refresh the graph').not.toMatch(/stale: indexed/);
      // ...and so did BOTH derived artifacts. These are the fields that exist because
      // they can diverge; a hook that moved only the graph would light them up.
      expect(text).not.toMatch(/briefStaleVsManifest":\s*true/);
      expect(text).not.toMatch(/unresolvedCategorizationStaleVsManifest":\s*true/);

      // And the brief really is on disk, not merely un-flagged.
      const brief = await readFile(join(repo, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(brief.length, 'agents read this file first — it must exist and be non-empty').toBeGreaterThan(0);
      expect(brief, 'the brief must reflect the SECOND commit, not the first').toMatch(/beta/);
    } finally {
      try { await rm(repo, { recursive: true, force: true }); } catch { /* windows lock */ }
    }
  });

  it('★★ never fails the git operation — RUN, not grepped', async () => {
    // ef-manager's adjudication (2026-08-11) named this the highest-consequence miss of
    // the eighteen source-contract tests, and they were right about why:
    //
    //   it asserted /process\.exit\(0\)/ ON A POST-COMMIT HOOK.
    //
    // The regex passes as long as that literal appears ANYWHERE in the file — including
    // on a path that never executes, or beside a throw that fires first. A green test
    // while the hook breaks someone's commit is not a hypothetical failure mode; it is
    // the only failure mode that matters here, because a hook that exits non-zero is
    // the one thing a user cannot ignore.
    //
    // So: give it a repoRoot that cannot possibly work, and assert the EXIT CODE.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);

    // ⚠ THE FIRST FIXTURE PASSED VACUOUSLY. It used a non-existent nested directory,
    // which reindex simply CREATES via mkdir recursive — so nothing failed and the exit
    // code proved nothing. Worse, running it left a stray `no/such/directory` tree in
    // the repo. Caught by running the script by hand and reading its output instead of
    // trusting the green tick.
    //
    // A path that IS A FILE cannot be mkdir'd, so it produces a genuine ENOTDIR deep in
    // the refresh — a real error on a real path, not a synthetic one.
    const notADirectory = join(REPO, 'package.json');
    let code = null;
    let stderr = '';
    try {
      const res = await run(process.execPath, [join(REPO, 'scripts', 'reindex.mjs'), notADirectory, 'test']);
      code = 0;
      stderr = res.stderr ?? '';
    } catch (err) {
      code = err.code ?? 'threw without a code';
      stderr = err.stderr ?? '';
    }

    // Sanity FIRST: prove something actually went wrong, or "exit 0" is meaningless.
    expect(stderr, 'the fixture must actually make reindex fail').toMatch(/reindex failed/);
    expect(code, 'a post-commit hook must never fail the commit, whatever went wrong').toBe(0);
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
