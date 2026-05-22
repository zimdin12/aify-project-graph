export const SCHEMA_VERSION = 4;

export const EDGE_PROVENANCE_TYPES = [
  'EXTRACTED',
  'INFERRED',
  'AMBIGUOUS',
  'CODE_INTEL',
];

const NODE_TYPES = [
  'Repository', 'File', 'Module', 'Function', 'Method', 'Class',
  'Interface', 'Type', 'Variable', 'Symbol', 'Test',
  'Directory', 'Document', 'Config', 'Route', 'Entrypoint', 'Schema',
  'External',
];

export { NODE_TYPES };

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
  // Backfill on first creation for existing rows. Cheap idempotent op:
  // INSERT … SELECT only writes rows whose id isn't already in nodes_fts.
  db.exec(`
    INSERT INTO nodes_fts (id, label)
    SELECT id, label FROM nodes
    WHERE id NOT IN (SELECT id FROM nodes_fts);
  `);
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

export function ensureCodeIntelRecordsTable(db) {
  // Accepts both raw better-sqlite3 Database and the wrapped db from db.js (both expose .exec).
  db.exec(CODE_INTEL_RECORDS_TABLE_SQL);
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

export function ensureCodeIntelCollectionsTable(db) {
  db.exec(CODE_INTEL_COLLECTIONS_TABLE_SQL);
}
