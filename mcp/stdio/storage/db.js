import Database from 'better-sqlite3';
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

// A READER NEEDS NO REBUILD GUARD: the rebuild publishes in ONE transaction, so under WAL every
// reader holds a complete snapshot — the previous graph until the commit, the new one after.
// A runtime marker was tried here first and MEASURED UNOBSERVABLE once the rebuild became atomic
// (364 samples of a real rebuild, never once set), so it was removed rather than left as decoration.
// The invariant is enforced by tests/unit/storage/rebuild-transaction.test.js instead.
export function openExistingDb(dbPath, { readonly = true } = {}) {
  if (!existsSync(dbPath)) {
    throw new Error(`graph DB does not exist: ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  return wrapDb(db);
}

/**
 * Run `fn` against a PINNED read snapshot: every read inside sees one instant of the database.
 *
 * ⛔ THE BUG THIS EXISTS FOR IS CHECK-THEN-ACT, AND IT SURVIVES ATOMIC PUBLICATION.
 * A reader that asks "is this graph attested?" and then asks "what does it contain?" makes two
 * reads. Publication being one transaction guarantees each read is internally whole — it does NOT
 * stop a commit landing BETWEEN them. So the check can pass against generation N and the data can
 * come from N+1, and every individual read was correct. Nothing in the result would look wrong.
 *
 * Under WAL a read transaction fixes the snapshot at its first read and holds it until it ends, so
 * the generation check and the data reads become one observation of one graph.
 *
 * ⛔ READONLY, ALWAYS, AND NOT NEGOTIABLE BY THE CALLER. A pinned WRITE handle raises
 * SQLITE_BUSY_SNAPSHOT the moment another connection commits — collect_code_intel.js opens with
 * `readonly: false` and would start failing under exactly the concurrency this is meant to survive.
 * There is deliberately no option to pass a writable handle: the safe thing must not be optional.
 *
 * ⚠ THE SNAPSHOT PINS THE DATABASE, NOT THE MANIFEST. The manifest is a separate file and a
 * separate read; it must be read BEFORE the snapshot opens, so that a commit landing in between
 * shows up as a generation mismatch (refuse) rather than being silently absorbed.
 */
export function withExistingSnapshot(dbPath, fn) {
  const db = openExistingDb(dbPath, { readonly: true });
  try {
    db.raw.exec('BEGIN');
    // Pin the snapshot HERE rather than leaving it to whatever `fn` happens to read first.
    // A deferred BEGIN acquires nothing until something reads, so without this the window the
    // function exists to close stays open for as long as `fn` does non-database work — reading a
    // manifest, awaiting a lock, formatting a response. Mutation-tested: removing this line makes
    // a commit landing before the callback's first read visible inside the snapshot.
    db.raw.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
    return fn(db);
  } finally {
    // ⚠ NO EXPLICIT ROLLBACK, DELIBERATELY. Closing the connection ends the read transaction and
    // releases the snapshot, so a ROLLBACK here would be a line that reads like a safeguard while
    // changing nothing. Measured, not assumed: a mutant that removed the ROLLBACK and kept only
    // this close() SURVIVED the whole suite, including the case where the callback throws. Rather
    // than leave ceremony that a future reader would trust, the ceremony is gone and the reason is
    // written down.
    db.close();
  }
}
