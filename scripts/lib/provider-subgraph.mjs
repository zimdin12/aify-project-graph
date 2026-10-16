// Answer the dashboard's `subgraph` call: the nodes and edges around one anchor or file, read from the graph index.
//
// Shape agreed with dashboard-manager on 2026-10-17. APG returns its own nodes and edges, and the dashboard maps them
// to its drawing. Layers, groups and styling are the dashboard's, so no dashboard concept appears here.
//
//   args   { anchor | path (exactly one), depth 1..3 (1), limit 1..1000 (200), edgeKinds?, includeExternal (false) }
//   answer { indexCommit, head, stale, staleBecause, matched: { nodes, edges, dropped: { external } }, truncated,
//            nodes: [{ id, kind, name, qname, path, lineRange, anchor }],
//            edges: [{ from, to, type, resolution, provenance }] }
//
// ⛔ READ-ONLY BY CONSTRUCTION. stamp and resolve re-extract a file at the commit; this is the first provider call that
// reads the index, and it must never write it or start a rebuild. So nothing here imports the freshness path. The
// index is read through `captureExistingSnapshot`, which opens SQLite readonly and pins ONE read snapshot, so a
// rebuild landing mid-answer cannot mix two generations. An index whose publication is not attested (a rebuild that
// crashed, or one in progress) is refused. A torn graph is not served as a picture of the code.
//
// ⛔ `stale` IS SAID, NEVER HIDDEN. The index describes the commit it was built at, which can be behind HEAD. The
// answer names both commits and why they differ. Refreshing is the host's job, on commit.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { captureExistingSnapshot } from '../../mcp/stdio/storage/db.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../../mcp/stdio/storage/publication-schema.js';
import { CODE_NODE_TYPES, EDGE_PROVENANCE_TYPES, FILE_LEVEL_TYPES } from '../../mcp/stdio/storage/taxonomy.js';

/** The bounds agreed with dashboard-manager. The limit's ceiling keeps a full answer under the service's 1 MiB body cap. */
export const SUBGRAPH_BOUNDS = Object.freeze({
  depth: Object.freeze({ fallback: 1, max: 3 }),
  limit: Object.freeze({ fallback: 200, max: 1000 }),
});

/** How an answer was computed, in this provider's own words. Travels as the answer's provenance. */
export const SUBGRAPH_HOW = 'apg graph index, read-only (tree-sitter extraction; an edge is compiler-resolved only '
  + 'where its resolution says compiler)';

// ── Resolution: how an edge's target was decided, so the page can draw a name match unlike a compiler fact.
//
// ⚠ A KNOWN GAP, AGREED: `name` also holds calls resolved through an import, which are better than a bare name
// match. Provenance does not separate them, so they are not split by guessing.
// ⚠ IMPORTS and LINKS_TO are `name`, not `structural`: their target is found by matching a written path to a file,
// and that match can be wrong. Only containment, which the parser reads off one file's own tree, is structural.
const BUCKET_OF_PROVENANCE = Object.freeze({
  LSP_VERIFIED: 'compiler',
  CODE_INTEL: 'compiler',
  AMBIGUOUS: 'ambiguous',
  EXTRACTED: 'written',
  INFERRED: 'written',
});
const STRUCTURAL_RELATIONS = new Set(['CONTAINS', 'DEFINES']);

/** The resolution of one edge. A provenance this table does not know is `unknown`, never quietly `name`. */
export function resolutionOf({ relation, provenance }) {
  const bucket = Object.hasOwn(BUCKET_OF_PROVENANCE, provenance) ? BUCKET_OF_PROVENANCE[provenance] : 'unknown';
  if (bucket !== 'written') return bucket;
  return STRUCTURAL_RELATIONS.has(relation) ? 'structural' : 'name';
}

/** Every provenance the storage ladder declares, so a test can prove each one has a bucket. */
export const KNOWN_PROVENANCES = EDGE_PROVENANCE_TYPES;

// ── Arguments.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function boundedInteger(value, name, { fallback, max }) {
  if (value === undefined) return { value: fallback };
  if (!Number.isSafeInteger(value) || value < 1 || value > max) return { problem: `args.${name} must be an integer from 1 to ${max}` };
  return { value };
}

