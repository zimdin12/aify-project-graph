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

export function countNodes(db) {
  return db.get('SELECT count(*) AS count FROM nodes').count;
}
