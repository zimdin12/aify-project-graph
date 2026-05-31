// graph_trace (Code-Intel v2 / P1-2) — the whole call path in ONE call.
//
// Given a `from` and a `to` symbol, BFS the call graph and render the path as
// an ordered list of hops with each hop's BODY inlined verbatim (`cat -n`) via
// the shared source-bundle helper. Dynamic-dispatch hops (OVERRIDDEN_BY /
// INFERRED provenance) are annotated so the agent knows the bridge is a static
// best-effort, not ground truth; LSP_VERIFIED hops get the `[lsp✓]` marker.
//
// The borrowable gem is the FAILURE path: when no static path exists within
// max_hops (usually the chain broke at dynamic dispatch), we DON'T 404. We
// inline BOTH endpoint bodies + their callers/callees + the other top-level
// functions in the destination's file (the missing dynamic hop usually lives
// there) so the agent has everything it needs without a single Read.
//
// Reuses: symbol_lookup (resolveSymbol), source-bundle (rendering + budget),
// lsp-evidence (trust banner), read_freshness (snapshot guard). No new
// traversal primitive — a small BFS over the same CALLS/INVOKES family the
// other verbs walk, plus OVERRIDDEN_BY to bridge virtual dispatch.

import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbol } from './symbol_lookup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { buildTrustLine } from '../lsp-evidence.js';
import {
  countGraphNodes,
  getSourceBundleBudget,
  renderSourceBlock,
  SOURCE_BUNDLE_HEADER,
} from '../source-bundle.js';

// Call-graph edge families followed during the trace. CALLS/INVOKES/
// PASSES_THROUGH are the execution edges (same set the other verbs use);
// OVERRIDDEN_BY bridges a base virtual to its derived overrides so a trace can
// continue through C++ vtable dispatch that clangd/tree-sitter resolve only to
// the declared base method.
const CALL_RELATIONS = ['CALLS', 'INVOKES', 'PASSES_THROUGH'];
const BRIDGE_RELATION = 'OVERRIDDEN_BY';

// Non-canonical root penalties for path-proximity pairing. Vendored / generated
// / example trees are valid endpoints but should lose ties to first-party code.
const NONCANONICAL_PREFIXES = [
  'vendor/', 'third_party/', 'thirdparty/', '_deps/', 'external/',
  'examples/', 'example/', 'tests/', 'test/',
];

function nonCanonicalPenalty(filePath) {
  const p = (filePath || '').replace(/\\/g, '/').toLowerCase();
  for (const pref of NONCANONICAL_PREFIXES) {
    if (p.includes(pref)) {
      // tests/examples penalized lightly; vendor/deps harder.
      return /vendor|third_?party|_deps|external/.test(pref) ? 4 : 1;
    }
  }
  return 0;
}

// Shared directory-prefix length between two file paths (count of matching
// leading path segments). More shared structure → likelier the intended pair.
function sharedDirPrefixLen(a, b) {
  const pa = (a || '').replace(/\\/g, '/').split('/').slice(0, -1);
  const pb = (b || '').replace(/\\/g, '/').split('/').slice(0, -1);
  let n = 0;
  while (n < pa.length && n < pb.length && pa[n] === pb[n]) n += 1;
  return n;
}

// A node has a real body (multi-line span) → it's a definition, not a bare
// header declaration. Definitions are where call edges live, so they make far
// better trace endpoints than 1-line decls.
function hasBody(node) {
  return Number(node?.end_line) > Number(node?.start_line);
}

