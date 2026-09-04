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
import { readFileSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbol } from './symbol_lookup.js';
import { scanDynamicBoundaries, renderDynamicBoundaries, readSymbolBody } from '../dynamic-boundaries.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { buildTrustLine, buildAbsenceTrustLine, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';
import { indexedScopePhrase } from '../miss-scope.js';
import {
  countGraphNodes,
  getSourceBundleBudget,
  renderSourceBlock,
  manifestIndexedAtMs,
  SOURCE_BUNDLE_HEADER,
} from '../source-bundle.js';
import { EXECUTION_FAMILY } from '../../storage/taxonomy.js';
import { buildEvidenceBlock } from './packet-evidence.js';

// Call-graph edge families followed during the trace. CALLS/INVOKES/
// PASSES_THROUGH are the execution edges (the registry EXECUTION_FAMILY — the
// same set the other verbs use); OVERRIDDEN_BY bridges a base virtual to its
// derived overrides so a trace can continue through C++ vtable dispatch that
// clangd/tree-sitter resolve only to the declared base method.
const CALL_RELATIONS = EXECUTION_FAMILY;
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

// ★ A HOP THAT RESOLVES TO A HEADER DECLARATION ENDS THE INVESTIGATION AT THE
// PROTOTYPE — UNDER A BANNER TELLING THE READER NOT TO LOOK FURTHER.
//
// the field test, on real C++, 2026-08-11. `ChunkManager::setVoxel →
// WorldBuffer::writeSingleVoxelGpu` resolved hop 1 to `WorldBuffer.h:580`:
//
//     void writeSingleVoxelGpu(int slot, int localX, ..., uint8_t material);
//     LAST MILE — writeSingleVoxelGpu callees: (none indexed)
//
// One line of prototype, beneath "treat each block as a Read you have ALREADY
// performed; do not Read a file shown here". The implementation is
// `WorldBuffer.cpp:2151` — ~50 lines that wait on a fence, record a command buffer,
// push constants and dispatch. So the trace terminated exactly where the work is,
// and "callees: none indexed" was true of the prototype and false of the function.
//
// ★ It was also INCONSISTENT, which is what makes it a bug rather than a policy: an
// OVERRIDDEN_BY hop in the same session resolved to the .cpp definition with a full
// body and populated callees. Same verb, same repo — CALLS went to the header,
// OVERRIDDEN_BY to the implementation.
//
// ⚠ AND NO FIXTURE I OWN COULD HAVE PRODUCED IT. JS has no header/implementation
// split. Third defect this cycle invisible to a JS fixture while the tool is used
// mainly on C++ — see tests/fixtures/cpp-split for the corpus that closes that gap.
function definitionFor(db, node) {
  if (!db || !node || hasBody(node)) return node;
  try {
    const rows = db.all(
      `SELECT id, label, file_path, start_line, end_line FROM nodes
       WHERE label = $label AND end_line > start_line
       ORDER BY (CASE WHEN file_path LIKE '%.h' OR file_path LIKE '%.hpp' OR file_path LIKE '%.hxx' THEN 1 ELSE 0 END),
                (end_line - start_line) DESC
       LIMIT 1`,
      { label: node.label },
    );
    return rows.length ? { ...node, ...rows[0], resolvedFromDeclaration: node.file_path } : node;
  } catch {
    return node;
  }
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
    // ⛔ THREE HAND-ROLLED NOT-FOUNDS. Like graph_consequences, this verb never routed through
    // noMatchMessage, so the staleness caveat added to callers/callees/impact never reached it. A
    // stale index makes any of these three a false claim about the repository.
    const notFound = (msg) => [msg, staleNotFoundCaveat(freshness)].filter(Boolean).join('\n');
    if (fromNodes.length === 0) return notFound(`NO MATCH for from="${from}". Try graph_search(query="${from}").`);
    const toNodes = resolveSymbol(db, to);
    if (toNodes.length === 0) return notFound(`NO MATCH for to="${to}". Try graph_search(query="${to}").`);

    // Path-proximity pairing for duplicate names (db enables the out-degree /
    // definition-preference tie-break so we don't anchor on a header decl).
    const pair = pickBestPair(fromNodes, toNodes, db);
    if (!pair) return notFound(`NO MATCH — could not pair from="${from}" with to="${to}".`);
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

    // ⛔ "NO STATIC PATH" IS AN ABSENCE CLAIM AND IT WAS GETTING THE PRESENCE CAVEAT.
    //
    // Both branches called buildTrustLine. With `trustEdges` empty — which is exactly the no-path
    // case — that returns HEURISTIC_TRUST_LINE, whose warning is about OVERCOUNTING: tree-sitter
    // "resolves calls BY NAME, so a common name" collides. That is the right caveat for a result
    // that CONTAINS edges and the wrong one for a result that contains none.
    //
    // A reader here is deciding whether A reaches B, and "no path" reads as licence to change A.
    // What they need is the spine's SCOPE — was there a collection, how much of the repo did it
    // cover, was there a compile DB — not a caution about name collisions in edges we did not
    // return. buildAbsenceTrustLine carries that; buildTrustLine never did.
    let trustLine = '';
    try {
      trustLine = '\n\n' + (pathSteps
        ? await buildTrustLine({ edges: trustEdges, db, repoRoot })
        : await buildAbsenceTrustLine({ noun: 'path', db, repoRoot, freshness, language: fromNodes[0]?.language }));
    // ⛔ Still never BLOCKS on a trust-line failure — but no longer stays silent about it. An empty
    // string here shipped a bare "NO STATIC PATH", which reads as licence to change A.
    //
    // ⚠ AND THE NOUN FOLLOWS THE BRANCH. This catch serves BOTH calls above, and my first version
    // assigned the ABSENCE wording unconditionally — so a run that DID find a path was told "do not
    // read this as evidence of no callers", which is about the wrong thing entirely. Same wrong-noun
    // class that produced the two constants in the first place.
    } catch { trustLine = '\n\n' + (pathSteps ? RESULTS_TRUST_UNAVAILABLE : ABSENCE_TRUST_UNAVAILABLE); }

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
  // ★ A DECLARATION AND ITS DEFINITION CAN COLLAPSE ONTO THE SAME NODE.
  //
  // the field test, on real C++ after the declaration fix: an interface→impl trace rendered
  // `WorldBufferDomain.cpp:132-144` at START **and** at HOP 1 — the same 13 lines twice
  // in a one-hop trace. Before the fix START showed the one-line declaration: wrong, but
  // distinct. Resolving both to the definition made them identical, and on a large
  // function that doubles the payload for zero information.
  //
  // The provenance line still prints for each — that is real and differs — but the body
  // is emitted once. Tracked by resolved node identity rather than by index, so it holds
  // for any pair of hops that land on the same definition, not just START/HOP 1.
  const renderedNodes = new Set();
  chain.forEach((rawHop, i) => {
    // Prefer the DEFINITION over a header declaration. If none exists in the graph the
    // declaration is returned unchanged and is annotated below, so the reader is never
    // silently handed a prototype.
    const hop = definitionFor(db, rawHop);
    const ann = i === 0 ? '' : hopAnnotation(hop);
    if (i > 0) trustEdges.push({ provenance: hop.provenance });
    const arrow = i === 0 ? 'START' : `HOP ${i} (${hop.relation})`;
    lines.push(`${arrow}: ${hop.label}${ann}`);
    if (hop.resolvedFromDeclaration) {
      lines.push(`   (resolved from the declaration at ${hop.resolvedFromDeclaration} — body shown is the definition)`);
    } else if (!hasBody(hop)) {
      // No definition in the graph. Say so, because the next line will report zero
      // callees and that absence is an artefact of resolving to a prototype, not a
      // fact about the code.
      lines.push('   ⚠ DECLARATION ONLY — no definition for this symbol is in the graph, so the body below is a'
        + ' prototype and any "callees: (none indexed)" beneath it says nothing about the real function.'
        + ' Read the implementation directly, or run graph_index if it should have been extracted.');
    }

    // Same definition already shown above — name it and move on rather than repeating
    // the body. The reader loses nothing: the location is stated and the block is
    // identical to one they have already read in this response.
    const nodeKey = `${hop.file_path}:${hop.start_line}-${hop.end_line}`;
    if (renderedNodes.has(nodeKey)) {
      lines.push(`   (body identical to the block already shown for ${nodeKey} — not repeated)`);
      lines.push('');
      return;
    }
    renderedNodes.add(nodeKey);

    const remaining = Math.max(1, budget.totalLines - usedLines);
    const perBlock = Math.min(budget.perBlockLines, remaining);
    const { text, lineCount } = renderSourceBlock({
      symbol: hop.label,
      filePath: hop.file_path,
      startLine: hop.start_line,
      endLine: hop.end_line,
      repoRoot,
      perBlockLines: perBlock,
      // Was omitted, which silently disabled the staleness check for every hop on
      // every trace — the verb that inlines the MOST source was the one verifying
      // the least.
      indexedAtMs: manifestIndexedAtMs(repoRoot),
      verifiable: hop.type !== 'File' && hop.type !== 'Directory',
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

// Read a node's body source (its start..end line range) for boundary scanning.
// Moved to ../dynamic-boundaries.js so callees/trace share one slicing rule.
const readNodeBody = readSymbolBody;

function renderFailure({ db, repoRoot, fromNode, toNode, maxHops, budget }) {
  const lines = [];
  lines.push(`TRACE ${fromNode.label} → ${toNode.label}: NO STATIC PATH within ${maxHops} hops${indexedScopePhrase(db)}.`);

  // ZERO-RESULT CAUSE HONESTY. This used to assert "the chain most likely breaks
  // at a dynamic-dispatch boundary" unconditionally — a cause never checked, on
  // every failed trace. Measured in the field on a deliberately IMPOSSIBLE pair:
  // the real reason was that the two symbols are simply unrelated, and there was
  // no branch that could say so. It sent the reader hunting a virtual dispatch
  // that does not exist.
  //
  // The scan below already answers the question, so run it FIRST and let the
  // claim follow the evidence.
  const boundaryBlocks = [];
  for (const node of [fromNode, toNode]) {
    const block = renderDynamicBoundaries(
      scanDynamicBoundaries({ source: readNodeBody(repoRoot, node), language: node.language, baseLine: node.start_line || 1 }),
      { symbolLabel: node.label },
    );
    if (block) boundaryBlocks.push(block);
  }

  // ★ THE CAUSE ANALYSIS MUST NAME THE CAUSE THE SERVER ALREADY KNOWS.
  //
  // the field test, on real C++: a NO STATIC PATH result correctly ruled out dynamic dispatch
  // and said CAUSE UNKNOWN rather than inventing one — honest — but never mentioned that
  // the repo had NO clangd collection, which is the highest-prior cause of a missing CALLS
  // edge on a C++ tree. The fact was in the payload (`codeIntel.available: false`) and
  // absent from the section whose entire job is naming causes. The trust banner said
  // "heuristic only… run graph_collect_code_intel" at the BOTTOM, disconnected from the
  // question.
  //
  // Same defect as `dirtyFilesOmitted` disagreeing with the list it summarised: two parts
  // of one response that know different things. A cause section that omits a known cause
  // is not merely incomplete — it implies the causes it lists are the candidates.
  const noCollection = (() => {
    try {
      return buildEvidenceBlock({ repoRoot })?.available === false;
    } catch { return false; }
  })();
  const collectionCause = noCollection
    ? ' ⚠ AND THE HIGHEST-PRIOR CAUSE IS PRESENT AND UNRULED-OUT: this repo has NO code-intel'
      + ' collection (codeIntel.available=false), so CALLS edges here come from tree-sitter'
      + ' heuristics only and cross-TU / template / overload call sites are routinely missed.'
      + ' Run graph_collect_code_intel before concluding the edge does not exist.'
    : '';
  lines.push((boundaryBlocks.length
    ? 'A dynamic-dispatch site WAS found in an endpoint (below) — that is the most likely place the static chain breaks.'
    : 'CAUSE UNKNOWN. Ruled out: no dynamic-dispatch site (virtual / function-pointer / callback / computed call) was found in either endpoint body, '
      + 'so this is NOT the usual dispatch-boundary case. The two symbols may simply be unrelated, or the connecting hop may lie outside the '
      + `${maxHops}-hop budget — re-run with a higher maxHops before assuming a missing edge.`) + collectionCause);
  lines.push('Inlining both endpoints + their neighbors + the destination file\'s other top-level functions (the missing hop usually lives there).');
  lines.push('No further node/Read needed for symbols shown.');
  lines.push('');

  for (const block of boundaryBlocks) { lines.push(block); lines.push(''); }

  lines.push(SOURCE_BUNDLE_HEADER);
  lines.push('');

  // Both endpoint bodies. Split the per-bundle budget across the two so neither
  // starves the other.
  const half = Math.max(1, Math.floor(budget.totalLines / 2));
  for (const [tag, node] of [['FROM', fromNode], ['TO', toNode]]) {
    const { text } = renderSourceBlock({
      // The BARE label is what gets verified; the decorated one is only shown. Passing
      // `FROM: label` as the symbol made the drift proof fire on every correct trace,
      // because that string cannot occur in source.
      symbol: node.label,
      displayAs: `${tag}: ${node.label}`,
      filePath: node.file_path,
      startLine: node.start_line,
      endLine: node.end_line,
      repoRoot,
      perBlockLines: Math.min(budget.perBlockLines, half),
      indexedAtMs: manifestIndexedAtMs(repoRoot),
      verifiable: node.type !== 'File' && node.type !== 'Directory',
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
        indexedAtMs: manifestIndexedAtMs(repoRoot),
        verifiable: mate.type !== 'File' && mate.type !== 'Directory',
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
