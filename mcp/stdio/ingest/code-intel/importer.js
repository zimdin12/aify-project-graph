import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { upsertNode } from '../../storage/nodes.js';
import { upsertEdge } from '../../storage/edges.js';
import { validateCodeIntelRecord } from './schema.js';
import { detectSchemaVersion, validateAny } from './schema.js';
import { ensureCodeIntelRecordsTable, ensureCodeIntelCollectionsTable } from '../../storage/schema.js';
import { dedupCollectionRecords } from '../../code-intel/dedup-records.js';

function hash(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

function qnameId(qname) {
  return `ci:symbol:${hash([qname])}`;
}

function fileId(file) {
  return `file:${hash([file])}`;
}

function externalId(qname) {
  return `external:${hash([qname])}`;
}

function diagnosticId(record) {
  return `ci:diagnostic:${hash([record.file, record.start_line, record.code, record.message])}`;
}

function upsertFileNode(db, file, { language = '', confidence = 1 } = {}) {
  const id = fileId(file);
  upsertNode(db, {
    id,
    type: 'File',
    label: basename(file),
    file_path: file,
    start_line: 1,
    end_line: 1,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: { qname: file, code_intel: true, parent_dir: dirname(file) === '.' ? '' : dirname(file) },
  });
  return id;
}

function upsertExternalNode(db, qname, { language = '', confidence = 0.6 } = {}) {
  const id = externalId(qname);
  upsertNode(db, {
    id,
    type: 'External',
    label: qname.split(/::|\.|#/u).filter(Boolean).at(-1) ?? qname,
    file_path: '',
    start_line: 0,
    end_line: 0,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: { qname, code_intel: true },
  });
  return id;
}

function upsertSymbol(db, record) {
  const id = record.id || qnameId(record.qname);
  upsertFileNode(db, record.file, { language: record.language, confidence: record.confidence });
  upsertNode(db, {
    id,
    type: record.node_type,
    label: record.name,
    file_path: record.file,
    start_line: record.start_line,
    end_line: record.end_line,
    language: record.language,
    confidence: record.confidence,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: record.qname,
      code_intel: true,
      code_intel_schema: record.schema_version,
      symbol_kind: record.symbol_kind,
      provenance: 'CODE_INTEL',
      raw: record.raw,
    },
  });
  upsertEdge(db, {
    from_id: fileId(record.file),
    to_id: id,
    relation: 'DEFINES',
    source_file: record.file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source || 'code-intel',
  });
  return id;
}

function upsertEndpointShell(db, endpoint, record) {
  if (endpoint.file) {
    upsertFileNode(db, endpoint.file, { language: record.language, confidence: record.confidence });
    const id = qnameId(endpoint.qname);
    const existing = db.get('SELECT id FROM nodes WHERE id = $id', { id });
    if (existing) return id;
    upsertNode(db, {
      id,
      type: 'Symbol',
      label: endpoint.name,
      file_path: endpoint.file,
      start_line: endpoint.line || 1,
      end_line: endpoint.line || 1,
      language: record.language,
      confidence: Math.min(record.confidence, 0.85),
      structural_fp: '',
      dependency_fp: '',
      extra: {
        qname: endpoint.qname,
        code_intel: true,
        inferred_shell: true,
      },
    });
    return id;
  }
  return upsertExternalNode(db, endpoint.qname, { language: record.language, confidence: Math.min(record.confidence, 0.7) });
}

function upsertEdgeLike(db, record) {
  const fromId = upsertEndpointShell(db, record.source, record);
  const toId = upsertEndpointShell(db, record.target, record);
  upsertEdge(db, {
    from_id: fromId,
    to_id: toId,
    relation: record.relation,
    source_file: record.file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

function upsertInclude(db, record) {
  const fromId = upsertFileNode(db, record.source_file, { language: record.language, confidence: record.confidence });
  const toId = upsertFileNode(db, record.target_file, { language: record.language, confidence: record.confidence });
  upsertEdge(db, {
    from_id: fromId,
    to_id: toId,
    relation: record.relation,
    source_file: record.source_file,
    source_line: record.start_line,
    confidence: record.confidence,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

function upsertDiagnostic(db, record) {
  upsertFileNode(db, record.file, { language: '', confidence: 1 });
  const id = diagnosticId(record);
  upsertNode(db, {
    id,
    type: 'Symbol',
    label: record.code ? `${record.severity}:${record.code}` : record.severity,
    file_path: record.file,
    start_line: record.start_line,
    end_line: record.end_line,
    language: '',
    confidence: 1,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: id,
      code_intel: true,
      diagnostic: true,
      severity: record.severity,
      code: record.code,
      message: record.message,
      raw: record.raw,
    },
  });
  upsertEdge(db, {
    from_id: fileId(record.file),
    to_id: id,
    relation: 'HAS_DIAGNOSTIC',
    source_file: record.file,
    source_line: record.start_line,
    confidence: 1,
    provenance: 'CODE_INTEL',
    extractor: record.source_name || 'code-intel',
  });
}

export function importCodeIntelRecords(db, inputRecords) {
  const records = inputRecords.map(validateCodeIntelRecord);
  const counts = {
    records: records.length,
    symbols: 0,
    edges: 0,
    includes: 0,
    diagnostics: 0,
  };

  const insert = db.transaction(() => {
    for (const record of records) {
      if (record.kind === 'symbol') {
        upsertSymbol(db, record);
        counts.symbols += 1;
      } else if (record.kind === 'reference' || record.kind === 'call') {
        upsertEdgeLike(db, record);
        counts.edges += 1;
      } else if (record.kind === 'include') {
        upsertInclude(db, record);
        counts.includes += 1;
      } else if (record.kind === 'diagnostic') {
        upsertDiagnostic(db, record);
        counts.diagnostics += 1;
      }
    }
  });
  insert();
  return counts;
}

// ---------------------------------------------------------------------------
// L2a — clangd v0.2 collection → real graph edges (provenance LSP_VERIFIED)
//
// The v0.2 collection envelope's references/definitions become CALLS edges on
// the same nodes/edges tables the static (tree-sitter) graph uses, so
// graph_callers / graph_impact / graph_neighbors can see clangd ground truth.
// LSP_VERIFIED is free-form TEXT (the edges.provenance column has no CHECK);
// it is deliberately NEVER equal to EXTRACTED / INFERRED so render layers can
// rank clangd above heuristics.
// ---------------------------------------------------------------------------

const LSP_PROVENANCE = 'LSP_VERIFIED';

// C1 fix — promote-then-drop data-loss guard.
//
// Before: promoting a pre-existing tree-sitter EXTRACTED / heuristic INFERRED
// CALLS edge to LSP_VERIFIED mutated the row IN PLACE, then the next collect ran
// a blanket `DELETE FROM edges WHERE provenance='LSP_VERIFIED'` that wiped that
// row — destroying the original heuristic edge forever (tree-sitter edges are
// only created at graph_index, never at collect). graph_callers then said
// "NO CALLERS" for a symbol that genuinely has callers.
//
// Strategy (b) — stash-and-restore (no schema migration; minimal blast radius):
//   - When promoting a PRE-EXISTING heuristic edge, stash its original
//     provenance / extractor / confidence in the extractor column as a
//     `|was:<provenance>:<extractor>:<confidence>` suffix. Edges the synthesizer
//     created from scratch carry a clean `cpp-clangd#<hash>` extractor (no
//     suffix).
//   - On invalidation, RESTORE any promoted edge to its stashed original
//     instead of deleting it, and only DELETE edges the synthesizer itself
//     created this/prior runs (clean `cpp-clangd#%` extractor, no `|was:`).
//   A promoted-from-tree-sitter edge is never deleted — its heuristic identity
//   survives every re-collect.
export const STASH_SEP = '|was:';

function encodeStash(lspExtractor, original) {
  // original: { provenance, extractor, confidence }. Encode origin so the
  // blanket invalidation can restore the heuristic edge instead of dropping it.
  const prov = String(original.provenance ?? 'EXTRACTED');
  const ext = String(original.extractor ?? 'generic');
  const conf = original.confidence ?? 1.0;
  // Strip any stray separator from the components so decode is unambiguous.
  const safe = (s) => String(s).split(STASH_SEP).join('|was_');
  return `${lspExtractor}${STASH_SEP}${safe(prov)}::${safe(ext)}::${conf}`;
}

export function decodeStash(extractor) {
  if (typeof extractor !== 'string') return null;
  const idx = extractor.indexOf(STASH_SEP);
  if (idx === -1) return null;
  const payload = extractor.slice(idx + STASH_SEP.length);
  const parts = payload.split('::');
  if (parts.length < 3) return null;
  const confidence = Number(parts[parts.length - 1]);
  const extractorOrig = parts.slice(1, parts.length - 1).join('::');
  return {
    provenance: parts[0],
    extractor: extractorOrig,
    confidence: Number.isFinite(confidence) ? confidence : 1.0,
  };
}

// Node types that can act as a defined symbol or an enclosing caller scope.
// No 'Struct' — cpp.js maps struct_specifier → Class, so no extractor ever
// emits a Struct node (review R2 phantom-Struct drop).
const ENCLOSING_TYPES = new Set([
  'Function', 'Method', 'Class', 'Symbol', 'Interface', 'Type', 'Variable',
]);

function lspSymbolNodeId(symbolId) {
  return `ci:lsp:${hash([symbolId])}`;
}

function confidenceToScore(confidence) {
  if (confidence === 'high') return 0.95;
  if (confidence === 'medium') return 0.8;
  return 0.6;
}

// LSP edges are ground truth: insert, and on a (from,to,relation) collision
// with a weaker edge (tree-sitter EXTRACTED / heuristic INFERRED) promote it to
// LSP_VERIFIED. Never downgrades CODE_INTEL (v0.1 path) edges. The promotion
// stashes the original provenance/extractor/confidence in `extractor`
// (`...|was:...`) so invalidation can RESTORE the heuristic edge (C1) rather
// than deleting a row that only ever existed as a tree-sitter edge.
const LSP_EDGE_OVERRIDE_SQL = `
  UPDATE edges
  SET source_file = $source_file,
      source_line = $source_line,
      confidence = $confidence,
      provenance = $provenance,
      extractor = $extractor
  WHERE from_id = $from_id
    AND to_id = $to_id
    AND relation = $relation
    AND provenance != 'CODE_INTEL'
`;

function upsertLspEdge(db, edge) {
  const params = {
    from_id: edge.from_id,
    to_id: edge.to_id,
    relation: edge.relation,
    source_file: edge.source_file ?? '',
    source_line: edge.source_line ?? 0,
    confidence: edge.confidence ?? 1.0,
    provenance: LSP_PROVENANCE,
    extractor: edge.extractor ?? 'cpp-clangd',
  };
  upsertEdge(db, params);
  // upsertEdge uses INSERT OR IGNORE and only self-overrides for CODE_INTEL,
  // so a pre-existing tree-sitter/heuristic edge would shadow the LSP one.
  // Re-read; if the landed edge isn't ours, promote it — but FIRST stash the
  // heuristic origin so invalidation can restore it (C1 data-loss fix).
  const landed = db.get(
    `SELECT provenance, extractor, confidence FROM edges WHERE from_id = $from_id AND to_id = $to_id AND relation = $relation`,
    { from_id: params.from_id, to_id: params.to_id, relation: params.relation },
  );
  if (landed && landed.provenance !== LSP_PROVENANCE) {
    // CODE_INTEL is excluded by the WHERE clause (never downgraded). For a
    // tree-sitter/heuristic edge, carry the origin in the extractor so a later
    // blanket invalidation restores it instead of dropping the row.
    const existingStash = decodeStash(landed.extractor);
    // If the row is ALREADY a stash from a prior promotion (shouldn't happen —
    // that means provenance was LSP_VERIFIED — but be defensive), keep the
    // earliest heuristic origin rather than stashing an LSP layer.
    const origin = existingStash || {
      provenance: landed.provenance,
      extractor: landed.extractor,
      confidence: landed.confidence,
    };
    db.run(LSP_EDGE_OVERRIDE_SQL, {
      ...params,
      extractor: encodeStash(params.extractor, origin),
    });
  }
}

// Resolve (or create) the graph node for a defined symbol from a v0.2
// symbol/definition record. Prefers an existing tree-sitter node enclosing the
// definition line (innermost wins); falls back to a CODE_INTEL-style Symbol
// node keyed by symbolId so reference edges always have a target.
function resolveDefinedSymbolNode(db, record, stats) {
  const file = record.file;
  const defLine = record.range?.start?.line ?? null;
  if (file && defLine != null) {
    const placeholders = [...ENCLOSING_TYPES].map((_, i) => `$t${i}`).join(', ');
    const typeParams = {};
    [...ENCLOSING_TYPES].forEach((t, i) => { typeParams[`t${i}`] = t; });
    // FIX C — method-level callee precision. When a clangd symbol/definition
    // (e.g. a constructor or member fn) sits inside BOTH a Method/Function node
    // and its enclosing Class/Struct, prefer the innermost callable so
    // caller→callee edges land on the method, not the class. We rank:
    //   (1) callable types (Function/Method) before container types
    //       (Class/Struct/Interface) — a function enclosed by a class is the
    //       more precise target;
    //   (2) then innermost: largest start_line, smallest span.
    // The CASE keeps the existing innermost fallback for non-callable matches.
    const match = db.get(
      `SELECT id, type, start_line, end_line FROM nodes
        WHERE file_path = $file
          AND start_line <= $line AND end_line >= $line
          AND type IN (${placeholders})
        ORDER BY
          CASE WHEN type IN ('Function', 'Method') THEN 0 ELSE 1 END ASC,
          start_line DESC,
          end_line ASC
        LIMIT 1`,
      { file, line: defLine, ...typeParams },
    );
    if (match) return { nodeId: match.id, nodeType: match.type, startLine: match.start_line, endLine: match.end_line };
  }

  // No tree-sitter node — synthesize a code-intel Symbol node keyed by symbolId.
  const id = lspSymbolNodeId(record.symbolId);
  upsertFileNode(db, file || '', { language: record.language });
  upsertNode(db, {
    id,
    type: 'Symbol',
    label: (record.qname || record.symbolId || '').split(/::|\.|#/u).filter(Boolean).at(-1) ?? record.symbolId,
    file_path: file || '',
    start_line: defLine ?? 0,
    end_line: record.range?.end?.line ?? defLine ?? 0,
    language: record.language ?? '',
    confidence: confidenceToScore(record.confidence),
    structural_fp: '',
    dependency_fp: '',
    extra: {
      qname: record.qname,
      code_intel: true,
      provenance: 'CODE_INTEL',
      symbol_id: record.symbolId,
    },
  });
  stats.nodesCreated += 1;
  return { nodeId: id, nodeType: 'Symbol', startLine: defLine ?? 0, endLine: record.range?.end?.line ?? defLine ?? 0 };
}

// Build a per-file index of candidate enclosing symbols (id,start,end) so the
// caller for each reference can be found without an N+1 query per reference.
function buildEnclosingIndex(db, files) {
  const index = new Map();
  if (files.size === 0) return index;
  const placeholders = [...ENCLOSING_TYPES].map((_, i) => `$t${i}`).join(', ');
  const typeParams = {};
  [...ENCLOSING_TYPES].forEach((t, i) => { typeParams[`t${i}`] = t; });
  for (const file of files) {
    const rows = db.all(
      `SELECT id, start_line, end_line FROM nodes
        WHERE file_path = $file
          AND type IN (${placeholders})
          AND end_line >= start_line
        ORDER BY start_line ASC`,
      { file, ...typeParams },
    );
    index.set(file, rows);
  }
  return index;
}

// Innermost enclosing symbol at refLine: max start_line wins; tie → min end_line.
function findEnclosingCaller(rows, refLine) {
  let best = null;
  for (const row of rows || []) {
    if (row.start_line <= refLine && row.end_line >= refLine) {
      if (
        !best
        || row.start_line > best.start_line
        || (row.start_line === best.start_line && row.end_line < best.end_line)
      ) {
        best = row;
      }
    }
  }
  return best;
}

// Synthesize CALLS edges from a v0.2 collection's references onto the graph.
// Runs inside the importV02Collection transaction (alongside the side-table
// writes). Returns { edgesCreated, nodesCreated, edgesInvalidated }.
function synthesizeLspEdges(envelope, db, stats) {
  const out = { edgesCreated: 0, nodesCreated: 0, edgesInvalidated: 0 };
  const records = Array.isArray(envelope.records) ? envelope.records : [];

  // 1+2. Invalidation: a COMPLETE fresh collection supersedes prior clangd
  // edges so stale ones can't linger (per-repo db).
  //
  // I2 — only a complete collection (`status==='ok'`) is allowed to wipe the
  // prior verified set. A `partial` / budget-exhausted / error collection
  // re-collected only a slice of the repo; running the blanket invalidation
  // would destroy verified edges for every file it did NOT re-collect this run
  // (a cold 3/200-file run would erase the entire prior verified graph). A
  // partial collect therefore ADDS/REFRESHES its own edges (upsertLspEdge is
  // idempotent per (from,to,relation)) without invalidating the rest.
  //
  // C1 — invalidation must NEVER destroy a heuristic edge we merely promoted.
  //   (a) RESTORE every promoted edge (extractor carries a `|was:` stash) back
  //       to its original tree-sitter/heuristic provenance/extractor/confidence.
  //   (b) DELETE only edges THIS synthesizer created from scratch — a clean
  //       `cpp-clangd#%` extractor with no stash. Promoted rows are restored,
  //       not dropped, so the heuristic graph survives a clangd drop-out.
  // DATA-LOSS FIX (field report, HIGH). This was `envelope.status === 'ok'`, so a
  // one-file collect requesting ONLY symbols+diagnostics returned ok — it did
  // succeed at what it was asked — and was therefore treated as a globally
  // authoritative snapshot. It then deleted EVERY LSP_VERIFIED edge in the repo:
  // 5961 verified edges -> 0, ~30 minutes of full-collect work destroyed in
  // seconds, reported as status:"ok" / importFailed:false with the only signal
  // being `edgesInvalidated: 5208` (which reads like routine cleanup). The
  // documented inner-loop workflow — collect after touching a file — walks
  // straight into it.
  //
  // A collection can only invalidate edge classes it had the authority to
  // observe. CALLS edges come from the `references` operation; a run that never
  // collected references has NOTHING to say about which CALLS edges still exist,
  // and absence from its records is not evidence of deletion.
  //
  // NOTE this was latent and masked: the same call previously failed on a full
  // disk, so the import aborted and the spine survived by accident. Freeing the
  // disk unmasked it.
  const refsOp = envelope.operations?.references;
  const collectedReferences = Boolean(refsOp) && refsOp.status !== 'not_collected';
  const completeCollection = envelope.status === 'ok' && collectedReferences;
  if (envelope.status === 'ok' && !collectedReferences) {
    out.invalidationSkipped = 'collection did not include the references operation, so it has no authority over CALLS edges — existing [lsp✓] edges preserved';
  }

  // SECOND HALF OF THE SAME DEFECT. The references-operation gate above stops a
  // symbols-only collect from wiping the spine, but a run that DID collect
  // references while scoped to `files: [one.cpp]` still deleted every clangd edge
  // in the repo. It asked clangd about the symbols in those files and nothing
  // else, so its silence about the rest of the repo is not evidence.
  //
  // Authority is scoped on the CALLEE side, not the call site: a scoped run
  // queried `references` for symbols DEFINED IN the scoped files, and those
  // references legitimately come back from anywhere in the tree. So the edges it
  // re-observed are the ones whose `to_id` is a symbol defined in scope.
  const scope = envelope.session?.scope;
  const declaredFileScope = scope?.kind === 'files' && Array.isArray(scope.files);
  const scopedFiles = declaredFileScope
    ? scope.files.map((f) => String(f).replace(/\\/g, '/'))
    : null;

  // EMPTY SCOPE MEANS ZERO AUTHORITY, NOT UNLIMITED AUTHORITY.
  //
  // This read `scope.files.length > 0 ? scoped : null`, so a run declaring
  // `{kind:'files', files: []}` fell through to REPO-WIDE invalidation — the
  // maximum authority, from a run that walked nothing. Classic fail-open.
  //
  // It is reachable exactly where it hurts most: the last call of a resumed
  // sequence, when the ledger says every file is already collected. That call
  // holds no records, so it deleted every clangd edge in the graph and recreated
  // nothing. Caught by the regression test written for the resume/invalidation
  // interaction — 4 verified edges to 0 on a converged repo.
  const walkedNothing = declaredFileScope && scopedFiles.length === 0;
  if (walkedNothing) {
    out.invalidationSkipped = 'collection walked no files (already converged), so it has authority over nothing — existing [lsp✓] edges preserved';
  }
  // Build the scope predicate once. Empty string = unrestricted (repo-wide run).
  let scopeClause = '';
  let scopeParams = {};
  if (scopedFiles && scopedFiles.length > 0) {
    scopeParams = Object.fromEntries(scopedFiles.map((f, i) => [`sf${i}`, f]));
    const list = scopedFiles.map((_, i) => `$sf${i}`).join(',');
    scopeClause = ` AND to_id IN (SELECT id FROM nodes WHERE file_path IN (${list}))`;
    out.invalidationScopedTo = scopedFiles.length;
  }

  if (completeCollection && !walkedNothing) {
    // (a) restore promoted (stashed) edges to their heuristic origin.
    const promoted = db.all(
      `SELECT from_id, to_id, relation, extractor FROM edges
        WHERE provenance = $p AND extractor LIKE $stash${scopeClause}`,
      { p: LSP_PROVENANCE, stash: `%${STASH_SEP}%`, ...scopeParams },
    );
    for (const row of promoted) {
      const origin = decodeStash(row.extractor);
      if (!origin) continue;
      db.run(
        `UPDATE edges
            SET provenance = $provenance, extractor = $extractor, confidence = $confidence
          WHERE from_id = $from_id AND to_id = $to_id AND relation = $relation`,
        {
          from_id: row.from_id, to_id: row.to_id, relation: row.relation,
          provenance: origin.provenance, extractor: origin.extractor, confidence: origin.confidence,
        },
      );
    }
    // (b) delete only synthesizer-created edges (clean cpp-clangd#% extractor).
    const invalidated = db.get(
      `SELECT count(*) AS c FROM edges
        WHERE provenance = $p AND extractor LIKE 'cpp-clangd#%' AND extractor NOT LIKE $stash${scopeClause}`,
      { p: LSP_PROVENANCE, stash: `%${STASH_SEP}%`, ...scopeParams },
    );
    out.edgesInvalidated = invalidated?.c ?? 0;
    db.run(
      `DELETE FROM edges
        WHERE provenance = $p AND extractor LIKE 'cpp-clangd#%' AND extractor NOT LIKE $stash${scopeClause}`,
      { p: LSP_PROVENANCE, stash: `%${STASH_SEP}%`, ...scopeParams },
    );
    // Cheap orphan-node cleanup: drop prior LSP-synthesized symbol nodes that no
    // longer have any edge (real tree-sitter / file nodes are untouched).
    db.run(
      `DELETE FROM nodes
        WHERE id LIKE 'ci:lsp:%'
          AND id NOT IN (SELECT from_id FROM edges UNION SELECT to_id FROM edges)`,
    );
  }

  const nodeStats = { nodesCreated: 0 };
  // 3. defined-symbol node map: symbolId -> { nodeId, nodeType, startLine, endLine, file }.
  //
  // A clangd symbol typically yields TWO records for the same symbolId: a
  // `symbol` record at the .cpp definition body (which encloses the
  // tree-sitter Method/Function node) and a `definition` record at the .h
  // declaration (which only encloses the Class). FIX C: prefer the resolution
  // that lands on a callable (Method/Function) so caller→callee edges target
  // the method, not the enclosing class. Ranking of candidate resolutions:
  //   (1) callable node (Method/Function) beats container/Symbol;
  //   (2) otherwise a real tree-sitter node beats a synthesized ci:lsp Symbol;
  //   (3) otherwise first-seen wins (stable).
  const CALLABLE_TYPES = new Set(['Function', 'Method']);
  const resolutionRank = (nodeType, nodeId) => {
    if (CALLABLE_TYPES.has(nodeType)) return 2;            // best — a method/function
    if (typeof nodeId === 'string' && nodeId.startsWith('ci:lsp:')) return 0; // synthesized fallback
    return 1;                                              // a real container node (Class/Struct/etc.)
  };
  const symbolNodes = new Map();
  for (const record of records) {
    if (record.kind !== 'symbol' && record.kind !== 'definition') continue;
    if (!record.symbolId) continue;
    if (!(record.file && record.range)) {
      // No range to resolve against — only useful if we have nothing yet.
      if (symbolNodes.has(record.symbolId)) continue;
    }
    const resolved = resolveDefinedSymbolNode(db, record, nodeStats);
    const existing = symbolNodes.get(record.symbolId);
    if (existing) {
      // Keep the better-ranked resolution; never let a header-declaration
      // Class resolution clobber a .cpp-body Method resolution.
      const existingRank = resolutionRank(existing.nodeType, existing.nodeId);
      const newRank = resolutionRank(resolved.nodeType, resolved.nodeId);
      if (newRank <= existingRank) continue;
    }
    symbolNodes.set(record.symbolId, {
      nodeId: resolved.nodeId,
      nodeType: resolved.nodeType,
      startLine: resolved.startLine,
      endLine: resolved.endLine,
      file: record.file,
    });
  }
  out.nodesCreated = nodeStats.nodesCreated;

  // 4. per-file enclosing index for the reference sites.
  const refFiles = new Set();
  for (const record of records) {
    if (record.kind === 'reference' && record.result_state === 'found' && record.file) {
      refFiles.add(record.file);
    }
  }
  const enclosingIndex = buildEnclosingIndex(db, refFiles);

  const dbHash8 = String(envelope.session?.compileDbHash ?? '').slice(0, 8);
  const extractor = `cpp-clangd#${dbHash8}`;
  const seen = new Set();

  // 5. references → CALLS edges.
  for (const record of records) {
    if (record.kind !== 'reference') continue;
    if (record.result_state !== 'found') continue;
    if (!record.file || record.range?.start?.line == null) continue;

    const callee = symbolNodes.get(record.symbolId);
    if (!callee) continue; // unknown defined symbol — skip (no bogus edge)

    const refLine = record.range.start.line;

    // caller = innermost enclosing symbol at the ref site; else the File node.
    let callerId;
    const enclosing = findEnclosingCaller(enclosingIndex.get(record.file), refLine);
    if (enclosing) {
      callerId = enclosing.id;
    } else {
      callerId = upsertFileNode(db, record.file, { language: record.language });
    }

    // Skip self-edges.
    if (callerId === callee.nodeId) continue;
    // Skip when the ref site is inside the callee's own definition range in the
    // same file (that's the declaration, not a call).
    if (
      callee.file === record.file
      && callee.startLine != null && callee.endLine != null
      && refLine >= callee.startLine && refLine <= callee.endLine
    ) {
      continue;
    }

    // Dedup identical (from,to,relation,source_line).
    const dedupKey = `${callerId} ${callee.nodeId} CALLS ${refLine}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    upsertLspEdge(db, {
      from_id: callerId,
      to_id: callee.nodeId,
      relation: 'CALLS',
      source_file: record.file,
      source_line: refLine,
      confidence: confidenceToScore(record.confidence),
      extractor,
    });
    out.edgesCreated += 1;
  }

  Object.assign(stats, out);
  return out;
}

// Prune the side-table records of collections that a fresh COMPLETE collection
// supersedes. Without this, every `graph_collect_code_intel` run appends a full
// set of code_intel_records and the prior ones are never removed — the table
// grows unbounded (sand_castle hit 1.03M rows / 732MB across 13 clangd runs) AND
// getCodeIntelEvidenceForSymbol/getCodeIntelDiagnosticsForFiles query ACROSS all
// collections, so stale evidence/diagnostics from superseded runs resurface.
//
// "Superseded" = a prior collection from the SAME provider (clangd/tsserver/
// pyright) — the backend just re-collected, so its older runs are stale. Other
// providers' collections are untouched (a cpp collect must not wipe a python
// collection). Only a COMPLETE collect prunes; a partial re-collected a slice
// and must not drop the rest. Mirrors the edge-invalidation policy in
// synthesizeLspEdges (complete-only, backend-scoped). Returns prune stats.
function pruneSupersededCollections(db, { provider, currentCollectionId }) {
  const out = { collectionsPruned: 0, recordsPruned: 0 };
  const superseded = db.all(
    `SELECT collection_id FROM code_intel_collections
      WHERE provider IS $provider AND collection_id != $current`,
    { provider: provider ?? null, current: currentCollectionId },
  );
  for (const row of superseded) {
    const cid = row.collection_id;
    const c = db.get(`SELECT COUNT(*) AS c FROM code_intel_records WHERE collection_id = $cid`, { cid }).c;
    db.run(`DELETE FROM code_intel_records WHERE collection_id = $cid`, { cid });
    db.run(`DELETE FROM code_intel_collections WHERE collection_id = $cid`, { cid });
    out.recordsPruned += c;
    out.collectionsPruned += 1;
  }
  return out;
}

// One-shot maintenance: keep only the most recent collection per provider and
// prune every older one's records. Use to reclaim space on a graph that bloated
// BEFORE the per-collect auto-prune landed (sand_castle: 1.03M rows / 13 clangd
// collections). Caller is responsible for VACUUM afterward to shrink the file
// (DELETE alone frees pages for reuse but doesn't shrink on disk). Returns
// { collectionsPruned, recordsPruned, kept[] }.
export function compactCodeIntelRecords(db) {
  ensureCodeIntelCollectionsTable(db);
  ensureCodeIntelRecordsTable(db);
  const collections = db.all(
    `SELECT collection_id, provider, collected_at FROM code_intel_collections`,
  );
  // Most recent per provider wins (mirrors getLatestCollection's ORDER BY
  // collected_at DESC), so compaction agrees with how the system picks current.
  // ★ AN EMPTY COLLECTION MUST NEVER SUPERSEDE A POPULATED ONE.
  //
  // This pruned by timestamp alone, so the NEWEST row won regardless of whether
  // it contained anything. On 2026-07-31 a converged collect — one that walked
  // ZERO files and correctly reported "authority over nothing" — wrote an empty
  // collection row with a later collected_at, became "latest", and pruned the
  // real collection out from under it: 8530 records to 0 on a live repo.
  // ef-manager had a pre-collect backup only because this codebase has a prior
  // incident of a collect destroying spine data, and his copy is the sole
  // surviving source of the entire 52% dataset.
  //
  // The edge-preservation guard did work — 1507 LSP_VERIFIED edges, 28003 edges
  // and 9034 nodes were byte-identical across the wipe. But "authority over
  // nothing" had been implemented as DO NOT INVALIDATE, and it has to mean DO NOT
  // WRITE. A run that examined nothing may not author a row at all, let alone one
  // that supersedes real evidence.
  //
  // This is the same shape as everything else tonight: recency stood in for
  // authority, while the real signal — does this collection actually contain
  // anything — was one COUNT away.
  const recordCountFor = (cid) => db.get(
    `SELECT COUNT(*) AS c FROM code_intel_records WHERE collection_id = $cid`, { cid },
  ).c ?? 0;
  const latestByProvider = new Map();
  for (const c of collections) {
    const key = c.provider ?? '';
    const cur = latestByProvider.get(key);
    if (!cur) { latestByProvider.set(key, c); continue; }
    const curN = recordCountFor(cur.collection_id);
    const cN = recordCountFor(c.collection_id);
    // A populated collection outranks an empty one no matter how new the empty
    // one is. Only when both are populated (or both empty) does recency decide.
    if (cN > 0 && curN === 0) { latestByProvider.set(key, c); continue; }
    if (cN === 0 && curN > 0) continue;
    if (String(c.collected_at ?? '') > String(cur.collected_at ?? '')) {
      latestByProvider.set(key, c);
    }
  }
  const keep = new Set([...latestByProvider.values()].map((c) => c.collection_id));
  let collectionsPruned = 0;
  let recordsPruned = 0;
  for (const c of collections) {
    if (keep.has(c.collection_id)) continue;
    const n = db.get(`SELECT COUNT(*) AS c FROM code_intel_records WHERE collection_id = $cid`, { cid: c.collection_id }).c;
    db.run(`DELETE FROM code_intel_records WHERE collection_id = $cid`, { cid: c.collection_id });
    db.run(`DELETE FROM code_intel_collections WHERE collection_id = $cid`, { cid: c.collection_id });
    recordsPruned += n;
    collectionsPruned += 1;
  }
  return { collectionsPruned, recordsPruned, kept: [...keep] };
}

// A — restore LSP-verified edges from a PERSISTED collection's records WITHOUT
// re-running clangd. A full rebuild (freshness orchestrator) does
// `DELETE FROM edges` and wipes the LSP_VERIFIED trust spine, but the
// code_intel_records side-table survives. When that rebuild was triggered by
// TOOLING (extractor-version bump, schema change, forced reindex) and not by a
// code change, the stored clangd evidence is still exactly valid — so we can
// re-synthesize the identical LSP edges from the records instead of forcing an
// expensive re-collect.
//
// HONESTY GATE IS THE CALLER'S JOB: this only ever re-runs the same resolution
// synthesizeLspEdges does, against the CURRENT tree-sitter nodes. If the code
// moved since collection, line numbers would resolve wrong and we'd be stamping
// stale evidence as LSP_VERIFIED. The orchestrator therefore invokes this ONLY
// when the collection's indexedCommit equals the current HEAD (code unchanged).
export function resynthesizeLspEdgesFromCollection(db, { collectionId } = {}) {
  const empty = { edgesCreated: 0, nodesCreated: 0, edgesInvalidated: 0, records: 0 };
  if (!collectionId) return empty;
  ensureCodeIntelCollectionsTable(db);
  ensureCodeIntelRecordsTable(db);
  const col = db.get(
    `SELECT collection_id, provider, status, compile_db_hash FROM code_intel_collections WHERE collection_id = $cid`,
    { cid: collectionId },
  );
  if (!col) return empty;
  const rows = db.all(
    `SELECT kind, language, symbol_id, qname, file, confidence, result_state, raw
       FROM code_intel_records WHERE collection_id = $cid`,
    { cid: collectionId },
  );
  if (rows.length === 0) return empty;
  const records = rows.map((r) => {
    let raw = {};
    try { raw = JSON.parse(r.raw); } catch { /* ignore */ }
    return {
      kind: r.kind,
      language: r.language,
      symbolId: r.symbol_id,
      qname: r.qname,
      file: r.file,
      range: raw.range,
      confidence: raw.confidence ?? r.confidence,
      result_state: r.result_state,
    };
  });
  const envelope = {
    status: col.status,
    provider: col.provider,
    collectionId,
    records,
    session: { compileDbHash: col.compile_db_hash },
  };
  const stats = {};
  // Batch the synthesis (hundreds of thousands of edge upserts on a real repo).
  const run = db.transaction(() => synthesizeLspEdges(envelope, db, stats));
  run();
  return { ...stats, records: records.length };
}

function makeRecordInserter(db, collectionId) {
  ensureCodeIntelRecordsTable(db);
  const sql = `
    INSERT INTO code_intel_records
      (collection_id, kind, language, symbol_id, qname, file, range_start_line, range_end_line, confidence, provenance, result_state, cause, degraded, raw)
    VALUES
      (@collection_id, @kind, @language, @symbol_id, @qname, @file, @range_start_line, @range_end_line, @confidence, @provenance, @result_state, @cause, @degraded, @raw)
  `;
  return (record) => {
    const range = record.range || {};
    db.run(sql, {
      // Stamp the ENVELOPE's collectionId (authoritative) so the side-table
      // always matches the code_intel_collections row — otherwise prune/replay,
      // which key on collection_id, can silently miss records if a record's own
      // collectionId ever diverges from the envelope's.
      collection_id: collectionId ?? record.collectionId,
      kind: record.kind,
      language: record.language,
      symbol_id: record.symbolId ?? null,
      qname: record.qname ?? null,
      file: record.file ?? null,
      range_start_line: range.start?.line ?? record.start_line ?? null,
      range_end_line: range.end?.line ?? record.end_line ?? null,
      confidence: record.confidence ?? null,
      provenance: record.provenance ?? null,
      result_state: record.result_state ?? null,
      // Promoted out of the raw blob into real columns. Capturing evidence is not
      // aggregating it — these were reaching the DB and dying below the summary.
      cause: record.cause ?? null,
      degraded: record.degraded == null ? null : (record.degraded ? 1 : 0),
      raw: JSON.stringify(record),
    });
  };
}

export function importV02Collection(envelope, db) {
  const stats = {
    schemaVersion: '0.2',
    collectionId: envelope.collectionId,
    collectionStatus: envelope.status,
    operations: envelope.operations,
    recordsImported: 0,
    edgesCreated: 0,
    nodesCreated: 0,
    edgesInvalidated: 0,
  };
  ensureCodeIntelCollectionsTable(db);
  ensureCodeIntelRecordsTable(db);
  // Defensive dedup for direct file imports that bypass runCollection (which
  // already dedups). Idempotent on an already-deduped envelope. Lossless —
  // duplicate clangd refs resolve to the same edge. Keeps the side-table bounded.
  if (Array.isArray(envelope.records) && envelope.records.length) {
    envelope = { ...envelope, records: dedupCollectionRecords(envelope.records) };
  }
  const insertRecord = makeRecordInserter(db, envelope.collectionId);
  const firstRecord = envelope.records?.[0];

  const run = db.transaction(() => {
  // FIX A/B: readiness + reference-outcome signals. `index_ready` is the basis
  // for honest exhaustiveness — references are only trustworthy-as-exhaustive
  // when the background index was idle before they were queried. NULL (older
  // collections) reads as "unknown" downstream. Fold the same signals into
  // operations_json so they survive even on graphs that lack the new columns.
  const sess = envelope.session || {};
  const indexReady = sess.indexReady;
  const operationsJson = JSON.stringify({
    ...(envelope.operations || {}),
    _session: {
      mode: sess.mode ?? null,
      indexReady: indexReady ?? null,
      indexWaitMs: sess.indexWaitMs ?? null,
      indexWaitReason: sess.indexWaitReason ?? null,
      refsFoundSymbols: sess.refsFoundSymbols ?? null,
      refsNotFoundSymbols: sess.refsNotFoundSymbols ?? null,
      refsDegradedSymbols: sess.refsDegradedSymbols ?? null,
      refsCleanNotFoundSymbols: sess.refsCleanNotFoundSymbols ?? null,
      // ★ CAPTURED AND NOT AGGREGATED — the fourth instance, caught by ef-manager
      // predicting it would populate on a walking collect and then finding it
      // absent. The provider HAS emitted refsNotFoundByKind since it was written;
      // the importer never copied it into _session, so it died at this boundary
      // and no collect has ever surfaced it. His hand-derivation from graph.sqlite
      // remained the only SymbolKind data that had ever existed.
      refsNotFoundByKind: sess.refsNotFoundByKind ?? null,
      // WHAT WAS NEVER ASKED. These must persist or graph_health cannot mark its
      // coverage percentage as a FLOOR — a symbol we declined to query sits in the
      // denominator and can never reach the numerator, so omitting them turns
      // "not asked" into "asked, found nothing". Persisted here rather than only
      // in the live envelope because health reads the stored collection, and a
      // caveat that does not survive the write is not a caveat.
      positionGuesses: sess.positionGuesses ?? null,
      positionGuessSkipped: sess.positionGuessSkipped ?? null,
      refsTruncatedSymbols: sess.refsTruncatedSymbols ?? null,
    },
  });
  // ★ AUTHORITY OVER NOTHING MUST MEAN WRITE NOTHING.
  //
  // The guard above stopped a no-walk run from INVALIDATING edges, and that half
  // worked. But the same run still authored a collection row, and because pruning
  // kept the newest row per provider, that empty row superseded and destroyed a
  // real 8530-record collection. Two correct-looking halves composed into data
  // loss. A run that walked no files is now a pure no-op on this table: it does
  // not get to say anything, because it did not look at anything.
  // Computed from the ENVELOPE, which is what this function actually has: a run
  // that declared a file scope, walked none of it, and produced no records.
  const declaredScope = envelope?.session?.scope;
  const walkedNoFiles = Array.isArray(declaredScope?.files) && declaredScope.files.length === 0;
  const authoredNothing = walkedNoFiles && (envelope?.records?.length ?? 0) === 0;
  if (authoredNothing) {
    stats.collectionRowSkipped = 'collection walked no files and produced no records — no collection row written, '
      + 'so it cannot supersede a real one. Authority over nothing means write nothing.';
  }
  // Aggregate the split from the RECORDS, so a collection whose records carry
  // `cause` is never summarised as null just because its session predates the
  // counters. Null (not 0) when there are no not-found records at all — an
  // absent split and a measured zero must stay distinguishable.
  const notFoundRecs = (envelope?.records ?? []).filter(
    (r) => r?.result_state === 'not_found_after_retry',
  );
  const degradedFromRecords = notFoundRecs.length > 0
    ? notFoundRecs.filter((r) => r?.degraded === true || r?.cause != null).length
    : null;
  const cleanFromRecords = notFoundRecs.length > 0
    ? notFoundRecs.filter((r) => !(r?.degraded === true || r?.cause != null)).length
    : null;
  if (!authoredNothing) db.run(
    `INSERT OR REPLACE INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at, errors_json,
        mode, index_ready, index_wait_ms, refs_found, refs_not_found, refs_degraded, refs_clean_not_found)
     VALUES (@collection_id, @provider, @provider_version, @project_root, @language, @status,
             @freshness_basis, @freshness_value, @compile_db_hash, @indexed_commit,
             @operations_json, @collected_at, @errors_json,
             @mode, @index_ready, @index_wait_ms, @refs_found, @refs_not_found, @refs_degraded, @refs_clean_not_found)`,
    {
      collection_id: envelope.collectionId,
      provider: envelope.provider,
      provider_version: envelope.providerVersion,
      project_root: envelope.projectRoot,
      language: firstRecord?.language || 'unknown',
      status: envelope.status,
      freshness_basis: sess.freshnessBasis ?? null,
      freshness_value: sess.freshnessValue ?? sess.compileDbHash ?? null,
      compile_db_hash: sess.compileDbHash ?? null,
      indexed_commit: sess.indexedCommit ?? null,
      operations_json: operationsJson,
      collected_at: sess.collectedAt ?? new Date().toISOString(),
      errors_json: envelope.errors ? JSON.stringify(envelope.errors) : null,
      mode: sess.mode ?? null,
      index_ready: indexReady == null ? null : (indexReady ? 1 : 0),
      index_wait_ms: sess.indexWaitMs ?? null,
      refs_found: sess.refsFoundSymbols ?? null,
      refs_not_found: sess.refsNotFoundSymbols ?? null,
      // ★ DERIVE FROM THE RECORDS WHEN THE SESSION COUNTER IS ABSENT.
      //
      // This read `sess.refsDegradedSymbols ?? null` and nothing else, so a
      // collection whose RECORDS carry `cause` but whose session predates the
      // counters wrote NULL — and the breakdown read null with 833 causes sitting
      // one table away. That is the original "captured, not aggregated" defect
      // still live, one layer up, inside the region I had just described as
      // covered. ef-manager caught the scope claim before the gap bit anyone.
      //
      // Records are ground truth; the session counter is a summary that can go
      // missing. Prefer the summary when present (it counts symbols the provider
      // examined, including any it chose not to record) and fall back to counting
      // what is actually stored.
      refs_degraded: sess.refsDegradedSymbols ?? degradedFromRecords,
      refs_clean_not_found: sess.refsCleanNotFoundSymbols ?? cleanFromRecords,
    },
  );
    for (const record of (envelope.records || [])) {
      insertRecord(record);
      stats.recordsImported += 1;
    }

    // Prune superseded same-provider collections' side-table records on a
    // COMPLETE collect (keeps the table from growing unbounded across runs and
    // stops stale evidence from resurfacing). Partial collects don't prune.
    if (envelope.status === 'ok') {
      const pruned = pruneSupersededCollections(db, {
        provider: envelope.provider,
        currentCollectionId: envelope.collectionId,
      });
      stats.collectionsPruned = pruned.collectionsPruned;
      stats.recordsPruned = pruned.recordsPruned;
    }

    // L2a: synthesize real graph edges (provenance LSP_VERIFIED) from the
    // clangd references/definitions in the SAME transaction as the side-table
    // writes.
    synthesizeLspEdges(envelope, db, stats);
  });
  run();
  return stats;
}

function importV01Jsonl(raw, db) {
  const records = [];
  const errors = [];
  const lines = raw.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      errors.push({ line: i + 1, message: err.message });
    }
  }
  if (errors.length) {
    const preview = errors.slice(0, 3).map((e) => `${e.line}: ${e.message}`).join('; ');
    const err = new Error(`invalid code-intel JSONL: ${preview}`);
    err.errors = errors;
    throw err;
  }
  const counts = importCodeIntelRecords(db, records);
  return {
    schemaVersion: '0.1',
    recordsImported: counts.records,
    counts,
  };
}

export function importCodeIntel(filepath, db, _options = {}) {
  const raw = readFileSync(filepath, 'utf8').trim();
  if (raw.length === 0) {
    return { schemaVersion: 'unknown', recordsImported: 0 };
  }

  let parsedHead = null;
  try {
    parsedHead = JSON.parse(raw);
  } catch {
    parsedHead = null;
  }

  if (parsedHead && detectSchemaVersion(parsedHead) === '0.2') {
    const validation = validateAny(parsedHead);
    if (!validation.valid) {
      throw new Error(`code-intel v0.2 validation failed: ${validation.errors.join('; ')}`);
    }
    return importV02Collection(parsedHead, db);
  }

  return importV01Jsonl(raw, db);
}
