// Structured exact-name definitions and one-hop callers from the existing attested index.
import { SEARCH_TYPES } from '../../mcp/stdio/query/verbs/whereis.js';
import { EXECUTION_FAMILY, CALL_FAMILY } from '../../mcp/stdio/storage/taxonomy.js';
import { GraphView, nodeEntry, resolutionOf, SUBGRAPH_HOW } from './provider-subgraph.mjs';
import { readAttestedSnapshot } from './provider-snapshot.mjs';
import { repoRelativeProblem } from './provider-paths.mjs';

const LOOKUPS = Object.freeze({ find: findDeclarations, callers: findCallers });
export const LOOKUP_CALLS = Object.freeze(Object.keys(LOOKUPS));
export const LOOKUP_HOW = `${SUBGRAPH_HOW}; exact indexed declarations and one-hop execution edges, not repository absence`;
export const LOOKUP_LIMIT = Object.freeze({ fallback: 100, max: 1000 });
const unsearched = CALL_FAMILY.filter((r) => !EXECUTION_FAMILY.includes(r));
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refuse = (problem, reasonCode = 'invalid_request') => ({ ok: false, problem, reasonCode });

export function parseLookupArgs(call, args) {
  if (!Object.hasOwn(LOOKUPS, call)) return refuse('unknown graph lookup');
  if (!object(args)) return refuse('args must be an object');
  const allowed = call === 'callers' ? ['symbol', 'file', 'anchor', 'limit'] : ['symbol', 'file', 'limit'];
  const extra = Object.keys(args).find((key) => !allowed.includes(key));
  if (extra) return refuse(`args.${extra} is not supported by ${call}`);
  const limit = args.limit === undefined ? LOOKUP_LIMIT.fallback : args.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LOOKUP_LIMIT.max) return refuse(`args.limit must be an integer from 1 to ${LOOKUP_LIMIT.max}`);
  if (args.anchor !== undefined) {
    const a = args.anchor;
    if (args.symbol !== undefined || args.file !== undefined) return refuse('give args.anchor or args.symbol with optional args.file, not both');
    if (!object(a) || a.kind !== 'symbol' || typeof a.name !== 'string' || a.name.trim() === '' || repoRelativeProblem(a.path) !== null) {
      return refuse('args.anchor must be a symbol anchor with a repository-relative path and a name');
    }
    if (Object.keys(a).some((key) => !['kind', 'path', 'name'].includes(key))) return refuse('unsupported symbol anchor field');
    return { ok: true, value: { symbol: a.name, file: a.path, qualified: true, limit } };
  }
  if (typeof args.symbol !== 'string' || args.symbol.trim() === '') return refuse('args.symbol must be a non-empty exact name');
  if (args.file !== undefined && repoRelativeProblem(args.file) !== null) return refuse('args.file must be a repository-relative path');
  return { ok: true, value: { symbol: args.symbol, file: args.file ?? null, qualified: false, limit } };
}

/** The shared snapshot remains synchronous; no freshness bootstrap or LSP trust rendering runs here. */
export function readLookup({ call, repoRoot, request, head }) {
  if (!Object.hasOwn(LOOKUPS, call)) return refuse('unknown graph lookup');
  return readAttestedSnapshot({ repoRoot, head, capture: (db) => {
    db.raw.function('provider_repo_relative', (path) => repoRelativeProblem(path) === null ? 1 : 0);
    return LOOKUPS[call](db, request);
  } });
}

function declarations(db, request, limit) {
  const params = { name: request.symbol, limit };
  if (request.file !== null) params.file = request.file;
  const where = `(label = $name ${request.qualified ? "OR json_extract(extra, '$.qname') = $name" : ''})
    AND type IN (${SEARCH_TYPES.map((t) => `'${t}'`).join(',')})
    ${request.file === null ? '' : 'AND file_path = $file'}`;
  const { limit: ignored, ...countParams } = params;
  const withheld = db.get(`SELECT count(*) AS n FROM nodes WHERE ${where} AND NOT provider_repo_relative(file_path)`, countParams).n;
  const rows = db.all(`SELECT *, count(*) OVER () AS __population FROM nodes WHERE ${where}
    AND provider_repo_relative(file_path) ORDER BY file_path, start_line, id LIMIT $limit`, params);
  return { rows, withheld };
}

function findDeclarations(db, request) {
  const { rows, withheld } = declarations(db, request, request.limit);
  const view = new GraphView(db, null);
  const matched = rows[0]?.__population ?? 0;
  return { ok: true, value: { definitions: rows.map((r) => nodeEntry(view, r)), matched,
    withheld: { outsideRepository: withheld }, truncated: matched > rows.length, searchedTypes: [...SEARCH_TYPES] } };
}

function findCallers(db, request) {
  // The window count establishes ambiguity even when the requested candidate page has only one row.
  const { rows: targets, withheld: withheldTargets } = declarations(db, request, request.limit);
  const population = targets[0]?.__population ?? 0;
  if (population === 0) return refuse(`${request.symbol} has no matching indexed declaration`, 'not_in_index');
  const view = new GraphView(db, null);
  if (population > 1) {
    return { ...refuse(`${request.symbol} names ${population} indexed declarations; choose a symbol anchor from the candidates`, 'ambiguous_anchor'),
      candidates: targets.map((t) => nodeEntry(view, t)), matched: population, truncated: population > targets.length };
  }
  const target = targets[0];
  const where = `e.to_id = $target AND e.relation IN (${EXECUTION_FAMILY.map((r) => `'${r}'`).join(',')})`;
  const withheldCallers = db.get(`SELECT count(*) AS n FROM edges e JOIN nodes n ON n.id = e.from_id
    WHERE ${where} AND NOT provider_repo_relative(n.file_path)`, { target: target.id }).n;
  const rows = db.all(`SELECT e.*, count(*) OVER () AS __population FROM edges e
    JOIN nodes n ON n.id = e.from_id
    WHERE ${where} AND provider_repo_relative(n.file_path)
    ORDER BY CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 0 ELSE 1 END,
      e.confidence DESC, n.label, n.file_path, n.start_line, e.from_id, e.relation, e.provenance
    LIMIT $limit`, { target: target.id, limit: request.limit });
  const matched = rows[0]?.__population ?? 0;
  const to = nodeEntry(view, target);
  return { ok: true, value: {
    target: to,
    callers: rows.map((e) => ({ from: nodeEntry(view, view.node(e.from_id)), to, type: e.relation,
      provenance: e.provenance ?? null, resolution: resolutionOf(e), confidence: e.confidence })),
    matched, withheld: { outsideRepository: { targets: withheldTargets, callers: withheldCallers } },
    truncated: matched > rows.length, locationKind: 'caller_declaration',
    searchedRelations: [...EXECUTION_FAMILY], unsearchedRelations: [...unsearched],
  } };
}