// Outgoing call-edge count for a node — used to prefer the definition that
// actually has callees as the `from` endpoint (a header decl has none).
function outDegree(db, nodeId) {
  if (!db || !nodeId) return 0;
  try {
    const relFilter = CALL_RELATIONS.map((r) => `'${r}'`).join(',');
    const row = db.get(
      `SELECT COUNT(*) AS c FROM edges WHERE from_id = $id AND relation IN (${relFilter})`,
      { id: nodeId },
    );
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

// Relation of a direct edge from→to if one exists (prefer the override bridge),
// else null. Cheap single-row probe used only as a pairing tie-break.
function directEdge(db, fromId, toId) {
  if (!db || !fromId || !toId) return null;
  try {
    const row = db.get(
      `SELECT relation FROM edges WHERE from_id = $f AND to_id = $t
       ORDER BY CASE relation WHEN '${BRIDGE_RELATION}' THEN 0 ELSE 1 END LIMIT 1`,
      { f: fromId, t: toId },
    );
    return row?.relation ?? null;
  } catch {
    return null;
  }
}

// Pick the best (from, to) node pair when either name is ambiguous. Score each
// candidate pair by shared directory-prefix length (higher = better), bias
// toward DEFINITIONS over bare declarations (the `from` endpoint with outgoing
// call edges is the one a trace can actually walk), and penalize non-canonical
// roots. `db` is optional — passed it can use out-degree as the strongest
// tie-breaker for the source endpoint.
export function pickBestPair(fromNodes, toNodes, db = null) {
  let best = null;
  let bestScore = -Infinity;
  for (const f of fromNodes) {
    for (const t of toNodes) {
      if (f.id === t.id) continue;
      let score = sharedDirPrefixLen(f.file_path, t.file_path) * 2
        - nonCanonicalPenalty(f.file_path)
        - nonCanonicalPenalty(t.file_path);
      // Prefer a `from` definition (has body / has callees) — a header decl is
      // a dead-end for the BFS. Strongly weighted because picking the decl is
      // the difference between a real path and a false NO-PATH.
      if (hasBody(f)) score += 3;
      if (hasBody(t)) score += 1;
      if (db) score += Math.min(3, outDegree(db, f.id));
      // Strongest signal: a DIRECT edge already connects this exact pair — the
      // agent almost certainly meant these two nodes. An OVERRIDDEN_BY bridge
      // (base virtual → its override) scores highest so a base→override trace
      // is reachable even when both share the method name.
      if (db) {
        const direct = directEdge(db, f.id, t.id);
        if (direct === BRIDGE_RELATION) score += 8;
        else if (direct) score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { from: f, to: t };
      }
    }
  }
  // Degenerate: only one node each (or all same id) — fall back to first pair.
  if (!best && fromNodes.length && toNodes.length) {
    best = { from: fromNodes[0], to: toNodes[0] };
  }
  return best;
}

// One forward step from a node id. Returns rows with the navigable fields plus
// the relation/provenance so the renderer can annotate virtual/verified hops.
function outgoing(db, nodeId) {
  const relFilter = CALL_RELATIONS.map((r) => `'${r}'`).join(',');
  const callEdges = db.all(
    `SELECT e.to_id, e.relation, e.provenance, n.label, n.type, n.file_path, n.start_line, n.end_line
     FROM edges e JOIN nodes n ON n.id = e.to_id
     WHERE e.from_id = $id AND e.relation IN (${relFilter})
     LIMIT 200`,
    { id: nodeId },
  );
  const bridgeEdges = db.all(
    `SELECT e.to_id, e.relation, e.provenance, n.label, n.type, n.file_path, n.start_line, n.end_line
     FROM edges e JOIN nodes n ON n.id = e.to_id
     WHERE e.from_id = $id AND e.relation = '${BRIDGE_RELATION}'
     LIMIT 200`,
    { id: nodeId },
  );
  return [...callEdges, ...bridgeEdges];
}

// BFS from `fromId` to `toId` over the call-graph + override-bridge edges,
// capped at maxHops. Returns the hop list (each carries the edge that REACHED
// it) or null if no path within the cap. A confident-but-wrong 15-hop trace is
// worse than none, so we reject anything longer than max_hops outright.
export function bfsTrace(db, fromId, toId, maxHops) {
  if (fromId === toId) return [];
  const visited = new Set([fromId]);
  // queue items: { id, path: [{ ...edge }] }
  let frontier = [{ id: fromId, path: [] }];
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = [];
    for (const item of frontier) {
      for (const edge of outgoing(db, item.id)) {
        if (visited.has(edge.to_id)) continue;
        visited.add(edge.to_id);
        const step = {
          to_id: edge.to_id,
          relation: edge.relation,
          provenance: edge.provenance ?? 'EXTRACTED',
          label: edge.label,
          type: edge.type,
          file_path: edge.file_path,
          start_line: edge.start_line,
          end_line: edge.end_line,
        };
        const path = [...item.path, step];
        if (edge.to_id === toId) return path;
        next.push({ id: edge.to_id, path });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}

// Render a hop's annotation suffix: [lsp✓] for verified, [virtual/override …]
// for INFERRED/OVERRIDDEN_BY dynamic dispatch.
function hopAnnotation(step) {
  if (step.provenance === 'LSP_VERIFIED') return ' [lsp✓]';
  if (step.relation === BRIDGE_RELATION || step.provenance === 'INFERRED') {
    return ' [virtual/override — INFERRED; verify with code_intel_hierarchy]';
  }
  return '';
}

function fetchNode(db, idOrNode) {
  if (idOrNode && idOrNode.id) return idOrNode;
  return db.get(
    'SELECT id, label, type, file_path, start_line, end_line FROM nodes WHERE id = $id',
    { id: idOrNode },
  );
}

// Direct callers (incoming) and callees (outgoing) of a node, for the failure
// fallback. Bounded small lists — enough to locate the missing dynamic hop.
function neighborsOf(db, nodeId, limit = 6) {
  const relFilter = CALL_RELATIONS.map((r) => `'${r}'`).join(',');
  const callers = db.all(
    `SELECT n.label, n.file_path, n.start_line FROM edges e JOIN nodes n ON n.id = e.from_id
     WHERE e.to_id = $id AND e.relation IN (${relFilter}) LIMIT $lim`,
    { id: nodeId, lim: limit },
  );
  const callees = db.all(
    `SELECT n.label, n.file_path, n.start_line FROM edges e JOIN nodes n ON n.id = e.to_id
     WHERE e.from_id = $id AND e.relation IN (${relFilter}) LIMIT $lim`,
    { id: nodeId, lim: limit },
  );
  return { callers, callees };
}

// Top-level functions/methods that live in the same file as `node` (excluding
// the node itself). The missing dynamic hop usually lives among the
// destination file's other functions, so inlining them is the failure gem.
function fileMates(db, node, limit = 6) {
  if (!node?.file_path) return [];
  return db.all(
    `SELECT id, label, file_path, start_line, end_line FROM nodes
     WHERE file_path = $fp AND id != $id AND type IN ('Function','Method')
     ORDER BY start_line LIMIT $lim`,
    { fp: node.file_path, id: node.id, lim: limit },
  );
}

function renderNeighborList(title, rows) {
  if (!rows.length) return `${title}: (none indexed)`;
  const items = rows.map((r) => `  - ${r.label} ${r.file_path}:${r.start_line ?? 0}`);
  return `${title}:\n${items.join('\n')}`;
}

export async function graphTrace({ repoRoot, from, to, max_hops = 7 }) {
  if (!from || !to) return 'ERROR: both from and to parameters are required';
  const maxHops = Math.min(Math.max(Number(max_hops) || 7, 1), 15);

  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_trace' });
  if (freshness.blocker) return freshness.blocker;

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const fromNodes = resolveSymbol(db, from);
    if (fromNodes.length === 0) return `NO MATCH for from="${from}". Try graph_search(query="${from}").`;
    const toNodes = resolveSymbol(db, to);
    if (toNodes.length === 0) return `NO MATCH for to="${to}". Try graph_search(query="${to}").`;

    // Path-proximity pairing for duplicate names (db enables the out-degree /
    // definition-preference tie-break so we don't anchor on a header decl).
    const pair = pickBestPair(fromNodes, toNodes, db);
    if (!pair) return `NO MATCH — could not pair from="${from}" with to="${to}".`;
    const fromNode = pair.from;
    const toNode = pair.to;

    const nodeCount = countGraphNodes(db);
    const budget = getSourceBundleBudget(nodeCount);

    const pathSteps = bfsTrace(db, fromNode.id, toNode.id, maxHops);

    let body;
    const trustEdges = [];

    if (pathSteps) {
      // SUCCESS — render the ordered hop path with each body inlined.
      body = renderSuccess({ db, repoRoot, fromNode, toNode, pathSteps, budget, trustEdges });
    } else {
      // FAILURE — endpoint-inlining fallback (the borrowable gem).
      body = renderFailure({ db, repoRoot, fromNode, toNode, maxHops, budget });
    }

    let trustLine = '';
    try {
      trustLine = '\n\n' + await buildTrustLine({ edges: trustEdges, db, repoRoot });
    } catch { /* defensive — never block on trust-line failure */ }

    return prefixReadWarnings(body + trustLine, freshness.warnings);
  } finally {
    db.close();
  }
}

function renderSuccess({ db, repoRoot, fromNode, toNode, pathSteps, budget, trustEdges }) {
  const lines = [];
  lines.push(`TRACE ${fromNode.label} → ${toNode.label}  (${pathSteps.length} hop${pathSteps.length === 1 ? '' : 's'})`);
  lines.push(SOURCE_BUNDLE_HEADER);
  lines.push('');

  // Hop 0 is the source node itself; subsequent entries are the reached nodes.
  const chain = [
    { label: fromNode.label, file_path: fromNode.file_path, start_line: fromNode.start_line, end_line: fromNode.end_line, relation: null, provenance: 'EXTRACTED', id: fromNode.id },
    ...pathSteps.map((s) => ({ ...s, id: s.to_id })),
  ];

  let usedLines = 0;
  chain.forEach((hop, i) => {
    const ann = i === 0 ? '' : hopAnnotation(hop);
    if (i > 0) trustEdges.push({ provenance: hop.provenance });
    const arrow = i === 0 ? 'START' : `HOP ${i} (${hop.relation})`;
    lines.push(`${arrow}: ${hop.label}${ann}`);

    const remaining = Math.max(1, budget.totalLines - usedLines);
    const perBlock = Math.min(budget.perBlockLines, remaining);
    const { text, lineCount } = renderSourceBlock({
      symbol: hop.label,
      filePath: hop.file_path,
      startLine: hop.start_line,
      endLine: hop.end_line,
      repoRoot,
      perBlockLines: perBlock,
    });
    lines.push(text);
    lines.push('');
    usedLines += lineCount;
  });

  // Last mile — the destination's own callees so the agent sees where control
  // goes next without another verb call.
  const { callees } = neighborsOf(db, toNode.id, 8);
  lines.push(renderNeighborList(`LAST MILE — ${toNode.label} callees`, callees));

  return lines.join('\n');
}

function renderFailure({ db, repoRoot, fromNode, toNode, maxHops, budget }) {
  const lines = [];
  lines.push(`TRACE ${fromNode.label} → ${toNode.label}: NO STATIC PATH within ${maxHops} hops.`);
  lines.push('The chain most likely breaks at a dynamic-dispatch (virtual / function-pointer / callback) boundary the static graph cannot cross.');
  lines.push('Inlining both endpoints + their neighbors + the destination file\'s other top-level functions (the missing hop usually lives there).');
  lines.push('No further node/Read needed for symbols shown.');
  lines.push('');
  lines.push(SOURCE_BUNDLE_HEADER);
  lines.push('');

  // Both endpoint bodies. Split the per-bundle budget across the two so neither
  // starves the other.
  const half = Math.max(1, Math.floor(budget.totalLines / 2));
  for (const [tag, node] of [['FROM', fromNode], ['TO', toNode]]) {
    const { text } = renderSourceBlock({
      symbol: `${tag}: ${node.label}`,
      filePath: node.file_path,
      startLine: node.start_line,
      endLine: node.end_line,
      repoRoot,
      perBlockLines: Math.min(budget.perBlockLines, half),
    });
    lines.push(text);
    lines.push('');
  }

  // Endpoint neighbors — callers + callees of both ends. The missing bridge is
  // usually one of these.
  const fromN = neighborsOf(db, fromNode.id, 6);
  const toN = neighborsOf(db, toNode.id, 6);
  lines.push(renderNeighborList(`${fromNode.label} callers`, fromN.callers));
  lines.push(renderNeighborList(`${fromNode.label} callees`, fromN.callees));
  lines.push(renderNeighborList(`${toNode.label} callers`, toN.callers));
  lines.push(renderNeighborList(`${toNode.label} callees`, toN.callees));
  lines.push('');

  // Destination file-mates with their bodies inlined — the failure gem.
  const mates = fileMates(db, toNode, budget.maxBlocks);
  if (mates.length) {
    lines.push(`OTHER TOP-LEVEL FUNCTIONS IN ${toNode.file_path} (the missing dynamic hop often lives here):`);
    lines.push('');
    let usedLines = 0;
    for (const mate of mates) {
      if (usedLines >= budget.totalLines) break;
      const remaining = Math.max(1, budget.totalLines - usedLines);
      const { text, lineCount } = renderSourceBlock({
        symbol: mate.label,
        filePath: mate.file_path,
        startLine: mate.start_line,
        endLine: mate.end_line,
        repoRoot,
        perBlockLines: Math.min(budget.perBlockLines, remaining),
      });
      lines.push(text);
      lines.push('');
      usedLines += lineCount;
    }
  }

  return lines.join('\n');
}
