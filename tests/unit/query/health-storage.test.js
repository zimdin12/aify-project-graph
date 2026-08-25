// graph_health MUST REPORT HOW MUCH OF THE GRAPH FILE IS ACTUALLY DATA.
//
// ⛔ sand_castle ran at 2.87 GB for 12,478 nodes / 49,229 edges. 98.5% of it was free
// pages — residue of a code-intel prune that deleted 1.03M records and never reclaimed
// them. the field fleet noticed only by running `ls -la` and thinking the number looked wrong,
// and was careful to report it as an observation because nothing in the tool would tell
// them either way. It had been that way for months.
//
// ★ The reason it survived is that it was SILENT, so the check has to speak in both
// directions: the numbers are emitted on every call, and only the REMEDY is conditional. A
// check that appears solely when unhappy cannot be told apart from one that is broken, and
// "storage is fine" is not readable unless its basis is visible too.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { createSchema } from '../../../mcp/stdio/storage/schema.js';
import {
  inspectStorage, STORAGE_RECLAIM_MIN_BYTES, STORAGE_RECLAIM_MIN_RATIO,
} from '../../../mcp/stdio/query/verbs/health.js';

function withGraph(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-store-'));
  const dbPath = join(dir, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath);
  try { return fn(db, dbPath); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

// A graph in the shape every already-deployed file has: auto_vacuum=NONE. Built without
// openDb(), which now produces the converted shape and so cannot represent the legacy case.
function withLegacyGraph(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-legacy-'));
  const dbPath = join(dir, '.aify-graph', 'graph.sqlite');
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  createSchema(raw);
  const db = { raw, run: (sql) => raw.prepare(sql).run(), get: (sql) => raw.prepare(sql).get() };
  try {
    if (raw.pragma('auto_vacuum', { simple: true }) !== 0) throw new Error('fixture is not legacy');
    return fn(db, dbPath);
  } finally { raw.close(); rmSync(dir, { recursive: true, force: true }); }
}

function fill(db, rows) {
  const insert = db.raw.prepare(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language)
     VALUES (?, 'Function', ?, ?, 1, 2, 'js')`);
  db.raw.transaction(() => {
    for (let i = 0; i < rows; i += 1) insert.run(`n${i}`, `sym_${i}_${'x'.repeat(60)}`, `src/f${i}.js`);
  })();
}

describe('graph_health reports the storage basis', () => {
  it('★★★ a healthy graph still publishes the numbers, not just a clean verdict', () => {
    withGraph((db, dbPath) => {
      fill(db, 500);
      const s = inspectStorage(db, dbPath);
      expect(s.measured).toBe(true);
      expect(s.reclaimable, 'a small fresh graph must not be nagged').toBe(false);
      // The basis is the point. A reader must be able to see WHY it is fine.
      expect(typeof s.fileMb).toBe('number');
      expect(typeof s.contentMb).toBe('number');
      expect(typeof s.freeMb).toBe('number');
      expect(s.freePercent).toBeGreaterThanOrEqual(0);
      expect(s.freePercent).toBeLessThanOrEqual(100);
      // No remedy offered when there is nothing to remedy.
      expect(s.remedy).toBeUndefined();
    });
  });

  it('★★★ deleted-but-unreclaimed space trips the remedy, and the remedy names the repo', () => {
    withGraph((db, dbPath) => {
      fill(db, 4000);
      db.run('DELETE FROM nodes');
      // Thresholds injected so the BRANCH is exercised without manufacturing 50 MB of
      // waste; the shipped defaults are pinned separately below.
      const s = inspectStorage(db, dbPath, { minFreeBytes: 1, minFreeRatio: 0.01 });
      expect(s.reclaimable, 'freed pages are sitting in the file and nothing said so').toBe(true);
      expect(s.freeMb).toBeGreaterThanOrEqual(0);
      expect(s.note).toMatch(/free pages, not data/);
      // The remedy has to be runnable. It takes a REPO ROOT, so the .aify-graph/graph.sqlite
      // suffix must be stripped — pasting a path to the .sqlite file would just fail.
      expect(s.remedy).toMatch(/compact-graph\.mjs /);
      expect(s.remedy, 'remedy must name the repo root, not the db file').not.toMatch(/graph\.sqlite/);
    });
  });

  it('★★ the same graph reports NOT reclaimable under the shipped thresholds', () => {
    // The negative half. Without it, "reclaimable: true" above could be satisfied by a
    // check that is simply always true, and every healthy repo would get the warning.
    withGraph((db, dbPath) => {
      fill(db, 4000);
      db.run('DELETE FROM nodes');
      expect(inspectStorage(db, dbPath).reclaimable).toBe(false);
    });
  });

  it('★★★ a graph that cannot reclaim in place says so even when it looks perfectly healthy', () => {
    // The state sand_castle was left in after compaction: 36 MB, 0% free, reclaimable
    // false — clean on every size measure, and still on auto_vacuum=NONE, so it would
    // rebuild the same high-water mark. They had to notice that themselves. "Is space
    // wasted right now" and "can this file ever give space back" are different questions
    // and a clean answer to the first must not stand in for the second.
    withLegacyGraph((db, dbPath) => {
      const s = inspectStorage(db, dbPath);
      expect(s.reclaimable, 'a freshly-vacuumed legacy graph has nothing to reclaim').toBe(false);
      expect(s.canReclaimInPlace, 'auto_vacuum=NONE cannot return pages by itself').toBe(false);
      expect(s.upgrade, 'the latent half must be stated, not left to be noticed').toMatch(/compact-graph\.mjs/);
      expect(s.upgrade, 'must warn that a bare VACUUM is not enough').toMatch(/bare VACUUM does NOT convert/);
      expect(s.upgrade, 'the command takes a repo root').not.toMatch(/graph\.sqlite/);
    });
  });

  it('★★ a converted graph reports canReclaimInPlace and offers no upgrade', () => {
    // The negative half: openDb() now produces INCREMENTAL, and those must not be nagged.
    withGraph((db, dbPath) => {
      const s = inspectStorage(db, dbPath);
      expect(s.autoVacuum).toBe(2);
      expect(s.canReclaimInPlace).toBe(true);
      expect(s.upgrade).toBeUndefined();
    });
  });

  it('★ the shipped thresholds are the ones documented', () => {
    expect(STORAGE_RECLAIM_MIN_BYTES).toBe(52_428_800);
    expect(STORAGE_RECLAIM_MIN_RATIO).toBe(0.25);
  });

  it('★★ an unreadable handle reports measured:false, never a fabricated size', () => {
    // Fail closed. A storage section that guessed would be worse than none, because the
    // whole value here is that a number appears where silence used to be.
    expect(inspectStorage(null, '/nowhere/.aify-graph/graph.sqlite'))
      .toEqual({ measured: false, reason: 'no_db_handle' });
  });
});
