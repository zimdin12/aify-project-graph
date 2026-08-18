// A GRAPH THAT DELETES MUST GIVE THE SPACE BACK, AND THE PRAGMA THAT ALLOWS IT IS
// ORDER-SENSITIVE IN A WAY THAT FAILS SILENTLY.
//
// ⛔ sand_castle's graph.sqlite: 2.87 GB holding ~41 MB of content. 689,127 of 699,568
// pages were FREE — residue of the code-intel auto-prune, which had correctly taken it
// from 1.03M records to 7,411. DELETE frees pages for REUSE; only VACUUM or auto_vacuum
// returns them to the filesystem, and importer.js delegated that to "the caller". Every
// caller was checked. None did it.
//
// ⚠ THE TRAP THIS FILE EXISTS FOR: `PRAGMA auto_vacuum` only takes effect on a database
// that has not been written yet. Issue it too late and SQLite ACCEPTS the statement,
// reports success, and changes nothing — the fix reads as shipped while the file keeps
// growing.
//
// ★ "Too late" is broader than it sounds, and I got it wrong on the first attempt:
// createSchema() is the obvious disqualifier, but `journal_mode = WAL` is one too, and it
// ran first in openDb(). Measured on three brand-new files:
//     WAL then auto_vacuum -> 0    auto_vacuum then WAL -> 2    auto_vacuum alone -> 2
// The first version of this fix was written with the old ordering intact and did nothing
// at all. This file is what caught it, and it caught it precisely because it reads the
// live pragma off a real database instead of checking that the call is present in source.
//
// ⇒ Hence: run the real openDb(), delete real rows, and assert the FILE shrank.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { reclaimFreedPages } from '../../../mcp/stdio/ingest/code-intel/importer.js';

const scratch = () => mkdtempSync(join(tmpdir(), 'apg-vac-'));

describe('a newly created graph reclaims deleted space', () => {
  it('★★★ openDb sets auto_vacuum = INCREMENTAL (2), not NONE (0)', () => {
    const dir = scratch();
    try {
      const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
      try {
        // 2 = INCREMENTAL. 0 = NONE is both the SQLite default AND what you get if the
        // pragma is issued after the first table exists — so this single assertion covers
        // "we forgot" and "we did it too late" alike.
        expect(db.raw.pragma('auto_vacuum', { simple: true })).toBe(2);
      } finally { db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('★★★ freed pages actually return to the file, not just to the freelist', () => {
    const dir = scratch();
    try {
      const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
      try {
        // Enough rows that the deletion frees whole pages — a handful would fit in one
        // page and free nothing, which would let this pass without exercising anything.
        const insert = db.raw.prepare(
          `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language)
           VALUES (?, 'Function', ?, ?, 1, 2, 'js')`);
        db.raw.transaction(() => {
          for (let i = 0; i < 4000; i += 1) {
            insert.run(`n${i}`, `symbol_${i}_${'x'.repeat(60)}`, `src/file_${i}.js`);
          }
        })();
        const grown = db.raw.pragma('page_count', { simple: true });

        db.run('DELETE FROM nodes');
        const freedToList = db.raw.pragma('freelist_count', { simple: true });
        expect(freedToList, 'DELETE should have freed pages onto the freelist').toBeGreaterThan(0);
        // The state sand_castle was stuck in: pages free, file unchanged.
        expect(db.raw.pragma('page_count', { simple: true })).toBe(grown);

        const reclaimed = reclaimFreedPages(db, 4000);
        expect(reclaimed, 'reclaimFreedPages reported nothing reclaimable').toBeGreaterThan(0);
        expect(db.raw.pragma('freelist_count', { simple: true })).toBe(0);
        expect(db.raw.pragma('page_count', { simple: true }),
          'the FILE must shrink — a smaller freelist with the same page count is the bug')
          .toBeLessThan(grown);
      } finally { db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('★★ reclaiming reports null — not 0 — where it cannot apply', () => {
    // An absence and a measured zero are different facts. On a legacy auto_vacuum=NONE
    // database nothing CAN be reclaimed in place, and saying "0 bytes reclaimed" would
    // read as "checked, nothing to do" for a file that may be 98% empty.
    const dir = scratch();
    try {
      const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
      try {
        expect(reclaimFreedPages(db, 0), 'nothing was deleted → not applicable').toBeNull();
      } finally { db.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