/** Validate `args`. Returns { ok: true, value } or { ok: false, problem }. Nothing is defaulted that was sent wrong. */
export function parseSubgraphArgs(args) {
  if (!isPlainObject(args)) return { ok: false, problem: 'args must be an object' };
  const hasAnchor = args.anchor !== undefined;
  const hasPath = args.path !== undefined;
  if (hasAnchor === hasPath) return { ok: false, problem: 'give exactly one of args.anchor or args.path' };
  if (hasAnchor && !isPlainObject(args.anchor)) return { ok: false, problem: 'args.anchor must be an anchor object' };
  if (hasPath && (typeof args.path !== 'string' || args.path.trim() === '')) return { ok: false, problem: 'args.path must be a non-empty string' };

  const depth = boundedInteger(args.depth, 'depth', SUBGRAPH_BOUNDS.depth);
  if (depth.problem) return { ok: false, problem: depth.problem };
  const limit = boundedInteger(args.limit, 'limit', SUBGRAPH_BOUNDS.limit);
  if (limit.problem) return { ok: false, problem: limit.problem };

  const { edgeKinds } = args;
  if (edgeKinds !== undefined && (!Array.isArray(edgeKinds) || edgeKinds.length === 0
    || !edgeKinds.every((k) => typeof k === 'string' && k !== ''))) {
    return { ok: false, problem: 'args.edgeKinds must be a non-empty list of edge type names' };
  }
  if (args.includeExternal !== undefined && typeof args.includeExternal !== 'boolean') {
    return { ok: false, problem: 'args.includeExternal must be true or false' };
  }
  return {
    ok: true,
    value: {
      start: hasAnchor ? { anchor: args.anchor } : { path: args.path.trim() },
      depth: depth.value,
      limit: limit.value,
      edgeKinds: edgeKinds === undefined ? null : [...new Set(edgeKinds)],
      includeExternal: args.includeExternal === true,
    },
  };
}

// ── Reading the index.

/** The graph as one pinned read snapshot exposes it. Lives only inside `captureExistingSnapshot`'s callback. */
class GraphView {
  #db;
  #edgeKinds;

  constructor(db, edgeKinds) {
    this.#db = db;
    this.#edgeKinds = edgeKinds === null ? null : new Set(edgeKinds);
  }

  node(id) {
    return this.#db.get('SELECT id, type, label, file_path, start_line, end_line, extra FROM nodes WHERE id = $id', { id });
  }

  /** The whole-file node for a path, by the registry's precedence (File first). */
  fileNode(path) {
    const rows = this.#db.all('SELECT id, type, label, file_path, start_line, end_line, extra FROM nodes WHERE file_path = $path', { path });
    for (const type of FILE_LEVEL_TYPES) {
      const hit = rows.filter((r) => r.type === type).sort(byId)[0];
      if (hit) return hit;
    }
    return null;
  }

  /** Code symbols in a file whose label or qname is `name`. */
  symbolsNamed(path, name) {
    return this.#db.all(
      `SELECT id, type, label, file_path, start_line, end_line, extra FROM nodes
        WHERE file_path = $path AND (label = $name OR json_extract(extra, '$.qname') = $name)`,
      { path, name },
    ).filter((r) => CODE_NODE_TYPES.includes(r.type)).sort(byId);
  }

  /** How many code symbols in a file carry this label: an anchor by label is only usable when the answer is 1. */
  labelCount(path, label) {
    return this.#db.all('SELECT type FROM nodes WHERE file_path = $path AND label = $label', { path, label })
      .filter((r) => CODE_NODE_TYPES.includes(r.type)).length;
  }

  /** Every edge touching `id`, in both directions, of the requested kinds. */
  edgesAt(id) {
    return this.#db.all(
      'SELECT from_id, to_id, relation, provenance FROM edges WHERE from_id = $id UNION ALL '
      + 'SELECT from_id, to_id, relation, provenance FROM edges WHERE to_id = $id',
      { id },
    ).filter((e) => this.#edgeKinds === null || this.#edgeKinds.has(e.relation));
  }
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const extraOf = (row) => { try { return JSON.parse(row.extra ?? '{}') ?? {}; } catch { return {}; } };

/** The start node for the request, or a refusal that says why. */
function startNode(view, start) {
  if (start.path !== undefined) return wholeFile(view, start.path);
  const { anchor } = start;
  const path = typeof anchor.path === 'string' ? anchor.path.trim() : '';
  if (path === '') return { problem: 'args.anchor has no path' };
  if (anchor.kind === 'file' || anchor.kind === 'module') return wholeFile(view, path);
  if (anchor.kind !== 'symbol') return { problem: `args.anchor.kind ${JSON.stringify(anchor.kind)} is not file, module or symbol` };
  const name = String(anchor.name ?? '').trim();
  if (name === '') return { problem: 'a symbol anchor needs a name' };
  const matches = view.symbolsNamed(path, name);
  if (matches.length === 1) return { node: matches[0] };
  if (matches.length === 0) return { problem: `${name} is not a symbol of ${path} in the index`, reasonCode: 'not_in_index' };
  const candidates = matches.map((n) => ({ name: n.label, qname: extraOf(n).qname ?? null, line: n.start_line ?? null }));
  // A refusal reaches the service as text only, so the candidates are written into it as well as carried beside it.
  const listed = candidates.map((c) => `${c.qname ?? c.name} (line ${c.line ?? '?'})`).join(', ');
  return {
    problem: `${name} names ${matches.length} symbols in ${path}; anchor one by its qname: ${listed}`,
    reasonCode: 'ambiguous_anchor',
    candidates,
  };
}

function wholeFile(view, path) {
  const node = view.fileNode(path);
  return node ? { node } : { problem: `${path} is not in the index`, reasonCode: 'not_in_index' };
}

