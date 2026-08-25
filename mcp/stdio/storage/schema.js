export const SCHEMA_VERSION = 4;

// EDGE_PROVENANCE_TYPES and NODE_TYPES now live in the single taxonomy registry
// (storage/taxonomy.js). Re-exported here for backward compatibility — the
// taxonomy file is the authority (cohesion review R2).
export { EDGE_PROVENANCE_TYPES, NODE_TYPES } from './taxonomy.js';

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      label         TEXT NOT NULL DEFAULT '',
      file_path     TEXT NOT NULL DEFAULT '',
      start_line    INTEGER NOT NULL DEFAULT 0,
      end_line      INTEGER NOT NULL DEFAULT 0,
      language      TEXT NOT NULL DEFAULT '',
      confidence    REAL NOT NULL DEFAULT 1.0,
      structural_fp TEXT NOT NULL DEFAULT '',
      dependency_fp TEXT NOT NULL DEFAULT '',
      extra         TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS edges (
      from_id       TEXT NOT NULL,
      to_id         TEXT NOT NULL,
      relation      TEXT NOT NULL,
      source_file   TEXT NOT NULL DEFAULT '',
      source_line   INTEGER NOT NULL DEFAULT 0,
      confidence    REAL NOT NULL DEFAULT 1.0,
      provenance    TEXT NOT NULL DEFAULT 'EXTRACTED',
      extractor     TEXT NOT NULL DEFAULT 'generic',
      FOREIGN KEY (from_id) REFERENCES nodes(id),
      FOREIGN KEY (to_id) REFERENCES nodes(id)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_label     ON nodes(label);
    CREATE INDEX IF NOT EXISTS idx_nodes_qname     ON nodes(json_extract(extra, '$.qname'));
    CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
    CREATE INDEX IF NOT EXISTS idx_nodes_type      ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_edges_from      ON edges(from_id, relation);
    CREATE INDEX IF NOT EXISTS idx_edges_to        ON edges(to_id, relation);
    CREATE INDEX IF NOT EXISTS idx_edges_relation  ON edges(relation);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(from_id, to_id, relation);
    CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file);
  `);

  const edgeCols = db.prepare("PRAGMA table_info(edges)").all().map((r) => r.name);
  if (!edgeCols.includes('provenance')) {
    db.exec(`ALTER TABLE edges ADD COLUMN provenance TEXT NOT NULL DEFAULT 'EXTRACTED';`);
  }

  ensureCodeIntelRecordsTable(db);
  ensureCodeIntelCollectionsTable(db);
  ensureNodesFtsTable(db);
}

// Plan #17 A: FTS5 full-text index over node labels. Mirrors codegraph's
// db/queries.ts FTS5 prefix-match approach. Kept in sync with `nodes` via
// triggers so every UPSERT/DELETE on nodes updates the FTS index too.
//
// Contentless table (`content=''` is omitted intentionally — we use a
// regular FTS5 table because content-rowid linkage to a non-INTEGER
// PRIMARY KEY would need extra plumbing). The `id` column is unindexed
// and round-trips the node primary key for join-back to `nodes`.
const NODES_FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id UNINDEXED,
    label,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS nodes_fts_after_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts (id, label) VALUES (new.id, new.label);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_after_delete AFTER DELETE ON nodes BEGIN
    DELETE FROM nodes_fts WHERE id = old.id;
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_after_update AFTER UPDATE OF label ON nodes BEGIN
    DELETE FROM nodes_fts WHERE id = old.id;
    INSERT INTO nodes_fts (id, label) VALUES (new.id, new.label);
  END;
`;

export function ensureNodesFtsTable(db) {
  db.exec(NODES_FTS_SQL);
  // Review-fix #4: only run the backfill when nodes_fts is empty (first
  // creation OR full rebuild). The previous unconditional INSERT … SELECT
  // WHERE id NOT IN (...) ran on every db open and scaled O(N*M) on the
  // (nodes, nodes_fts) join, even though after first creation the triggers
  // keep nodes_fts in sync. The first-creation guard makes db open O(1)
  // for the common case.
  //
  // ensureNodesFtsTable is called both from createSchema() (raw better-
  // sqlite3 db, before wrapDb attaches shortcuts) and from tests that
  // pass the wrapped db (which exposes .get(sql) but not .prepare()).
  // Pick the right call shape for whichever surface we got.
  const COUNT_SQL = 'SELECT count(*) AS c FROM nodes_fts';
  const ftsCount = typeof db.prepare === 'function'
    ? db.prepare(COUNT_SQL).get().c
    : db.get(COUNT_SQL).c;
  if (ftsCount === 0) {
    db.exec(`
      INSERT INTO nodes_fts (id, label)
      SELECT id, label FROM nodes;
    `);
  }
}

const CODE_INTEL_RECORDS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS code_intel_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    language TEXT NOT NULL,
    symbol_id TEXT,
    qname TEXT,
    file TEXT,
    range_start_line INTEGER,
    range_end_line INTEGER,
    confidence TEXT,
    provenance TEXT,
    result_state TEXT,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS code_intel_records_collection_idx ON code_intel_records(collection_id);
  CREATE INDEX IF NOT EXISTS code_intel_records_symbol_idx ON code_intel_records(symbol_id);
