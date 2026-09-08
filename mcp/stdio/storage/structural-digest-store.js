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
import { buildDigest, symbolKey } from './structural-digest.mjs';

// Keyed by commit — and ⛔ "A COMMIT NAMES ONE GRAPH STATE" IS FALSE HERE, which is why the
// commit-to-commit comparison is withdrawn. The indexer parses the working tree and carries
// unchanged rows forward, so the same sha can be re-indexed into a different graph and this key
// would overwrite the earlier one. The table is retained for the rows already written; nothing
// captures into it now, and storage/delta-between.js refuses to compare its contents. `digest_json` is stored verbatim because a delta compares
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
 * How many digests to keep.
 *
 * ⛔ MEASURED, NOT GUESSED. The first live digest on this repository held 3,220 symbols and 5,382
 * edges in 961 KB. One row per indexed commit at that size is roughly a gigabyte per thousand
 * commits, on a table written by every rebuild — unbounded growth is a defect with a delay on it,
 * and it was invisible until the real thing was measured rather than reviewed.
 *
 * ⚠ PRUNING IS ONLY SAFE BECAUSE A DIGEST IS DERIVED. Re-indexing that commit reproduces it byte for
 * byte — that is what determinism buys. This policy would be wrong for anything unrecomputable.
 *
 * Configuration, because the right depth varies by how often a repository is indexed.
 */
export const DIGEST_RETENTION = Number(process.env.APG_DIGEST_RETENTION ?? 50);

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

  // ⭐ THE NEWEST SURVIVE. Ordered exactly like listDigestCommits, so what the reader sees and what
  // the pruner keeps can never disagree. Dropping the newest would leave a history that cannot
  // answer "what changed since yesterday", which is the only question this table exists for.
  const prune = `DELETE FROM structural_digest WHERE commit_sha NOT IN (
      SELECT commit_sha FROM structural_digest
      ORDER BY created_at DESC, commit_sha DESC
      LIMIT $keep)`;
  if (typeof db.run === 'function') db.run(prune, { keep: DIGEST_RETENTION });
  else db.prepare(prune).run({ keep: DIGEST_RETENTION });

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
  // ⛔ IDENTITY IS THE NAME AND THE FILE, NEVER THE NAME ALONE. Resolving through the node id to a
  // bare qname merged every symbol that shares a name — an overload, a declaration and its
  // definition in another file, the same method in two modules — into ONE entry carrying whichever
  // file arrived first, and then credited that entry with edges aimed at the others.
  const byId = new Map();
  const symbols = [];
  const known = new Set();
  for (const r of nodeRows) {
    const qname = r.qname || r.label;
    if (!qname) continue;
    const key = symbolKey(qname, r.file_path);
    // ⛔ AND THIS COMMENT USED TO ASSERT SOMETHING FALSE: that two rows sharing a name AND a file
    // ARE the same symbol. C++ overloads falsify it directly — `f(int)` and `f(double)` are distinct
    // symbols extracted as distinct nodes with one qname in one file, and this key merges them. A
    // reviewer transferred an edge between two real extracted overload IDs and the digest reported
    // NO movement; two edges to the two overloads produce ONE edge key while fan-in counts both.
    //
    // ⚠ AND THE OBVIOUS REPAIR IS NOT ENOUGH EITHER. This repository already splits overloads by
    // normalized parameter list (M1b), but neither that nor a site id establishes CROSS-EDIT
    // CONTINUITY: a rename or a move changes the key and reads as a removal plus an addition, which
    // describes movement of an address rather than of a symbol.
    //
    // ⇒ SO THE KEY IS LEFT AS IT IS AND THE CLAIM IS DROPPED. Ids that share a key are grouped, and
    // that grouping is NOT asserted to be identity. Nothing may compare two of these digests as
    // authoritative history — see storage/delta-between.js, where that comparison is refused.
    byId.set(r.id, key);
    if (known.has(key)) continue;
    known.add(key);
    symbols.push({ qname, file: r.file_path, layer: layerOf(r.file_path) });
  }

  // Only edges whose BOTH ends are symbols in this digest. A dangling edge is refused by buildDigest
  // rather than counted, because counting it inflates fan-in for a symbol nobody can look up and the
  // inflation then reads as growth on the next delta.
  // ⛔ AND THE RELATION IS PART OF THE EDGE. `SELECT from_id, to_id` dropped it, so a CALLS and a
  // REFERENCES between one pair became indistinguishable — they collapsed to a single key while
  // fan-in counted both, and the digest disagreed with itself about how many edges it held.
  const edges = [];
  for (const e of many(db, 'SELECT from_id, to_id, relation FROM edges')) {
    const from = byId.get(e.from_id);
    const to = byId.get(e.to_id);
    if (!from || !to || !known.has(from) || !known.has(to)) continue;
    edges.push({ from, to, relation: e.relation });
  }

  // ⛔ THE COLLAPSE-BY-QNAME PASS IS GONE, NOT RELOCATED. It existed because buildDigest's table was
  // keyed by qname and duplicates made it lossy; the table is now keyed by identity, so there is
  // nothing to collapse and the symbols that were being discarded are the ones the delta needs.
  const digest = buildDigest({ commit, extractorVersion, symbols, edges });
  writeStructuralDigest(db, digest, createdAt ? { createdAt } : undefined);
  return digest;
}
