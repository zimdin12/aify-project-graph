import Database from 'better-sqlite3';
import { readRebuildMarker, GraphRebuildInProgressError } from './rebuild-marker.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSchema } from './schema.js';

function wrapDb(db) {
  return {
    raw: db,
    all: (sql, params) => db.prepare(sql).all(params ?? {}),
    get: (sql, params) => db.prepare(sql).get(params ?? {}),
    run: (sql, params) => db.prepare(sql).run(params ?? {}),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  // ⛔ WITHOUT THIS, DELETED SPACE IS NEVER GIVEN BACK. sand_castle's graph reached
  // 2.87 GB holding ~41 MB of content: 98.5% free pages left behind by the code-intel
  // auto-prune, which had correctly taken it from 1.03M rows to 7,411. DELETE frees pages
  // for REUSE; only VACUUM (or auto_vacuum) returns them to the filesystem.
  //
  // ⚠ ORDER IS LOAD-BEARING AND FAILS SILENTLY. auto_vacuum is settable only on a database
  // that has not been written yet; afterwards SQLite ACCEPTS the pragma, reports success,
  // and changes nothing. `createSchema()` is the obvious disqualifier — but so is
  // `journal_mode = WAL`, which is not obvious at all, and which used to run first here.
  // Measured on this machine, three brand-new files:
  //     WAL then auto_vacuum -> 0    auto_vacuum then WAL -> 2    auto_vacuum alone -> 2
  // I wrote this fix with the old ordering intact and it read as shipped while doing
  // nothing; tests/unit/storage/auto-vacuum.test.js is what caught it, which is the whole
  // argument for asserting on the live pragma instead of on the presence of the call.
  //
  // ⚠ NEW DATABASES ONLY. An existing file keeps auto_vacuum=NONE until someone runs a
  // full VACUUM; there is no in-place upgrade. Graphs built before this commit still need
  // `node scripts/compact-graph.mjs <repo>` once, and graph_health.storage now says so
  // rather than leaving it to be noticed.
  //
  // INCREMENTAL rather than FULL: FULL vacuums on every commit, which would tax the bulk
  // ingest path that this file turns foreign_keys off for. INCREMENTAL only marks pages as
  // reclaimable and lets the pruner choose the moment.
  db.pragma('auto_vacuum = INCREMENTAL');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');  // OFF during bulk ingest — edges may reference not-yet-inserted nodes
  createSchema(db);

  return wrapDb(db);
}

// ⛔ VACUUM ALONE DOES NOT CONVERT auto_vacuum, AND I TOLD A USER THAT IT DID.
//
// sand_castle ran the compaction and got exactly what was advertised on size — 2.87 GB to
// 36.4 MB, content identical — then checked the mode and reported it STILL 0. They were
// right, and my claim ("an existing database stays NONE until one full VACUUM") was wrong
// in the half that mattered: the VACUUM is necessary but does nothing on its own.
//
// Measured on three fresh files, populated then emptied:
//     VACUUM alone                       -> auto_vacuum 0   (unchanged)
//     PRAGMA INCREMENTAL, then VACUUM    -> auto_vacuum 2   (persists on reopen)
//
// The pragma is inert on a populated database — it records an INTENT that the next VACUUM
// on the SAME CONNECTION carries out. So a compaction that omits it reclaims the space and
// leaves the file free to re-accumulate the identical high-water mark, which is the state
// sand_castle was left in: symptom fixed, cause untouched.
//
// ⇒ Reclaiming and upgrading are one operation, so they live in one function. Returns the
// resulting mode so a caller can report what actually happened rather than assume.
export function vacuumWithIncrementalUpgrade(db) {
  const h = typeof db?.pragma === 'function' ? db : db?.raw;
  if (typeof h?.pragma !== 'function') return null;
  try { h.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* not in WAL — fine */ }
  h.pragma('auto_vacuum = INCREMENTAL');   // intent only; the VACUUM below applies it
  h.exec('VACUUM');
  return h.pragma('auto_vacuum', { simple: true });
}

// ⛔ THE GUARD IS HERE BECAUSE THERE ARE 118 READER CALL SITES AND 59 FRESHNESS CALL SITES.
// A remedy applied at the call sites is an enumeration, and an enumeration is a list someone must
// remember to update. Every reader opens through this function, and the rebuild writes through
// `openDb`, so refusing here cannot deadlock the writer that sets the marker.
//
// `allowDuringRebuild` is the forced door for the readers that must see a half-built graph in order
// to REPORT on it — graph_health above all, which is the verb a reader calls to find out why.
export function openExistingDb(dbPath, { readonly = true, allowDuringRebuild = false } = {}) {
  if (!existsSync(dbPath)) {
    throw new Error(`graph DB does not exist: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  const wrapped = wrapDb(db);
  if (!allowDuringRebuild) {
    const marker = readRebuildMarker(wrapped);
    if (marker) {
      db.close();
      throw new GraphRebuildInProgressError(marker, Date.now());
    }
  }
  return wrapped;
}
