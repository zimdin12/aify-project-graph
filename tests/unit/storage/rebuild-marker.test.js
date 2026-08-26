// A REBUILD EMPTIES THE GRAPH BEFORE IT REFILLS IT, AND A READ TAKEN IN THAT WINDOW IS A FALSE
// ABSENCE. These tests exist because `graph_callers` was MEASURED rendering a caller set of zero
// during a rebuild — 2 of 3 runs, always at the leading edge. See
// docs/2026-08-26-the-graph-is-briefly-empty-and-a-verb-will-say-so.md.
//
// Each test below names the bug it would catch. Every one of them was watched going RED against a
// mutated implementation before being kept.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import {
  readRebuildMarker, markRebuildStarted, clearRebuildMarker, rebuildInProgressMessage,
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
