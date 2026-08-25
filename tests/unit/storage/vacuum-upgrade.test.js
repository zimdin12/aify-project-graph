// COMPACTING A LEGACY GRAPH MUST ALSO CONVERT IT, OR IT REFILLS.
//
// ⛔ THIS DEFECT REACHED A USER AND I ASSERTED THE OPPOSITE. I told the field fleet that "an
// existing database stays NONE until one full VACUUM", which reads as: run the compaction
// and the mode converts. They ran it, got exactly the advertised result on size
// (2.87 GB -> 36.4 MB, content identical), checked the mode, and reported it STILL 0.
//
// Measured on three fresh files, populated then emptied:
//     VACUUM alone                      -> auto_vacuum 0   (unchanged)
//     PRAGMA INCREMENTAL, then VACUUM   -> auto_vacuum 2   (persists on reopen)
//
// The pragma is INERT on a populated database by itself — it records an intent that the
// next VACUUM on the SAME CONNECTION carries out. compact-graph.mjs ran a bare VACUUM, so
// it reclaimed 2.7 GB and left the file free to re-accumulate the identical high-water
// mark. Symptom fixed, cause untouched.
//
// ★ Why the halves must be tested separately: the size reclaim SUCCEEDED. Every visible
// signal said the operation worked. Only the mode — which nothing printed — carried the
// failure. So the assertions below check the file shrank AND that it converted, because a
// test of the first alone is precisely what would have passed while a user's file stayed
// broken.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openExistingDb, vacuumWithIncrementalUpgrade } from '../../../mcp/stdio/storage/db.js';
import { createSchema } from '../../../mcp/stdio/storage/schema.js';

// A graph as it existed BEFORE openDb() began setting the pragma — the shape every
// already-deployed file still has. Built deliberately rather than via openDb(), because
// openDb() now produces the fixed shape and would test nothing.
function legacyGraph(dir) {
  const dbPath = join(dir, 'graph.sqlite');
  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  createSchema(raw);
  const insert = raw.prepare(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language)
     VALUES (?, 'Function', ?, ?, 1, 2, 'js')`);
  raw.transaction(() => {
    for (let i = 0; i < 4000; i += 1) insert.run(`n${i}`, `sym_${i}_${'x'.repeat(80)}`, `src/f${i}.js`);
  })();
  raw.exec('DELETE FROM nodes');
  expect(raw.pragma('auto_vacuum', { simple: true }), 'fixture must start on NONE or it proves nothing').toBe(0);
  raw.close();
  return dbPath;
}

describe('compacting a legacy graph converts it as well as shrinking it', () => {
  it('★★★ the file shrinks AND lands on INCREMENTAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apg-upg-'));
    try {
      const dbPath = legacyGraph(dir);
      const before = statSync(dbPath).size;
      const db = openExistingDb(dbPath, { readonly: false });
      let mode;
      try { mode = vacuumWithIncrementalUpgrade(db); } finally { db.close(); }

      expect(statSync(dbPath).size, 'the file must actually shrink').toBeLessThan(before);
      expect(mode, 'reclaimed but still on NONE — this is the state a user was left in').toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('★★★ the conversion survives closing and reopening the database', () => {
    // A mode that only holds on the connection that set it would be indistinguishable
    // from a real upgrade at the moment of the call, and useless afterwards.
    const dir = mkdtempSync(join(tmpdir(), 'apg-upg-'));
    try {
      const dbPath = legacyGraph(dir);
      const db = openExistingDb(dbPath, { readonly: false });
      try { vacuumWithIncrementalUpgrade(db); } finally { db.close(); }

      const reopened = new Database(dbPath);
      try {
        expect(reopened.pragma('auto_vacuum', { simple: true })).toBe(2);
      } finally { reopened.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('★★ a bare VACUUM does NOT convert — the negative control that names the old bug', () => {
    // Pins the SQLite behaviour the fix depends on. If a future version made plain VACUUM
    // carry the mode across, the helper would still be correct but this file would be
    // asserting something untrue about why — and that is worth being told.
    const dir = mkdtempSync(join(tmpdir(), 'apg-upg-'));
    try {
      const dbPath = legacyGraph(dir);
      const raw = new Database(dbPath);
      try {
        raw.exec('VACUUM');
        expect(raw.pragma('auto_vacuum', { simple: true }),
          'bare VACUUM converted the mode — the premise of vacuumWithIncrementalUpgrade changed').toBe(0);
      } finally { raw.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
