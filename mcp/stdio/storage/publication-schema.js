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

// ⛔ SURROGATE ROW ID, AND NO DEDUPLICATION ANYWHERE. Measured on the frozen carrier before this
// table existed: 2,547 CANONICAL identity keys appear more than once, max multiplicity 15, so
// 35,906 rows collapse to 32,562 distinct keys. Deduplicating by that canonical key would discard
// 3,344 rows and report success — deduplication as an accidental migration.
//
// ⚠ SAY WHICH KEY, BECAUSE THE SQL AND THE CANONICAL KEY DISAGREE. `identityKey()` normalises a
// missing or null field to an empty string; SQLite does NOT — under UNIQUE, NULLs compare distinct.
// Reviewer executed it: two identical rows carrying NULL under `UNIQUE(a,b,c)` with INSERT OR
// REPLACE retained 2 rows, while the same rows with no NULLs retained 1. On this population
// `from_target` and `to_id` are absent from ALL 35,906 rows and project to SQL NULL, so a natural
// UNIQUE across the seven identity columns would discard nothing at all.
//
// The loss is real and the number is right; the cause is deduplication BY THE CANONICAL KEY — a
// materialised non-null key column under UNIQUE, or an upsert keyed by that identity. I had written
// it as a property of "a unique constraint", which is a different claim about a different mechanism.
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
// ⛔ THE AGGREGATES LIVE HERE, WITH THE GENERATION, BECAUSE THEY ARE PUBLISHED BY ITS COMMIT.
//
// The manifest keeps a copy of both counts and ten production call sites read it. I argued that was
// safe because every consumer sits behind an attestation gate. Reviewer disproved the premise by
// census: graph_status, the brief generator and packet-input read manifest counts with NO gate at
// all, so on a legacy or torn graph they print an unresolved count with nothing saying the graph it
// came from cannot be checked.
//
// ⇒ The manifest copy stays — it is what makes a static brief cheap — but it is a DENORMALISED COPY
// and no longer the authority. The authority is this row, written inside the same transaction as
// the rows it counts, so a reader holding one snapshot gets the generation and the aggregates as
// one fact rather than two that must be trusted to agree.
//
// ⚠ AND THE COUNT ITSELF WAS NEVER THE EXPENSE. I objected that a COUNT over 36,000 rows behind ten
// hot paths would be costly and never measured it; reviewer did: 0.0117 ms per prepared count. The
// real cost is opening the database and re-running trust classification, which is exactly what one
// committed aggregate row avoids.
const GRAPH_GENERATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS graph_generation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL,
    committed_at TEXT NOT NULL,
    unresolved_count INTEGER,
    trust_unresolved_count INTEGER
  );
