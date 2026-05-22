const UPSERT_SQL = `
  INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
  VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $structural_fp, $dependency_fp, $extra)
  ON CONFLICT(id) DO UPDATE SET
    type = excluded.type,
    label = excluded.label,
    file_path = excluded.file_path,
    start_line = excluded.start_line,
    end_line = excluded.end_line,
    language = excluded.language,
    confidence = excluded.confidence,
    structural_fp = excluded.structural_fp,
    dependency_fp = excluded.dependency_fp,
    extra = excluded.extra
`;

export function upsertNode(db, node) {
  db.run(UPSERT_SQL, {
    id: node.id,
    type: node.type,
    label: node.label ?? '',
    file_path: node.file_path ?? '',
    start_line: node.start_line ?? 0,
    end_line: node.end_line ?? 0,
    language: node.language ?? '',
    confidence: node.confidence ?? 1.0,
    structural_fp: node.structural_fp ?? '',
    dependency_fp: node.dependency_fp ?? '',
    extra: JSON.stringify(node.extra ?? {}),
  });
}

export function getNode(db, id) {
  return db.get('SELECT * FROM nodes WHERE id = $id', { id });
}

export function deleteNode(db, id) {
  db.run('DELETE FROM edges WHERE from_id = $id OR to_id = $id', { id });
  db.run('DELETE FROM nodes WHERE id = $id', { id });
}

export function getNodesByFile(db, filePath) {
  return db.all('SELECT * FROM nodes WHERE file_path = $file_path', { file_path: filePath });
}

export function getNodesByType(db, type) {
  return db.all('SELECT * FROM nodes WHERE type = $type', { type });
}

export function findNodesByLabel(db, label, limit = 10) {
  return db.all('SELECT * FROM nodes WHERE label = $label LIMIT $limit', { label, limit });
}

// Plan #17 A: FTS5 full-text search over node labels. Replaces SQL LIKE
// for `/api/search` + brief discovery. Approach mirrors codegraph's
// db/queries.ts: escape FTS5 special chars, add trailing wildcard for
// prefix matching, fall back to LIKE on any failure.
//
// Returns nodes ranked by FTS5 bm25 (smaller fts_rank = more relevant).
export function searchNodesFts(db, query, limit = 20) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  // Escape FTS5 metacharacters by quoting each token, then add prefix
  // wildcard so partial matches work ("auth" matches "authenticate").
  // Whitespace-separated tokens behave as AND (FTS5 default).
  const tokens = trimmed.split(/\s+/u).filter(Boolean).slice(0, 8);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');

  try {
    return db.all(`
      SELECT n.*, fts.rank AS fts_rank
      FROM nodes_fts AS fts
      JOIN nodes AS n ON n.id = fts.id
      WHERE nodes_fts MATCH $q
      ORDER BY fts.rank
      LIMIT $limit
    `, { q: ftsQuery, limit });
  } catch {
    // FTS5 unavailable / query parse failed — fall back to LIKE so the
    // caller never sees a hard error on older SQLite builds.
    const like = `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    return db.all(
      "SELECT * FROM nodes WHERE label LIKE $q ESCAPE '\\' LIMIT $limit",
      { q: like, limit }
    );
  }
}

export function countNodes(db) {
  return db.get('SELECT count(*) AS count FROM nodes').count;
}
