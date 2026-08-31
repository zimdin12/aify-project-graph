// ⛔ A PINNED READ SNAPSHOT MUST NOT SPAN A SUBPROCESS OR A DIRECTORY WALK.
//
// captureExistingSnapshot exists so a verb's decision inputs come from ONE observation of ONE
// graph. It buys that with a WAL read transaction, and the price of holding one is paid by every
// other process touching the database — a reader open across `git diff` pins the WAL for however
// long git takes, which is unbounded and nothing to do with SQLite.
//
// ⭐ AND graph_health DID EXACTLY THAT. Its capture called collectionDecay (execFileSync git diff),
// eligibleFileCount and coveredFileCount (loadEffectiveIgnoredDirs, a filesystem walk) from inside
// the pinned callback. The comment beside them justified the grouping — "reading them at a
// different instant from the attestation is the window this consolidation closes" — which is TRUE,
// and is why nothing prompted a check: the property it named was real, and the property it broke
// was never mentioned. Correct reasoning about the wrong axis.
//
// ⚠ WHY THIS TEST IS STRUCTURAL RATHER THAN A TIMING ASSERTION. Measuring how long the pin is held
// would pass or fail on machine speed. What is actually forbidden is a KIND of work, so the test
// makes that kind observable: child_process.execFileSync is patched to record every call, and the
// recording is compared against the window in which a snapshot is open.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Everything observed during a pin, in order. `depth` is how many captures were open at the time.
const spawnedWhilePinned = [];
let pinDepth = 0;

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    execFileSync: (...args) => {
      if (pinDepth > 0) spawnedWhilePinned.push(String(args[0]));
      return real.execFileSync(...args);
    },
  };
});

vi.mock('../../../mcp/stdio/storage/db.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    captureExistingSnapshot: (dbPath, capture) => {
      pinDepth += 1;
      try { return real.captureExistingSnapshot(dbPath, capture); } finally { pinDepth -= 1; }
    },
  };
});

let repo;

beforeEach(async () => {
  spawnedWhilePinned.length = 0;
  pinDepth = 0;
  repo = mkdtempSync(join(tmpdir(), 'apg-pinwork-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });
  spawnedWhilePinned.length = 0;
  pinDepth = 0;
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('no verb spawns a subprocess while holding a pinned read snapshot', () => {
  it('POSITIVE CONTROL: the instrument sees a subprocess that IS spawned inside a pin', async () => {
    // ⛔ THIS COMES FIRST BECAUSE THE ASSERTION BELOW IS A ZERO. An empty `spawnedWhilePinned`
    // proves nothing unless the recorder can be shown to record — a mock wired to the wrong module,
    // or a pinDepth that never increments, produces the same clean result as a correct fix. Here
    // the forbidden thing is done deliberately, and the instrument must catch it.
    const { captureExistingSnapshot } = await import('../../../mcp/stdio/storage/db.js');
    captureExistingSnapshot(join(repo, '.aify-graph', 'graph.sqlite'), (db) => {
      execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' });
      return db.get('SELECT 1 AS x').x;
    });
    expect(spawnedWhilePinned, 'the recorder cannot see a subprocess it was built to catch')
      .toContain('git');
  });

  it('⛔ graph_health runs NO subprocess inside its capture', async () => {
    spawnedWhilePinned.length = 0;
    const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');
    const out = await graphHealth({ repoRoot: repo });

    // The verb must still have done its work — a health call that returned nothing would trivially
    // spawn nothing, which is the vacuous way to pass this.
    expect(out.summary, 'health must actually have produced a summary').toMatch(/nodes=\d+/);
    expect(spawnedWhilePinned,
      'graph_health held a WAL reader open across a subprocess — collectionDecay shells out to git')
      .toEqual([]);
  });

  it('⛔ the other pinned verbs run no subprocess inside their captures either', async () => {
    // Enumerated because the rule is about the helper, not about one verb. These are the callers
    // that take a capture today; a new one that shells out under a pin should fail here.
    const { graphStatus } = await import('../../../mcp/stdio/query/verbs/status.js');
    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    const { inspectReadFreshness } = await import('../../../mcp/stdio/query/verbs/read_freshness.js');

    spawnedWhilePinned.length = 0;
    await graphStatus({ repoRoot: repo });
    await graphPreflight({ repoRoot: repo, symbol: 'target' });
    await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });

    expect(spawnedWhilePinned, 'a pinned capture spanned a subprocess').toEqual([]);
  });

  it('⛔ the git work SURVIVES the split — it moved outside the pin, it was not deleted', async () => {
    // ⛔ THE CHEAPEST WAY TO PASS EVERY ASSERTION ABOVE IS TO STOP CALLING GIT AT ALL. That would
    // leave collectionDecayFacts permanently null and look exactly like a clean fix — a gate whose
    // closed state is permanent is off, not fail-closed, and the same trap applies to work that was
    // supposedly relocated. This exercises the relocated half directly, against real git history.
    const { decayFromCoveredFiles } = await import('../../../mcp/stdio/query/verbs/health.js');
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
    // ⚠ THE CONTROL FILE HAS TO EXIST BEFORE THE BASE COMMIT. My first version created it in the
    // SAME commit as the change, so `git diff base..head` listed it as ADDED and the decay count
    // was 2 of 2 — the assertion caught a fixture error, not a code error. A file that appears in
    // the range is not an unchanged file.
    writeFileSync(join(repo, 'src', 'untouched.js'), 'export const x = 1;\n');
    git('add', '-A'); git('commit', '-qm', 'add the control file');
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'src', 'a.js'),
      'export function target() { return 2; }\nexport function caller() { return target(); }\n');
    git('add', '-A'); git('commit', '-qm', 'change a.js');
    const head = git('rev-parse', 'HEAD').trim();

    const decay = decayFromCoveredFiles(['src/a.js', 'src/untouched.js'],
      { indexedCommit: base }, head, repo);
    expect(decay.filesCovered, 'both covered files must still be counted').toBe(2);
    expect(decay.filesChangedSinceCollection,
      'a.js changed between the two commits and must be reported as decayed').toBe(1);
  });

  it('POSITIVE CONTROL: an unchanged range reports no decay', async () => {
    // ⛔ Without this, `filesChangedSinceCollection` could be counting everything and the case above
    // would still pass at 1 of 2 by coincidence of the fixture.
    const { decayFromCoveredFiles } = await import('../../../mcp/stdio/query/verbs/health.js');
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
    const head = git('rev-parse', 'HEAD').trim();
    const decay = decayFromCoveredFiles(['src/a.js'], { indexedCommit: head }, head, repo);
    expect(decay.filesCovered).toBe(1);
    expect(decay.filesChangedSinceCollection, 'nothing changed between a commit and itself').toBe(0);
  });
});
