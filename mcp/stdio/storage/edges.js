const INSERT_SQL = `
  INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, extractor)
  VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $extractor)
`;

export function upsertEdge(db, edge) {
  db.run(INSERT_SQL, {
    from_id: edge.from_id,
    to_id: edge.to_id,
    relation: edge.relation,
    source_file: edge.source_file ?? '',
    source_line: edge.source_line ?? 0,
    confidence: edge.confidence ?? 1.0,
    extractor: edge.extractor ?? 'generic',
  });
}

export function listEdges(db, filter = {}) {
  const clauses = [];
  const params = {};
  if (filter.from_id) { clauses.push('from_id = $from_id'); params.from_id = filter.from_id; }
  if (filter.to_id) { clauses.push('to_id = $to_id'); params.to_id = filter.to_id; }
  if (filter.relation) { clauses.push('relation = $relation'); params.relation = filter.relation; }
  if (filter.source_file) { clauses.push('source_file = $source_file'); params.source_file = filter.source_file; }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.all(`SELECT * FROM edges ${where}`, params);
}

export function deleteEdgesFrom(db, fromId, relation) {
  if (relation) {
    db.run('DELETE FROM edges WHERE from_id = $from_id AND relation = $relation',
      { from_id: fromId, relation });
  } else {
    db.run('DELETE FROM edges WHERE from_id = $from_id', { from_id: fromId });
  }
}

export function deleteEdgesTo(db, toId, relation) {
  if (relation) {
    db.run('DELETE FROM edges WHERE to_id = $to_id AND relation = $relation',
      { to_id: toId, relation });
  } else {
    db.run('DELETE FROM edges WHERE to_id = $to_id', { to_id: toId });
  }
}

export function deleteEdgesByFile(db, sourceFile) {
  db.run('DELETE FROM edges WHERE source_file = $source_file', { source_file: sourceFile });
}

export function countEdges(db) {
  return db.get('SELECT count(*) AS count FROM edges').count;
}
