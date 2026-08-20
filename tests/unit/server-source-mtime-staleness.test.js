// A COMMIT COMPARISON CANNOT SEE AN UNCOMMITTED EDIT, AND THAT IS THE COMMON CASE.
//
// ⛔ `staleProcess` was `LOADED_COMMIT !== treeCommit`. It fires when someone pulls or commits and
// is SILENT while a developer edits a server file and has not committed — which is what developing
// looks like, for hours at a time, and is the state this process spends most of its life in during
// active work.
//
// Measured consequence: THREE OF ef-manager's LAST FOUR REVIEW ROUNDS opened blocked on a stale
// process. The failure mode was not a wrong warning — it was NO warning, because HEAD had not
// moved. And the stale code belongs to the SERVER, so one stale process poisons every repo it
// answers for while each repo's own staleness field reads clean.
//
// ⇒ The process now fingerprints its own source at load and re-checks it. mtime, not content: a
// hash of every module would be exact and cost a full read of the tree on every cache miss, and
// the question is only "did anything change since I read it".
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newestSourceMtime, sourceChangedSinceLoad, buildStaleWarning, cannotVerifySourceWarning,
} from '../../mcp/stdio/server-build.js';

let dir;
afterEach(async () => {
  if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* win lock */ } }
  dir = undefined;
});

async function sourceTree() {
  dir = await mkdtemp(join(tmpdir(), 'apg-mtime-'));
  await mkdir(join(dir, 'nested'), { recursive: true });
  await writeFile(join(dir, 'a.js'), '// a\n');
  await writeFile(join(dir, 'nested', 'b.js'), '// b\n');
  await writeFile(join(dir, 'nested', 'notes.md'), '# not source\n');
  return dir;
}

