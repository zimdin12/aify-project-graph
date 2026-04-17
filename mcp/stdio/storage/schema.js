export const SCHEMA_VERSION = 3;

const NODE_TYPES = [
  'Repository', 'File', 'Module', 'Function', 'Method', 'Class',
  'Interface', 'Type', 'Variable', 'Symbol', 'Test',
  'Directory', 'Document', 'Config', 'Route', 'Entrypoint', 'Schema',
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
}