`;

// ★ THE EVIDENCE REACHED THE DB AND DIED ONE LAYER BELOW THE NUMBER PEOPLE READ.
//
// 3a4c5a5 made the collector compute evidence.cause on every not-found, and that
// half works — the raw blob carries {"cause":"definition_only","degraded":true}.
// But `cause` and `degraded` were persisted ONLY inside that JSON, with no columns
// and nothing aggregating them, so graph_health still printed a bare
// refsNotFoundSymbols=833 with no split. the field test got the answer by parsing 833
// raw blobs by hand.
//
// His diagnosis is exact and it is the original defect moved down a level: the
// qualifier now EXISTS and the summary statistic still cannot see it. Capturing
// evidence is not the same as aggregating it.
const CODE_INTEL_RECORDS_EXTRA_COLS = [
  // Why an absence is an absence. NULL on 'found' records and on
  // position_unresolved — the field discriminates rather than firing everywhere
  // (verified: 400/400 found and 21/21 unresolved carry no cause).
  { name: 'cause', ddl: 'ALTER TABLE code_intel_records ADD COLUMN cause TEXT' },
  { name: 'degraded', ddl: 'ALTER TABLE code_intel_records ADD COLUMN degraded INTEGER' },
];

export function ensureCodeIntelRecordsTable(db) {
  // Accepts both raw better-sqlite3 Database and the wrapped db from db.js (both expose .exec).
  db.exec(CODE_INTEL_RECORDS_TABLE_SQL);
  const cols = db.prepare
    ? db.prepare('PRAGMA table_info(code_intel_records)').all().map((r) => r.name)
    : db.all('PRAGMA table_info(code_intel_records)').map((r) => r.name);
  for (const { name, ddl } of CODE_INTEL_RECORDS_EXTRA_COLS) {
    if (!cols.includes(name)) db.exec(ddl);
  }
}

const CODE_INTEL_COLLECTIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS code_intel_collections (
    collection_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_version TEXT NOT NULL,
    project_root TEXT NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL,
    freshness_basis TEXT,
    freshness_value TEXT,
    compile_db_hash TEXT,
    indexed_commit TEXT,
    operations_json TEXT,
    collected_at TEXT NOT NULL,
    errors_json TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS code_intel_collections_provider_idx ON code_intel_collections(provider);
  CREATE INDEX IF NOT EXISTS code_intel_collections_collected_idx ON code_intel_collections(collected_at);
`;

// Code-Intel v2 FIX A/B — per-collection readiness + reference-outcome
// columns. Added via idempotent ALTER so existing graph.sqlite files migrate
// in place (older rows get NULL → treated as "unknown readiness" downstream).
const CODE_INTEL_COLLECTIONS_EXTRA_COLS = [
  { name: 'mode', ddl: "ALTER TABLE code_intel_collections ADD COLUMN mode TEXT" },
  { name: 'index_ready', ddl: "ALTER TABLE code_intel_collections ADD COLUMN index_ready INTEGER" },
  { name: 'index_wait_ms', ddl: "ALTER TABLE code_intel_collections ADD COLUMN index_wait_ms INTEGER" },
  { name: 'refs_found', ddl: "ALTER TABLE code_intel_collections ADD COLUMN refs_found INTEGER" },
  { name: 'refs_not_found', ddl: "ALTER TABLE code_intel_collections ADD COLUMN refs_not_found INTEGER" },
  // ★ NEVER SUM DEGRADED WITH ABSENT. refs_not_found is the TOTAL and must not be
  // read as "symbols with no callers" — measured on echoes 2026-08-02, 833 of 833
  // not-found results were definition_only and ZERO were clean absences.
  { name: 'refs_degraded', ddl: "ALTER TABLE code_intel_collections ADD COLUMN refs_degraded INTEGER" },
  { name: 'refs_clean_not_found', ddl: "ALTER TABLE code_intel_collections ADD COLUMN refs_clean_not_found INTEGER" },
  // ⛔ A SCOPED COLLECTION WAS INDISTINGUISHABLE FROM A COMPLETE ONE ONCE STORED.
  //
  // Found by running the first collection this repo has ever had. It covered THREE files, and:
  //
  //   the response said        filesProcessed 3 · filesTotal 3      -> reads as 100%
  //   the stored row said      status ok, mode null                 -> no scope at all
  //   graph_health then said   nextActions: []                      -> its ONLY code-intel
  //                                                                    warning went silent
  //
  // `filesTotal` was the SCOPE's denominator, not the repo's. 3 of 3 is complete; 3 of 484 is
  // 0.6%. Same defect as every other denominator this repo has shipped — a ratio computed over
  // the population the code happened to look at rather than the population the claim is about.
  //
  // ⚠ AND NOTHING PERSISTED EITHER NUMBER, so no consumer could have told the difference even if
  // it wanted to. The health check concluded "a collection exists, therefore nothing to warn
  // about", which is true about the row and false about the repo.
  //
  // ⇒ Three numbers, so a reader can compute the ratio the claim is actually about:
  //   files_processed  what this run actually collected
  //   files_in_scope   what this run SET OUT to collect — equal to processed on a clean run
  //   files_eligible   how many files in the repo the provider COULD collect. Only this one
  //                    makes "coverage" mean anything, and it was never recorded.
  { name: 'files_processed', ddl: "ALTER TABLE code_intel_collections ADD COLUMN files_processed INTEGER" },
  { name: 'files_in_scope', ddl: "ALTER TABLE code_intel_collections ADD COLUMN files_in_scope INTEGER" },
  { name: 'files_eligible', ddl: "ALTER TABLE code_intel_collections ADD COLUMN files_eligible INTEGER" },
];

export function ensureCodeIntelCollectionsTable(db) {
  db.exec(CODE_INTEL_COLLECTIONS_TABLE_SQL);
  const cols = db.prepare
    ? db.prepare('PRAGMA table_info(code_intel_collections)').all().map((r) => r.name)
    : db.all('PRAGMA table_info(code_intel_collections)').map((r) => r.name);
  for (const { name, ddl } of CODE_INTEL_COLLECTIONS_EXTRA_COLS) {
    if (!cols.includes(name)) db.exec(ddl);
  }
}