describe('the server notices its own source changing under it', () => {
  it('★★★ an edit with NO COMMIT is detected — the case the commit check is blind to', async () => {
    const root = await sourceTree();
    const loaded = newestSourceMtime(root);
    expect(loaded, 'the fingerprint must be readable, or every assertion below is vacuous')
      .toBeGreaterThan(0);

    // Nothing has changed yet. If this reported `true`, the test below would pass for free.
    expect(sourceChangedSinceLoad(newestSourceMtime(root), loaded),
      'unchanged tree, unchanged answer').toBe(false);

    // Edit a nested file. No git anywhere in this fixture — that is the point: the signal must not
    // depend on a commit having happened.
    const future = new Date(Date.now() + 5000);
    await writeFile(join(root, 'nested', 'b.js'), '// b, edited\n');
    await utimes(join(root, 'nested', 'b.js'), future, future);

    expect(sourceChangedSinceLoad(newestSourceMtime(root), loaded),
      'a written file is a changed process').toBe(true);
  }, 20_000);

  it('★★★ a NON-SOURCE file does not trip it', async () => {
    // The negative control on scope. Editing a markdown file next to the code does not change what
    // the process is executing, and a check that fired on it would be noise the reader learns to
    // ignore — which is worse than silence, because it takes the real signal with it.
    const root = await sourceTree();
    const loaded = newestSourceMtime(root);
    const future = new Date(Date.now() + 5000);
    await writeFile(join(root, 'nested', 'notes.md'), '# edited\n');
    await utimes(join(root, 'nested', 'notes.md'), future, future);

    expect(sourceChangedSinceLoad(newestSourceMtime(root), loaded),
      'only .js files are the code this process runs').toBe(false);
  }, 20_000);

  it('★★★ THREE STATES: an unreadable tree answers null, never "unchanged"', async () => {
    // ⛔ The collapse this repo has now found six times, and it fails in the reassuring direction
    // every time. A scan that could not run must not report "not stale" — CANNOT ANSWER is its own
    // state, and `newestSourceMtime` returns null rather than 0 for exactly this reason: a zero
    // would compare as older-than-everything and make a broken scan look like a pristine tree.
    expect(newestSourceMtime(join(tmpdir(), 'apg-does-not-exist-at-all'))).toBeNull();
    expect(sourceChangedSinceLoad(null, 12345), 'cannot answer').toBeNull();
    expect(sourceChangedSinceLoad(12345, null), 'cannot answer').toBeNull();
  });

  it('★★★ a partially unreadable tree answers null rather than the part it could read', async () => {
    // The subtler half. Walking must fail CLOSED: if any directory cannot be read, the maximum
    // computed from the rest is a fingerprint of a different tree than the one that was loaded,
    // and comparing it would silently narrow the population being checked.
    const root = await sourceTree();
    expect(newestSourceMtime(join(root, 'nope'))).toBeNull();
  }, 20_000);

  it('★★★ THREE OUTPUTS FOR THREE INPUTS — cannot-verify is not silence', async () => {
    // ⛔ SEVENTH TWO-STATE COLLAPSE, IN THE COMMIT THAT FIXED THE SIXTH, THIRTY LINES APART.
    //
    // `newestSourceMtime` returns null on a failed scan and `sourceChangedSinceLoad` returns null
    // for CANNOT ANSWER — both correct, both commented. Then the CONSUMER had two outcomes for
    // three inputs: `staleProcess = commitMoved || sourceEdited === true` makes null false, and
    // `staleProcessWarning()` returned null for it. Scan-failed and unchanged were the same
    // observable.
    //
    // ef-manager ran the null path rather than reading it, and quoted my own comment back at me:
    // the function honoured the rule, the two places anyone reads did not.
    //
    // ⚠ AND THE TRIGGER IS A WEEKDAY ON WINDOWS: `walk` propagates failure upward, so ONE
    // unreadable file anywhere under mcp/stdio/ switches the whole signal off.
    const msg = cannotVerifySourceWarning();
    expect(msg, 'it must say it does not know, not imply a clean result')
      .toContain('CANNOT VERIFY');
    expect(msg, 'and say explicitly that absence of a result is not a result')
      .toContain('NOT a clean result');
    expect(msg, 'and carry the same blast radius as the stale warning')
      .toContain('EVERY REPO THIS PROCESS SERVES');

    // ⛔ AND IT MUST BE DISTINGUISHABLE FROM BOTH NEIGHBOURS, or the third state is decoration.
    const stale = buildStaleWarning({
      loadedCommit: 'abc1234', startedAt: 'T', treeCommit: 'abc1234',
      staleDelta: null, commitMoved: false, sourceEdited: true,
    });
    expect(msg).not.toBe(stale);
    expect(msg).not.toBeNull();
  });

  it('★★★ THE CONSUMER emits cannot-verify — not just the message function', async () => {
    // ⛔ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT, AND THE ONE ABOVE IS NOT.
    //
    // The message function was already correct. `sourceChangedSinceLoad` returned null and said so
    // in a comment. The defect lived in `staleProcess` and `staleProcessWarning()`, which turned
    // that null into silence — so a test of the message alone re-tests the half that was right,
    // which is precisely the mistake that produced the defect.
    //
    // The scan-failure state is reached through a ONE-DIRECTIONAL seam: it can force failure and
    // cannot force a clean result, because a seam that can manufacture "healthy" is a way to make
    // a guard pass.
    const saved = process.env.APG_TEST_FORCE_SOURCE_SCAN_FAIL;
    try {
      process.env.APG_TEST_FORCE_SOURCE_SCAN_FAIL = '1';
      vi.resetModules();
      const m = await import('../../mcp/stdio/server-build.js');
      m._resetServerBuildCache();
      const info = m.serverBuildInfo();

      expect(info.staleSignals.sourceEdited, 'the third state survives into the signals')
        .toBeNull();
      // ⚠ And staleProcess stays FALSE, deliberately: cannot-verify is not "stale". Conflating
      // them would make every unreadable file a restart demand.
      expect(info.staleProcess, 'unknown is not the same claim as stale').toBe(false);
      // ⛔ THE LINE THAT MATTERS. Before the fix this was null — indistinguishable from a clean,
      // checked, unchanged build.
      const w = m.staleProcessWarning();
      expect(w, 'a failed scan must not read as silence').not.toBeNull();
      expect(w).toContain('CANNOT VERIFY');
    } finally {
      if (saved === undefined) delete process.env.APG_TEST_FORCE_SOURCE_SCAN_FAIL;
      else process.env.APG_TEST_FORCE_SOURCE_SCAN_FAIL = saved;
      vi.resetModules();
    }
  }, 20_000);

  it('★★★ CHECKED-AND-UNCHANGED stays silent — the other way to break a warning', async () => {
    // The control on the fix. Collapsing `false` into the cannot-verify branch would trade a
    // silent failure for a PERMANENT FALSE ALARM, and a warning that always fires is discarded
    // just as completely as one that never does. `=== null` rather than a falsy test.
    const root = await sourceTree();
    const loaded = newestSourceMtime(root);
    expect(sourceChangedSinceLoad(newestSourceMtime(root), loaded),
      'checked, and genuinely unchanged').toBe(false);
  }, 20_000);

  it('★★★ the warning DESCRIBES THE SIGNAL THAT FIRED, not the other one', async () => {
    // ⛔ The commit-move message says "the checkout is now <treeCommit>" — FALSE when HEAD never
    // moved and only a file was edited, because then treeCommit === loadedCommit and the reader is
    // told two identical shas differ. A warning that misdescribes its own trigger teaches people to
    // distrust it, and this file has already shipped one field whose name contradicted its content.
    const edited = buildStaleWarning({
      loadedCommit: 'abc1234', startedAt: '2026-08-20T00:00:00Z', treeCommit: 'abc1234',
      staleDelta: null, commitMoved: false, sourceEdited: true,
    });
    expect(edited, 'names the real trigger').toContain('MODIFIED SINCE');
    expect(edited, 'and says why a commit check missed it').toContain('HEAD is still abc1234');
    expect(edited, 'never claims the checkout moved').not.toContain('the checkout is now');

    const moved = buildStaleWarning({
      loadedCommit: 'abc1234', startedAt: '2026-08-20T00:00:00Z', treeCommit: 'def5678',
      staleDelta: null, commitMoved: true, sourceEdited: false,
    });
    expect(moved, 'the other branch still says its own thing').toContain('the checkout is now def5678');

    // Both messages must carry the cross-repo consequence: the stale code belongs to the SERVER, so
    // a second repo whose own checkout has not moved still gets answers from it.
    for (const [name, msg] of [['edited', edited], ['moved', moved]]) {
      expect(msg, `${name} must state the blast radius`).toContain('EVERY REPO THIS PROCESS SERVES');
    }
  });
});