/**
 * Breadth-first out to `depth`, in both directions. Returns every node reached, in hop order with ties by id, and the
 * External nodes left out. Pure over `view`: the same snapshot and request give the same order, so a cut is stable.
 */
export function walk({ view, startId, depth, includeExternal }) {
  const order = [startId];
  const seen = new Set(order);
  const droppedExternal = new Set();
  let frontier = [startId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next = new Set();
    for (const id of frontier) {
      for (const e of view.edgesAt(id)) {
        const other = e.from_id === id ? e.to_id : e.from_id;
        if (seen.has(other) || next.has(other)) continue;
        if (!includeExternal && isExternal(view, other)) { droppedExternal.add(other); continue; }
        next.add(other);
      }
    }
    frontier = [...next].sort();
    for (const id of frontier) { seen.add(id); order.push(id); }
  }
  return { order, droppedExternal: droppedExternal.size };
}

const isExternal = (view, id) => view.node(id)?.type === 'External';

/** The distinct edges among `ids`, one per (from, to, type, provenance), in a stable order. */
function edgesAmong(view, ids) {
  const inside = new Set(ids);
  const out = new Map();
  for (const id of ids) {
    for (const e of view.edgesAt(id)) {
      if (!inside.has(e.from_id) || !inside.has(e.to_id)) continue;
      const key = `${e.from_id}\u0000${e.to_id}\u0000${e.relation}\u0000${e.provenance}`;
      if (!out.has(key)) {
        out.set(key, { from: e.from_id, to: e.to_id, type: e.relation, resolution: resolutionOf(e), provenance: e.provenance ?? null });
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.from + a.to + a.type).localeCompare(b.from + b.to + b.type));
}

/** One node as the answer carries it, with the anchor that pins it, or null where nothing can. */
function nodeEntry(view, row) {
  const extra = extraOf(row);
  const path = row.file_path ? row.file_path : null;
  return {
    id: row.id,
    kind: row.type,
    name: row.label,
    qname: extra.qname ?? null,
    path,
    lineRange: row.start_line > 0 ? [row.start_line, row.end_line ?? row.start_line] : null,
    anchor: anchorOf(view, row, path, extra),
  };
}

function anchorOf(view, row, path, extra) {
  if (path === null) return null;
  if (row.type === 'Module') return { kind: 'module', path };
  if (FILE_LEVEL_TYPES.includes(row.type) && row.type !== 'Directory') return { kind: 'file', path };
  if (!CODE_NODE_TYPES.includes(row.type)) return null;
  // A label shared by two symbols of one file would be refused as ambiguous by resolve, so the qname is used instead.
  if (view.labelCount(path, row.label) === 1) return { kind: 'symbol', path, name: row.label };
  return extra.qname ? { kind: 'symbol', path, name: extra.qname } : null;
}

/** What the manifest says about the index, read BEFORE the database: it is the other side of the attestation. */
function readManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function staleness(manifest, head) {
  const reasons = [];
  const indexCommit = typeof manifest?.commit === 'string' && manifest.commit !== '' ? manifest.commit : null;
  if (indexCommit === null) reasons.push('index_commit_unknown');
  else if (indexCommit !== head) reasons.push('index_behind_head');
  if (Array.isArray(manifest?.dirtyFiles) && manifest.dirtyFiles.length > 0) reasons.push('indexed_with_uncommitted_changes');
  return { indexCommit, stale: reasons.length > 0, staleBecause: reasons };
}

/**
 * Read one subgraph. `request` is `parseSubgraphArgs(...).value`.
 * @returns {{ ok: true, value } | { ok: false, problem, reasonCode?, candidates? }}
 */
export function readSubgraph({ repoRoot, request, head }) {
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) return { ok: false, problem: `no graph index at ${dbPath}`, reasonCode: 'no_index' };
  const manifest = readManifest(repoRoot);
  return captureExistingSnapshot(dbPath, (db) => {
    const attestation = classifyAttestation({
      dbGeneration: readGraphPublication(db)?.generation ?? null,
      manifestGeneration: manifest?.generation ?? null,
      manifestUsable: manifest !== null,
    });
    if (attestation !== ATTESTATION.ATTESTED) {
      return { ok: false, problem: `the index cannot be read as one whole build (${attestation})`, reasonCode: 'index_not_attested' };
    }
    const view = new GraphView(db, request.edgeKinds);
    const start = startNode(view, request.start);
    if (!start.node) return { ok: false, ...start };
    const { order, droppedExternal } = walk({ view, startId: start.node.id, depth: request.depth, includeExternal: request.includeExternal });
    const kept = order.slice(0, request.limit);
    return {
      ok: true,
      value: {
        ...staleness(manifest, head),
        head,
        matched: { nodes: order.length, edges: edgesAmong(view, order).length, dropped: { external: droppedExternal } },
        truncated: order.length > kept.length,
        nodes: kept.map((id) => nodeEntry(view, view.node(id))),
        edges: edgesAmong(view, kept),
      },
    };
  });
}
