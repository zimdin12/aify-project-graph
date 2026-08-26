// A REBUILD EMPTIES THE GRAPH BEFORE IT REFILLS IT, AND A READ TAKEN IN THAT WINDOW IS A FALSE
// ABSENCE. These tests exist because `graph_callers` was MEASURED rendering a caller set of zero
// during a rebuild — 2 of 3 runs, always at the leading edge. See
// docs/2026-08-26-the-graph-is-briefly-empty-and-a-verb-will-say-so.md.
//
// Each test below names the bug it would catch. Every one of them was watched going RED against a
// mutated implementation before being kept.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import {
  readRebuildMarker, markRebuildStarted, clearRebuildMarker, rebuildInProgressMessage,
  isRebuildRefusalText, rethrowIfRebuildInProgress,
} from '../../../mcp/stdio/storage/rebuild-marker.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let dir; let dbPath; let seed;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-marker-'));
  dbPath = join(dir, 'graph.sqlite');
  seed = openDb(dbPath);
});
// Windows will not unlink a database that still has an open handle, so the seed connection is
// closed here rather than left to the garbage collector.
afterEach(() => { try { seed.close(); } catch { /* already closed by a test */ } rmSync(dir, { recursive: true, force: true }); });

describe('the rebuild marker refuses reads taken from a half-built graph', () => {
  it('POSITIVE CONTROL: opens normally when no rebuild is marked', () => {
    // Catches: a guard that refuses unconditionally would make every test below pass vacuously.
    const db = openExistingDb(dbPath);
    expect(db).toBeTruthy();
    db.close();
  });

  it('refuses to open, with a typed code, while a rebuild is marked', () => {
    // Catches: the reader seam ignoring the marker — the original defect.
    const w = openDb(dbPath);
    markRebuildStarted(w, { now: Date.now(), pid: 4242 });
    w.close();
    let err = null;
    try { openExistingDb(dbPath); } catch (e) { err = e; }
    expect(err, 'a marked rebuild must refuse the read').not.toBeNull();
    expect(err.code).toBe('GRAPH_REBUILD_IN_PROGRESS');
  });

  it('lets a caller that must REPORT on the rebuild through the forced door', () => {
    // Catches: a guard with no door, which would break graph_health — the verb a reader calls to
    // find out why everything else is refusing.
    const w = openDb(dbPath);
    markRebuildStarted(w, { now: Date.now(), pid: 7 });
    w.close();
    const db = openExistingDb(dbPath, { allowDuringRebuild: true });
    expect(readRebuildMarker(db)).toMatchObject({ pid: 7 });
    db.close();
  });

  it('opens again once the rebuild clears the marker', () => {
    // Catches: a marker that is set but never cleared, which would brick every read permanently.
    const w = openDb(dbPath);
    markRebuildStarted(w, { now: Date.now(), pid: 1 });
    clearRebuildMarker(w);
    w.close();
    const db = openExistingDb(dbPath);
    expect(db).toBeTruthy();
    db.close();
  });

  it('reports no rebuild when the table predates this code', () => {
    // Catches: a crash (or a refusal) on every database written before the marker existed.
    const raw = new Database(dbPath);
    raw.exec('DROP TABLE IF EXISTS rebuild_state');
    raw.close();
    const db = openExistingDb(dbPath);
    expect(readRebuildMarker(db)).toBeNull();
    db.close();
  });
});

describe('the refusal tells the reader how to get out of it', () => {
  const message = () => rebuildInProgressMessage({ startedAt: Date.now() - 125_000, pid: 4242 }, Date.now());

  it('names the cause, the age, the process and the remedy', () => {
    // Catches: a bare closed door. The stale-lock message had to be fixed for exactly this, and a
    // refusal that names no way out teaches people to work around the guard instead of waiting.
    const m = message();
    expect(m).toMatch(/GRAPH REBUILD IN PROGRESS/);
    expect(m, 'must say how old the rebuild is').toMatch(/2 minute\(s\) ago/);
    expect(m, 'must name the process holding it').toMatch(/process 4242/);
    expect(m, 'must name the remedy for a killed rebuild').toMatch(/graph_index\(force=true\)/);
  });

  it('never tells the reader the graph is simply empty', () => {
    // Catches: a message that reads as an ANSWER about the repository rather than a refusal about
    // the graph's state — which is the false absence this whole change exists to prevent.
    expectAbsentWithLiveMatcher(
      /no (?:callers|results|matches) found/i,
      { forbidden: 'No callers found for upsertNode', allowed: 'this read is refused rather than answered' },
      message(),
      'the refusal must not be phrased as an empty result',
    );
  });
});