`;

// ⚠ EXISTING GRAPHS HAVE THE TABLE WITHOUT THE COLUMNS. A graph published between the first
// generation commit and this one carries generation N and no aggregates; ADD COLUMN is the only
// in-place upgrade SQLite offers, and it must be idempotent because ensurePublicationTables runs on
// every open. NULL aggregates are then a THIRD state — attested, but with counts this row never
// recorded — and readers must not read NULL as zero.
const GENERATION_AGGREGATE_COLUMNS = ['unresolved_count', 'trust_unresolved_count'];

function ensureGenerationAggregateColumns(db) {
  let existing;
  try {
    existing = new Set(db.all('PRAGMA table_info(graph_generation)').map((r) => r.name));
  } catch {
    return;   // table not there yet; the CREATE above will include the columns
  }
  for (const col of GENERATION_AGGREGATE_COLUMNS) {
    if (existing.has(col)) continue;
    try { db.exec(`ALTER TABLE graph_generation ADD COLUMN ${col} INTEGER`); } catch { /* raced */ }
  }
}

export function ensurePublicationTables(db) {
  // Accepts both a raw better-sqlite3 Database and the wrapped db from db.js — both expose .exec.
  db.exec(UNRESOLVED_REFS_TABLE_SQL);
  db.exec(STRUCTURAL_FINGERPRINTS_TABLE_SQL);
  db.exec(GRAPH_GENERATION_TABLE_SQL);
  ensureGenerationAggregateColumns(db);
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

// ⛔ FOUR STATES, AND COLLAPSING ANY TWO OF THEM GRANTS AUTHORITY SOMETHING HAS NOT EARNED.
//
//   attested             the database and the manifest name the same completed generation
//   legacy_unattested    no graph_generation table — built before it existed. We cannot check.
//   never_completed      the table exists at generation 0: created, but no rebuild ever committed
//   generation_mismatch  both known and DIFFERENT — the crash window between commit and manifest
//
// ⚠ `legacy_unattested` AND `never_completed` ARE NOT THE SAME FACT, however similar they look
// from a denial. Legacy means the question cannot be asked of this graph and a rebuild will fix it
// permanently. Generation 0 means the question WAS asked and the answer is that nothing has ever
// been published — an empty graph presenting as a real one. They need different words because they
// need different remedies, and a reader who is told the wrong one acts on it.
export const ATTESTATION = Object.freeze({
  ATTESTED: 'attested',
  LEGACY_UNATTESTED: 'legacy_unattested',
  NEVER_COMPLETED: 'never_completed',
  GENERATION_MISMATCH: 'generation_mismatch',
});

/**
 * Compare what the database committed against what the manifest claims.
 *
 * ⛔ EVERY UNKNOWN FAILS CLOSED UNDER ITS OWN WORDING. A missing table is not reported as a
 * mismatch, and a mismatch is not reported as legacy: both deny, but only one of them knows why,
 * and the remedy differs. This is the whole comparison the unit collapses to — one integer against
 * one integer — so it must not quietly widen into a guess.
 *
 * @param {number|null|undefined} dbGeneration        from readGraphGeneration (null = no table)
 * @param {number|null|undefined} manifestGeneration  the manifest's own claim
 */
export function classifyAttestation({ dbGeneration, manifestGeneration } = {}) {
  if (dbGeneration === null || dbGeneration === undefined) return ATTESTATION.LEGACY_UNATTESTED;
  if (!Number.isInteger(dbGeneration)) return ATTESTATION.GENERATION_MISMATCH;
  if (dbGeneration === 0) return ATTESTATION.NEVER_COMPLETED;
  // A manifest with no generation against a database that HAS one is a mismatch, not legacy: the
  // database is past the upgrade and the manifest is behind it, which is precisely the crash window.
  if (manifestGeneration !== dbGeneration) return ATTESTATION.GENERATION_MISMATCH;
  return ATTESTATION.ATTESTED;
}

/** Caller is responsible for running this INSIDE the rebuild transaction. */
export function bumpGraphGeneration(db, { unresolvedCount = null, trustUnresolvedCount = null } = {}) {
  ensurePublicationTables(db);
  const current = readGraphGeneration(db) ?? 0;
  const next = current + 1;
  db.run(
    `INSERT INTO graph_generation (id, generation, committed_at, unresolved_count, trust_unresolved_count)
     VALUES (1, $g, $t, $u, $tu)
     ON CONFLICT(id) DO UPDATE SET generation = $g, committed_at = $t,
       unresolved_count = $u, trust_unresolved_count = $tu`,
    {
      g: next,
      t: new Date().toISOString(),
      u: Number.isInteger(unresolvedCount) ? unresolvedCount : null,
      tu: Number.isInteger(trustUnresolvedCount) ? trustUnresolvedCount : null,
    },
  );
  return next;
}

/**
 * The generation AND the aggregates it published, from one read.
 *
 * ⛔ THREE STATES IN ONE RETURN, AND NONE OF THEM IS ZERO BY DEFAULT.
 *   null                              no table — a legacy graph
 *   { generation, counts: null }      attested, but published before the aggregates existed
 *   { generation, counts: {...} }     attested with counts committed alongside the rows
 *
 * A NULL aggregate is not zero. A graph published between the first generation commit and the
 * column addition carries a real generation and no counts, and reporting that as "0 unresolved"
 * would be a fabricated measurement — the exact shape of every fail-open default this unit removes.
 */
export function readGraphPublication(db) {
  // ⛔ THE GENERATION IS READ WITHOUT THE NEW COLUMNS, AND THIS IS NOT A STYLE CHOICE.
  // My first version selected all three in one statement. On any graph published BEFORE the
  // aggregate columns existed that statement throws "no such column", the catch returns null, and
  // an ATTESTED graph is reported as LEGACY — authority withdrawn from a graph that had earned it,
  // by a schema addition. Measured on this repository's live graph: generation 6, attested, and my
  // change made it read legacy_unattested until its next rebuild.
  //
  // Every test I had written created a fresh database with the new columns, so all of them passed.
  // The only thing that caught it was running against the real graph, which is the substrate the
  // tests cannot stand in for.
  let row;
  try {
    row = db.all('SELECT generation FROM graph_generation WHERE id = 1')[0];
  } catch {
    return null;   // no table = legacy
  }
  if (!row) return { generation: 0, counts: null };

  // The aggregates are a SEPARATE, OPTIONAL read. A graph published between the generation commit
  // and the column addition is attested with no counts — the third state, and it must survive.
  let agg = null;
  try {
    agg = db.all(
      'SELECT unresolved_count, trust_unresolved_count FROM graph_generation WHERE id = 1',
    )[0] ?? null;
  } catch {
    agg = null;   // columns not present on this graph yet
  }
  const hasCounts = agg !== null
    && Number.isInteger(agg.unresolved_count)
    && Number.isInteger(agg.trust_unresolved_count);
  return {
    generation: row.generation,
    counts: hasCounts
      ? { unresolved: agg.unresolved_count, trustUnresolved: agg.trust_unresolved_count }
      : null,
  };
}
