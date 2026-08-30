// THE PUBLICATION TABLES — state that used to live in files beside the database.
//
// ⛔ WHY THESE MOVED. A rebuild committed the graph, then wrote its sidecars best-effort, then wrote
// the manifest `ok`. Each promotion was a separate event, so a failure between them left artifacts
// describing a graph that did not exist. Reviewer executed both halves:
//
//   - dirty-edge sidecar forced to fail: manifest read `status: ok` with a new commit while the full
//     sidecar was unavailable, and `readDirtyEdgesSidecar` treats unreadable as `[]` — so the next
//     incremental run silently dropped those unresolved refs.
//   - structural-fp: a VALID OLD sidecar was restored and the next run trusted it for cosmetic
//     classification. Result `cosmeticSkipped:1`, `processedFiles:[]`, source `shapeA`, DB `shapeB`.
//     A missing sidecar disables the fast path; a stale valid one lies.
//
// Generation-binding those files would DETECT the mismatch. Putting them in SQLite makes it
// unconstructible: they are written inside the same BEGIN IMMEDIATE as the graph, roll back with it,
// and cannot be valid-but-stale because there is no separate promotion event. That collapses three
// file formats needing a generation contract down to one comparison, DB against manifest.
//
// Scale was checked before choosing, not after: the live unresolved population is 35,906 rows /
// 11.3 MB of JSON rewritten every run. That is ordinary SQLite and tiny beside code_intel_records.

// ⛔ SURROGATE ROW ID, AND NO UNIQUE CONSTRAINT ANYWHERE. Measured on the frozen carrier before this
// table existed: 2,547 identity keys appear more than once, max multiplicity 15, so 35,906 rows
// collapse to 32,562 distinct keys. A unique constraint or INSERT OR REPLACE would silently discard
// 3,344 rows and report success — deduplication as an accidental migration.
//
// ⛔ AND THE COLUMNS ARE THE RESOLVER CONTRACT, NOT THE CURRENT RENDERERS. `from_target`, `to_id`
// and `language` appear in ZERO of the 35,906 live rows on this repository and are still live
// resolver seams — population zero is not contract absence. Dropping them because today's data
// lacks them is how a seam dies silently.
const UNRESOLVED_REFS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS unresolved_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT,
    from_target TEXT,
    to_id TEXT,
    target TEXT,
    relation TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_line INTEGER,
    confidence REAL,
    provenance TEXT,
    extractor TEXT,
    language TEXT,
    refused_reason TEXT,
    import_map_json TEXT,
    CHECK (from_id IS NOT NULL OR from_target IS NOT NULL),
    CHECK (to_id IS NOT NULL OR target IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS unresolved_refs_source_idx ON unresolved_refs(source_file);
  CREATE INDEX IF NOT EXISTS unresolved_refs_relation_idx ON unresolved_refs(relation);
  CREATE INDEX IF NOT EXISTS unresolved_refs_refused_idx ON unresolved_refs(refused_reason);
`;

// One row per file. Unlike the refs table this one IS keyed, because a file has exactly one
// structural shape and re-extracting it replaces that shape rather than appending to it.
const STRUCTURAL_FINGERPRINTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS structural_fingerprints (
    file_path TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL
  );
`;

// ⭐ ONE ROW, AND IT IS THE ONLY THING THE MANIFEST HAS TO AGREE WITH.
//
// Incremented inside the rebuild transaction, so it moves with the graph or not at all. The manifest
// is written after the commit and names the generation it read from the committed database; a reader
// that finds them different is looking at a half-published state and refuses.
//
// ⚠ `generation` starts at 1. A database with the table but generation 0 never completed a rebuild
// under this code, which is a different fact from a database with no table at all (legacy), and the
// two must not be collapsed.
const GRAPH_GENERATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS graph_generation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL,
    committed_at TEXT NOT NULL
  );
`;

export function ensurePublicationTables(db) {
  // Accepts both a raw better-sqlite3 Database and the wrapped db from db.js — both expose .exec.
  db.exec(UNRESOLVED_REFS_TABLE_SQL);
  db.exec(STRUCTURAL_FINGERPRINTS_TABLE_SQL);
  db.exec(GRAPH_GENERATION_TABLE_SQL);
}

/**
 * The generation a reader must compare against the manifest.
 * Returns null when the table does not exist (a LEGACY graph, built before this code) — which is a
 * different state from generation 0, and callers must keep them apart.
 */
export function readGraphGeneration(db) {
  try {
    const row = db.all('SELECT generation FROM graph_generation WHERE id = 1')[0];
    return row ? row.generation : 0;
  } catch {
    return null;
  }
}

/** Caller is responsible for running this INSIDE the rebuild transaction. */
export function bumpGraphGeneration(db) {
  ensurePublicationTables(db);
  const current = readGraphGeneration(db) ?? 0;
  const next = current + 1;
  db.run(
    `INSERT INTO graph_generation (id, generation, committed_at) VALUES (1, $g, $t)
     ON CONFLICT(id) DO UPDATE SET generation = $g, committed_at = $t`,
    { g: next, t: new Date().toISOString() },
  );
  return next;
}
