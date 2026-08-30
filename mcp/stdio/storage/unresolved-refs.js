// THE UNRESOLVED-REF PROJECTION — one owner for the shape, so producer and table cannot drift.
//
// Every key an extractor emits is either a typed column here, explicitly derived, or REJECTED by
// name. It is never silently discarded: a field that vanishes between the producer and the table is
// a seam dying quietly, and this repository has lost seams that way before.

import { ensurePublicationTables } from './publication-schema.js';

// ⛔ THE COLUMN SET IS THE RESOLVER CONTRACT, NOT THE CURRENT DATA. `from_target`, `to_id` and
// `language` appear in ZERO of the 35,906 rows this repository emits today and are still live
// resolver seams — population zero is not contract absence.
export const UNRESOLVED_REF_COLUMNS = Object.freeze([
  'from_id', 'from_target', 'to_id', 'target', 'relation', 'source_file', 'source_line',
  'confidence', 'provenance', 'extractor', 'language', 'refused_reason', 'import_map_json',
]);

// Producer keys that are deliberately NOT persisted, with the reason. Anything emitted that is
// neither a column nor listed here makes the census throw rather than pass quietly.
export const DERIVED_OR_DROPPED = Object.freeze({
  from_label: 'presentation only — derivable by joining nodes on from_id; symbolic sources display '
    + 'from from_target. Audited: zero reads in resolver.js, unresolved-categorization.js and '
    + 'unresolved-metrics.js, with positive controls proving the search finds fields that ARE read.',
});

// Producer key -> column, where the names differ. camelCase on the wire, snake_case in SQL.
const RENAMED = Object.freeze({ refusedReason: 'refused_reason', importMap: 'import_map_json' });

/**
 * Project one producer ref onto the table's columns.
 *
 * ⛔ TYPED ABSENCE IS PRESERVED. `provenance` is MISSING (not null) on 2 of the 35,906 live rows.
 * Writing a default there would manufacture a confidence the producer never claimed, which is the
 * same shape as every fail-open default this repository has removed.
 */
export function projectRef(ref) {
  const unknown = Object.keys(ref).filter(
    (k) => !UNRESOLVED_REF_COLUMNS.includes(k) && !(k in RENAMED) && !(k in DERIVED_OR_DROPPED),
  );
  if (unknown.length > 0) {
    // Loud on purpose. A new producer field must be a decision, not an accident.
    throw new Error(
      `unresolved ref carries unaccounted field(s): ${unknown.join(', ')}. `
      + 'Add a column, or record the reason in DERIVED_OR_DROPPED — do not let it vanish.',
    );
  }
  const importMap = ref.importMap;
  return {
    from_id: ref.from_id ?? null,
    from_target: ref.from_target ?? null,
    to_id: ref.to_id ?? null,
    target: ref.target ?? null,
    relation: ref.relation,
    source_file: ref.source_file,
    source_line: Number.isInteger(ref.source_line) ? ref.source_line : null,
    confidence: typeof ref.confidence === 'number' ? ref.confidence : null,
    // `in` rather than `??`: a missing key and an explicit null are the same absence here, but a
    // present-and-null value must not be turned into a string.
    provenance: 'provenance' in ref ? (ref.provenance ?? null) : null,
    extractor: ref.extractor ?? null,
    language: ref.language ?? null,
    refused_reason: ref.refusedReason ?? null,
    import_map_json: importMap == null ? null : JSON.stringify(importMap),
  };
}

/** The inverse: a table row back into the shape `resolveRefs` consumes on carry-forward. */
export function hydrateRef(row) {
  const ref = {
    relation: row.relation,
    source_file: row.source_file,
  };
  if (row.from_id != null) ref.from_id = row.from_id;
  if (row.from_target != null) ref.from_target = row.from_target;
  if (row.to_id != null) ref.to_id = row.to_id;
  if (row.target != null) ref.target = row.target;
  if (row.source_line != null) ref.source_line = row.source_line;
  if (row.confidence != null) ref.confidence = row.confidence;
  if (row.provenance != null) ref.provenance = row.provenance;
  if (row.extractor != null) ref.extractor = row.extractor;
  if (row.language != null) ref.language = row.language;
  if (row.refused_reason != null) ref.refusedReason = row.refused_reason;
  if (row.import_map_json != null) ref.importMap = JSON.parse(row.import_map_json);
  return ref;
}

/**
 * Replace the whole unresolved population. Caller MUST run this inside the rebuild transaction so
 * it commits or rolls back with the graph it describes.
 *
 * ⛔ DELETE-THEN-INSERT, NEVER UPSERT. There is no unique key and there must not be one: measured on
 * the frozen carrier, 2,547 identity keys repeat with multiplicity up to 15, so 35,906 rows hold
 * only 32,562 distinct identities. Any upsert or unique constraint would drop 3,344 rows and report
 * success — deduplication as an accidental migration.
 */
export function replaceUnresolvedRefs(db, refs) {
  ensurePublicationTables(db);
  db.run('DELETE FROM unresolved_refs');
  const cols = UNRESOLVED_REF_COLUMNS.join(', ');
  const binds = UNRESOLVED_REF_COLUMNS.map((c) => `$${c}`).join(', ');
  for (const ref of refs) {
    db.run(`INSERT INTO unresolved_refs (${cols}) VALUES (${binds})`, projectRef(ref));
  }
  return refs.length;
}

export function readUnresolvedRefs(db) {
  try {
    return db.all(`SELECT ${UNRESOLVED_REF_COLUMNS.join(', ')} FROM unresolved_refs ORDER BY id`)
      .map(hydrateRef);
  } catch {
    // Table absent = a legacy graph. NULL-ish, not empty: an empty array here would read as "this
    // graph has no unresolved refs", which is a claim about the repository rather than about us.
    return null;
  }
}

export function replaceStructuralFingerprints(db, fingerprints) {
  ensurePublicationTables(db);
  db.run('DELETE FROM structural_fingerprints');
  for (const [filePath, fingerprint] of fingerprints) {
    db.run(
      'INSERT INTO structural_fingerprints (file_path, fingerprint) VALUES ($f, $p)',
      { f: filePath, p: fingerprint },
    );
  }
  return fingerprints instanceof Map ? fingerprints.size : fingerprints.length;
}

export function readStructuralFingerprints(db) {
  try {
    const rows = db.all('SELECT file_path, fingerprint FROM structural_fingerprints');
    return new Map(rows.map((r) => [r.file_path, r.fingerprint]));
  } catch {
    return null;   // legacy graph — the cosmetic fast path must DISABLE, not guess
  }
}