// A CENSUS IS A CLAIM ABOUT WHAT EXISTS, so answering one from a half-built graph is the worst
// version of this defect. `graph_census` opened through `openDb` — the WRITER seam — and so bypassed
// the guard entirely: measured answering 2,922 bytes during a marked rebuild while 24 other verbs
// refused. This is also the test that would have caught my own false coverage claim, that every
// reader opens through `openExistingDb`.
describe('graph_census cannot count a half-built graph', () => {
  it('refuses, naming the rebuild, instead of reporting counts', async () => {
    const { graphCensus } = await import('../../../mcp/stdio/query/verbs/census.js');
    // graph_census resolves <repoRoot>/.aify-graph/graph.sqlite, so the fixture needs the real
    // layout. Without it the verb takes its "no graph here" path and the assertion below would be
    // testing nothing — which is exactly what happened on the first run of this test.
    const repo = mkdtempSync(join(tmpdir(), 'apg-census-'));
    const graphDir = join(repo, '.aify-graph');
    mkdirSync(graphDir, { recursive: true });
    const censusDbPath = join(graphDir, 'graph.sqlite');
    const w = openDb(censusDbPath);
    // A census needs something to count, or a zero result would be indistinguishable from a refusal.
    w.run(`INSERT INTO nodes (id, type, label, file_path) VALUES ('n1', 'Function', 'seeded', 'a.js')`);
    markRebuildStarted(w, { now: Date.now(), pid: 11 });
    w.close();

    const marked = await graphCensus({ repoRoot: repo });
    expect(marked.rebuildInProgress, 'a census taken mid-rebuild must refuse').toBe(true);
    expect(marked.summary).toMatch(/GRAPH REBUILD IN PROGRESS/);

    // POSITIVE CONTROL, same test: with the marker cleared the very same call counts the seeded row.
    const w2 = openDb(censusDbPath);
    clearRebuildMarker(w2);
    w2.close();
    const clean = await graphCensus({ repoRoot: repo });
    rmSync(repo, { recursive: true, force: true });
    expect(clean.indexed, 'the same call must succeed once the rebuild clears').toBe(true);
  });
});

// THE GUARD FIRED, THE PRODUCER WAS HONEST, AND THE CONSUMER INVERTED IT.
// `graph_consequences` refuses correctly and returns the refusal as prose. `graph_packet` filed that
// prose as its consequences payload and rendered "STATUS: known to graph" — an existence claim built
// out of a refusal, measured under a set marker. These tests hold the producer and the consumer to
// the same literal, which is the regression that would silently reopen it.
describe('a refusal must not be mistakable for data', () => {
  it('the consumer recognises the exact text the producer emits', () => {
    // Catches: the banner drifting on one side. Nothing else links these two modules, so drift is
    // silent and reopens the laundering path with every test still green.
    const produced = rebuildInProgressMessage({ startedAt: Date.now(), pid: 3 }, Date.now());
    expect(isRebuildRefusalText(produced), 'the consumer must match what the producer actually emits').toBe(true);
  });

  it('does not mistake an ordinary ambiguous-match string for a refusal', () => {
    // Catches: an over-broad sniffer that would swallow real degrade-path answers. "AMBIGUOUS MATCH"
    // is symbol-name ambiguity — a different meaning of a word that already cost me a void result.
    expect(isRebuildRefusalText('AMBIGUOUS MATCH: 6 definitions named c_str')).toBe(false);
    expect(isRebuildRefusalText(null)).toBe(false);
    expect(isRebuildRefusalText({ rebuild: true })).toBe(false);
  });

  it('a blanket rescue re-raises the rebuild error and swallows nothing else', () => {
    // Catches: `catch {}` sites absorbing the refusal and answering anyway — three of them did.
    const rebuild = Object.assign(new Error('x'), { code: 'GRAPH_REBUILD_IN_PROGRESS' });
    expect(() => rethrowIfRebuildInProgress(rebuild)).toThrow(/x/);
    expect(() => rethrowIfRebuildInProgress(new Error('a slow symbol lookup'))).not.toThrow();
    expect(() => rethrowIfRebuildInProgress(undefined)).not.toThrow();
  });
});
