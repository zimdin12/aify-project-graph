// WHERE DIGESTS LIVE — one row per indexed commit, so a delta has a "before" to read.
//
// Separate from `publication-schema.js` because that file already owns three tables and their
// attestation rules; this is its own responsibility and its own lifetime. Registered THERE, though,
// so `ensurePublicationTables` creates it like every other table. A table created lazily by its own
// writer exists only on machines that happened to write one, and a reader everywhere else gets
// "no such table" instead of "no digest yet" — different facts, and only one is recoverable.
//
// ⛔ THE ROWS ARE THE ONLY HISTORY THIS DATABASE KEEPS. Every other structural table is
// replace-on-write: `structural_fingerprints` is keyed by file_path and re-extracting REPLACES the
// row, `graph_generation` is CHECK (id = 1). That is why "how did the shape change" was unanswerable
// before this existed.
import { buildDigest } from './structural-digest.mjs';

// Keyed by commit: a commit names one graph state, so re-indexing it is an idempotent overwrite
// rather than a second history entry. `digest_json` is stored verbatim because a delta compares
// digests as BYTES — mutation testing proved that comparing them structurally hides a key-order
// regression that would make every comparison report churn that never happened.
export const STRUCTURAL_DIGEST_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS structural_digest (
    commit_sha        TEXT PRIMARY KEY,
    created_at        TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    digest_version    INTEGER NOT NULL,
    digest_json       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS structural_digest_created_idx ON structural_digest(created_at DESC);
`;

/**
 * Persist one digest. Idempotent per commit.
 *
 * @param {object} db      an open database (raw better-sqlite3 or the db.js wrapper)
 * @param {object} digest  from `buildDigest` — carries its own commit and extractorVersion
 * @param {object} [opts]
 * @param {string} [opts.createdAt]  injectable clock, so ordering is testable without sleeping
 */
export function writeStructuralDigest(db, digest, { createdAt = new Date().toISOString() } = {}) {
  if (!digest?.commit) throw new TypeError('writeStructuralDigest: digest has no commit — a digest nobody can place is not a reading');
  const sql = `INSERT INTO structural_digest
      (commit_sha, created_at, extractor_version, digest_version, digest_json)
    VALUES ($c, $t, $e, $v, $j)
    ON CONFLICT(commit_sha) DO UPDATE SET
      created_at = excluded.created_at,
      extractor_version = excluded.extractor_version,
      digest_version = excluded.digest_version,
      digest_json = excluded.digest_json`;
  const params = {
    c: digest.commit,
    t: createdAt,
    e: digest.extractorVersion,
    v: digest.digestVersion,
    j: JSON.stringify(digest),
  };
  if (typeof db.run === 'function') db.run(sql, params);
  else db.prepare(sql).run(params);
  return digest.commit;
}

function one(db, sql, params) {
  if (typeof db.get === 'function') return db.get(sql, params);
  return db.prepare(sql).get(params);
}

function many(db, sql) {
  if (typeof db.all === 'function') return db.all(sql, {});
  return db.prepare(sql).all();
}

/**
 * The digest for one commit, or null when none was stored.
 *
 * ⛔ null, NEVER AN EMPTY DIGEST. An empty digest compares cleanly against anything and would report
 * "no structural change" for a commit that was never measured — the fail-open direction, because it
 * reassures. A caller that cannot find a before must say so, not invent one.
 */
export function readStructuralDigest(db, commitSha) {
  let row;
  try {
    row = one(db, 'SELECT digest_json FROM structural_digest WHERE commit_sha = $c', { c: commitSha });
  } catch {
    // A graph built before this table existed. Absent is the honest answer; a throw here would make
    // every delta on a legacy graph look like a defect rather than a missing before.
    return null;
  }
  if (!row?.digest_json) return null;
  try { return JSON.parse(row.digest_json); } catch { return null; }
}

/** Stored commits, newest first — so "the previous digest" is simply the next row. */
export function listDigestCommits(db) {
  try {
    return many(db, 'SELECT commit_sha FROM structural_digest ORDER BY created_at DESC, commit_sha DESC')
      .map((r) => r.commit_sha);
  } catch {
    return [];
  }
}

/**
 * Build a digest from the graph rows the rebuild has just written, and store it.
 *
 * Called INSIDE the rebuild transaction, so the digest is published by the same COMMIT as the graph
 * it describes. Written outside it, a rollback would leave a digest describing a graph that was
 * never published — the "three separate promotion events" failure this module's neighbours were
 * rewritten to remove.
 *
 * ⚠ LAYERS ARE OPTIONAL AND DEGRADE HONESTLY. They come from the intelligence overlay, which most
 * repositories do not build. A symbol with no layer gets null, and `computeDelta` treats an unknown
 * layer as NOT a crossing — otherwise every unlabelled symbol would look like an architecture
 * violation the moment anyone called it.
 */
export function captureStructuralDigest(db, { commit, extractorVersion, layerOf = () => null, createdAt } = {}) {
  const nodeRows = many(db,
    `SELECT id, label, file_path, COALESCE(json_extract(extra, '$.qname'), label) AS qname
     FROM nodes
     WHERE type IN ('Function','Method','Class','Interface','Type','Route','Entrypoint')`);

  // Keyed by node id: edges reference ids, and two symbols can share a qname. Resolving through the
  // id keeps the fan-in on the symbol the edge actually pointed at.
  const byId = new Map();
  const symbols = [];
  for (const r of nodeRows) {
    const qname = r.qname || r.label;
    if (!qname || byId.has(r.id)) continue;
    byId.set(r.id, qname);
    symbols.push({ qname, file: r.file_path, layer: layerOf(r.file_path) });
  }

  // Only edges whose BOTH ends are symbols in this digest. A dangling edge is refused by buildDigest
  // rather than counted, because counting it inflates fan-in for a symbol nobody can look up and the
  // inflation then reads as growth on the next delta.
  const edges = [];
  const seenQname = new Set(symbols.map((s) => s.qname));
  for (const e of many(db, 'SELECT from_id, to_id FROM edges')) {
    const from = byId.get(e.from_id);
    const to = byId.get(e.to_id);
    if (!from || !to || !seenQname.has(from) || !seenQname.has(to)) continue;
    edges.push({ from, to });
  }

  // Duplicate qnames would make buildDigest's symbol table lossy, so collapse to the first occurrence
  // and let identity repair (M1a/M1b) be the thing that keeps qnames distinct.
  const unique = [];
  const seen = new Set();
  for (const s of symbols) {
    if (seen.has(s.qname)) continue;
    seen.add(s.qname);
    unique.push(s);
  }

  const digest = buildDigest({ commit, extractorVersion, symbols: unique, edges });
  writeStructuralDigest(db, digest, createdAt ? { createdAt } : undefined);
  return digest;
}
