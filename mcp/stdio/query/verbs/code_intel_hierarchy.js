// L4 (Code-Intel v2): clangd-backed CALL HIERARCHY + TYPE HIERARCHY verb.
//
// The "who calls this (transitively) / who overrides this virtual / what
// subtypes exist" capability that flat references can't answer. clangd answers
// via LSP call hierarchy (prepare → incoming/outgoing) and type hierarchy
// (prepare → subtypes/supertypes). This is the verb that resolves echoes'
// ISimDomain pure-virtual dispatch + Vulkan/volk fn-pointer hubs, where static
// tree-sitter graphs undercount.
//
// COHESION: this is NOT a bolt-on. It reuses the existing code-intel spine —
//   - getLiveSession (singleton clangd per repo) from live.js
//   - the INDEXED/BOUNDED mode matrix (APG_CLANGD_MODE)
//   - waitForIndexReady (L3) so the tree is trustworthy in INDEXED mode
//   - the same evidence contract vocabulary (ready/degraded/cause/exhaustive)
//   - the same TRUST banner vocabulary as lsp-evidence.js:
//       lsp-verified (clangd, index-ready, …)  vs
//       lsp-partial (index NOT ready — may undercount; re-collect)
//   - the same language_server_missing / language_unsupported error envelope.
//
// Output is an indented TREE (caller → caller → …) with file:line per hop,
// bounded by depth + per-level breadth caps + a total-node cap and a
// "TRUNCATED — N more" tail, so it stays budgeted and cache-stable.

import fs from 'node:fs';
import path from 'node:path';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getLiveSession } from '../../code-intel/live.js';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';
import { openExistingDb } from '../../storage/db.js';

const HINTS = {
  language_unsupported: 'no live LSP session registered for this language; supported: cpp',
  language_server_missing: 'install the language server (e.g. clangd) and ensure it is on PATH; run `apg code-intel doctor` for details',
  hierarchy_unsupported: 'this clangd build does not advertise callHierarchyProvider/typeHierarchyProvider; upgrade clangd (>=12)',
  symbol_not_found: 'no graph node matched this symbol; pass explicit file+line (and col) instead, or run graph_search',
  no_position: 'pass file+line (+col) OR a symbol name that resolves via the graph',
  internal_error: 'see message'
};

// Bounded-output caps. Budget-stable: an agent gets the shape without a flood.
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 5;
const DEFAULT_BREADTH_CAP = 25;     // max children rendered per node
const DEFAULT_TOTAL_NODES = 200;    // hard ceiling across the whole tree
const KIND_CALL = new Set(['callers', 'callees']);
const KIND_TYPE = new Set(['subtypes', 'supertypes']);

// Symbol kinds we resolve from the graph for a bare `symbol` input. Mirrors
// whereis.SEARCH_TYPES but tuned for call/type-hierarchy roots.
// No 'Struct' — cpp.js maps struct_specifier → Class, so no extractor emits a
// Struct node (review R2 phantom-Struct drop).
const RESOLVE_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type'];

function errorResponse(code, message) {
  return { status: 'error', errors: [{ code, message, hint: HINTS[code] || '' }] };
}

function latencyMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function resolveClangdMode() {
  const raw = String(process.env.APG_CLANGD_MODE || 'indexed').trim().toLowerCase();
  return raw === 'bounded' ? 'bounded' : 'indexed';
}

function resolveIndexWaitMs() {
  const raw = Number(process.env.APG_CLANGD_INDEX_WAIT_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 90000;
}

function rangeFromLsp(r) {
  if (!r) return null;
  return { start: { line: r.start.line + 1, col: r.start.character + 1 }, end: { line: r.end.line + 1, col: r.end.character + 1 } };
}

function uriToRel(uri, projectRoot) {
  try { return toRepoRelative(projectRoot, fileURLToPath(uri)); } catch { return uri; }
}

async function openIfNeeded(session, file) {
  const abs = path.isAbsolute(file) ? file : path.join(session.projectRoot, file);
  const uri = pathToFileURL(abs).toString();
  if (session.openedUris.has(uri)) return uri;
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch { /* leave empty */ }
  await session.client.didOpen(uri, session.language, text);
  session.openedUris.add(uri);
  return uri;
}

// Derive the 1-based COLUMN of a symbol's identifier on its declaration line.
// clangd's prepareCallHierarchy/prepareTypeHierarchy must be queried AT the
// identifier token; querying col 1 of the declaration line lands on the return
// type or indentation and misses the method (empty/wrong tree). Mirrors the
// cpp-clangd provider's SymbolInformation handling (cpp-clangd.js): take the
// leaf name (last `::`-segment) and find its column on the source line.
//
// `leafName` is the unqualified identifier (e.g. for "Foo::bar" pass "bar").
// `fullName` is the original symbol (may be qualified) — tried first so that a
// `A::B` written verbatim on the line resolves to the leaf inside it rather
// than an unrelated earlier occurrence of the leaf token. Returns a 1-based
// column, or 1 when the name isn't found on the line (honest fallback).
export function columnOfSymbolOnLine(srcLine, leafName, fullName) {
  if (!srcLine) return 1;
  // Prefer the qualified form when it appears verbatim (e.g. a definition
  // "bool Foo::bar(...)" — anchor on bar within the qualified spelling).
  if (fullName && fullName !== leafName) {
    const qi = srcLine.indexOf(fullName);
    if (qi >= 0) {
      const leafInQ = fullName.lastIndexOf(leafName);
      // Column of the leaf inside the qualified occurrence.
      if (leafInQ >= 0) return qi + leafInQ + 1;
      return qi + 1;
    }
  }
  if (!leafName) return 1;
  // Word-boundary match so we don't land inside a longer identifier
  // (e.g. "setVoxelRange" when looking for "setVoxel"). Fall back to a plain
  // indexOf if the boundary search misses (operators, templates, etc.).
  const re = new RegExp(`\\b${leafName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(srcLine);
  if (m) return m.index + 1;
  const idx = srcLine.indexOf(leafName);
  return idx >= 0 ? idx + 1 : 1;
}

// Resolve a bare symbol name → { file, line, col } via the graph (same source
// the other graph verbs use). The graph stores file_path + start_line but no
// column, so we READ the declaring line and locate the symbol's leaf-name token
// to derive the precise column clangd needs (defaulting col=1 silently missed
// methods — they rarely start at col 1). Accepts qualified inputs like
// "SimCoordinator::registerDomain": the graph stores the LEAF label
// ("registerDomain"), so we look up by leaf and prefer the candidate whose
// declaration line actually contains the qualifier when one is given. Returns
// null if no node matches.
export function resolveSymbolPosition({ repoRoot, symbol }) {
  let db;
  try { db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite')); }
  catch { return null; }
  try {
    const leaf = String(symbol).split('::').pop();
    const qualified = symbol !== leaf;
    const placeholders = RESOLVE_TYPES.map((t) => `'${t}'`).join(',');
    // Try the verbatim label first (some extractors may store qualified), then
    // the leaf. Pull several candidates so a qualified query can disambiguate
    // by matching the qualifier on the declaration line.
    let rows = db.all(
      `SELECT label, type, file_path, start_line FROM nodes
        WHERE label = $label AND type IN (${placeholders})
        ORDER BY CASE WHEN type IN ('Method','Function') THEN 0 ELSE 1 END, start_line`,
      { label: symbol }
    );
    if ((!rows || rows.length === 0) && qualified) {
      rows = db.all(
        `SELECT label, type, file_path, start_line FROM nodes
          WHERE label = $label AND type IN (${placeholders})
          ORDER BY CASE WHEN type IN ('Method','Function') THEN 0 ELSE 1 END, start_line`,
        { label: leaf }
      );
    }
    if (!rows || rows.length === 0) return null;

    const readLine = (filePath, line) => {
      try {
        const abs = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
        const src = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
        return src[line - 1] || '';
      } catch { return ''; }
    };

    // When the input was qualified (Foo::bar), prefer the candidate whose
    // declaration line actually contains the qualified spelling (the out-of-line
    // definition "Foo::bar(...)") so callers/overriders resolve on the real body
    // rather than a header forward-decl. Fall back to the first candidate.
    let chosen = null;
    if (qualified) {
      for (const r of rows) {
        if (!r.file_path || !r.start_line) continue;
        const srcLine = readLine(r.file_path, r.start_line);
        if (srcLine.includes(symbol)) { chosen = { ...r, srcLine }; break; }
      }
    }
    if (!chosen) {
      const r = rows.find((x) => x.file_path && x.start_line);
      if (!r) return null;
      chosen = { ...r, srcLine: readLine(r.file_path, r.start_line) };
    }

    const col = columnOfSymbolOnLine(chosen.srcLine, leaf, symbol);
    return { file: chosen.file_path, line: chosen.start_line, col };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// Label a CallHierarchyItem / TypeHierarchyItem for tree rendering.
function itemLabel(item, projectRoot) {
  const name = item?.name || '<anon>';
  const detail = item?.detail ? ` ${item.detail}` : '';
  const uri = item?.uri || item?.selectionRange?.uri;
  const file = uri ? uriToRel(uri, projectRoot) : '?';
  // selectionRange points at the name; range is the whole decl. Prefer
  // selectionRange for the file:line hop the agent jumps to.
  const sel = item?.selectionRange || item?.range;
  const line = sel?.start ? sel.start.line + 1 : '?';
  return { name, detail, file, line, key: `${file}:${line}:${name}` };
}

// Build the evidence contract for a hierarchy result. Mirrors the
// references/definitions contract vocabulary (ready/degraded/cause/exhaustive)
// so an agent reads the SAME field to decide if an absence is trustworthy.
//   indexReady === true  → exhaustive:true  (the tree is complete to `depth`)
//   indexReady === false → degraded, cause:cold_index, exhaustive:false
//   bounded mode         → degraded, cause:bounded_mode, exhaustive:false
//                          (never claims completeness — fast inner loop)
export function buildHierarchyEvidence({ mode, indexReady, nodeCount }) {
  if (mode === 'bounded') {
    return {
      ready: false, degraded: true, cause: 'bounded_mode', confidence: 'medium',
      exhaustive: false,
      fallback: 'bounded mode never waits for the index — re-run in INDEXED mode (unset APG_CLANGD_MODE) for an exhaustive tree',
      warnings: ['bounded mode: tree may undercount cross-TU callers/overrides']
    };
  }
  if (indexReady === true) {
    return { ready: true, degraded: false, cause: null, confidence: 'high', exhaustive: true, fallback: null, warnings: [] };
  }
  // INDEXED mode but the index never reached idle within budget.
  return {
    ready: false, degraded: true, cause: 'cold_index', confidence: 'low',
    exhaustive: false,
    fallback: 'clangd index not ready within budget — raise APG_CLANGD_INDEX_WAIT_MS / waitForReadyMs and re-run; absence claims unsafe',
    warnings: ['index NOT ready — tree may undercount; re-collect']
  };
}

// Single-line TRUST banner, same vocabulary as lsp-evidence.js buildTrustLine,
// but derived from the LIVE session's index-ready state (not a collection row).
export function buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount }) {
  const noun = (kind === 'subtypes' || kind === 'supertypes') ? 'type' : 'call';
  if (mode === 'bounded') {
    return `TRUST: lsp-partial (clangd, bounded mode — no index wait; may undercount ${noun} hierarchy; re-run INDEXED) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
  }
  if (indexReady === true) {
    return `TRUST: lsp-verified (clangd, index-ready, ${noun} hierarchy, ${nodeCount} node${nodeCount === 1 ? '' : 's'})`;
  }
  return `TRUST: lsp-partial (clangd index NOT ready — may undercount; re-collect) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
}

// Walk the call hierarchy from a root CallHierarchyItem to `depth`, capping
// breadth per level and total nodes. Returns the root tree node:
//   { label, file, line, children:[…], truncated:N }
// `direction` is 'callers' (incomingCalls) or 'callees' (outgoingCalls).
async function walkCallHierarchy(session, rootItem, { direction, depth, breadthCap, totalCap, projectRoot }) {
  const root = { ...itemLabel(rootItem, projectRoot), children: [], truncated: 0 };
  const budget = { nodes: 1 };
  const seen = new Set([root.key]); // cycle guard (recursion / virtual loops)

  async function expand(item, node, level) {
    if (level >= depth) return;
    if (budget.nodes >= totalCap) return;
    let edges;
    try {
      edges = direction === 'callers'
        ? await session.client.incomingCalls(item)
        : await session.client.outgoingCalls(item);
    } catch { edges = []; }
    edges = Array.isArray(edges) ? edges : [];
    const capped = edges.slice(0, breadthCap);
    node.truncated = Math.max(0, edges.length - capped.length);
    for (const edge of capped) {
      if (budget.nodes >= totalCap) {
        node.truncated += 1;
        continue;
      }
      const childItem = direction === 'callers' ? edge.from : edge.to;
      if (!childItem) continue;
      const childLabel = itemLabel(childItem, projectRoot);
      const child = { ...childLabel, children: [], truncated: 0 };
      budget.nodes += 1;
      if (seen.has(child.key)) {
        child.cycle = true;
        node.children.push(child);
        continue;
      }
      seen.add(child.key);
      node.children.push(child);
      await expand(childItem, child, level + 1);
    }
  }

  await expand(rootItem, root, 0);
  return { root, nodeCount: budget.nodes };
}

// Type hierarchy is one level of subtypes/supertypes by default but we honor
// `depth` for deep inheritance chains, with the same caps.
async function walkTypeHierarchy(session, rootItem, { direction, depth, breadthCap, totalCap, projectRoot }) {
  const root = { ...itemLabel(rootItem, projectRoot), children: [], truncated: 0 };
  const budget = { nodes: 1 };
  const seen = new Set([root.key]);

  async function expand(item, node, level) {
    if (level >= depth) return;
    if (budget.nodes >= totalCap) return;
    let kids;
    try {
      kids = direction === 'subtypes'
        ? await session.client.typeHierarchySubtypes(item)
        : await session.client.typeHierarchySupertypes(item);
    } catch { kids = []; }
    kids = Array.isArray(kids) ? kids : [];
    const capped = kids.slice(0, breadthCap);
    node.truncated = Math.max(0, kids.length - capped.length);
    for (const kid of capped) {
      if (budget.nodes >= totalCap) { node.truncated += 1; continue; }
      const childLabel = itemLabel(kid, projectRoot);
      const child = { ...childLabel, children: [], truncated: 0 };
      budget.nodes += 1;
      if (seen.has(child.key)) { child.cycle = true; node.children.push(child); continue; }
      seen.add(child.key);
      node.children.push(child);
      await expand(kid, child, level + 1);
    }
  }

  await expand(rootItem, root, 0);
  return { root, nodeCount: budget.nodes };
}

// Render the tree as compact indented text. Each hop carries file:line + a
// verification mark. Budget-stable.
//
// I3 — the per-node mark must agree with the banner. `[lsp✓]` means "ground
// truth, do NOT re-grep" (server-instructions), which is only honest when the
// tree is index-ready exhaustive (INDEXED mode + indexReady===true). In bounded
// mode or a cold/not-ready index the banner says `lsp-partial … may undercount;
// re-collect`, so we use the distinct `[lsp~]` (partial) marker instead — never
// a bare `[lsp✓]` that would contradict its own banner.
function renderTree(node, { indent = '', isLast = true, isRoot = true, mark = '[lsp✓]' } = {}) {
  const lines = [];
  const branch = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
  const cycleMark = node.cycle ? ' (cycle)' : '';
  const detail = node.detail ? node.detail : '';
  lines.push(`${indent}${branch}${node.name}${detail}  ${node.file}:${node.line} ${mark}${cycleMark}`);
  const childIndent = isRoot ? '' : indent + (isLast ? '   ' : '│  ');
  const kids = node.children || [];
  kids.forEach((child, i) => {
    const last = i === kids.length - 1 && (!node.truncated || node.truncated === 0);
    lines.push(...renderTree(child, { indent: childIndent, isLast: last, isRoot: false, mark }));
  });
  if (node.truncated && node.truncated > 0) {
    lines.push(`${childIndent}└─ … TRUNCATED — ${node.truncated} more`);
  }
  return lines;
}

/**
 * code_intel_hierarchy — clangd call/type hierarchy.
 * Inputs: { repo|repoRoot, file?, line?, col?, symbol?, kind, depth?, breadthCap?, totalCap?, waitForReadyMs?, spawn? }
 *   kind: 'callers' | 'callees' | 'subtypes' | 'supertypes'
 *   Resolve position from explicit file+line(+col) OR a symbol name (graph).
 */
export async function codeIntelHierarchy(args = {}) {
  const startedAt = Date.now();
  const {
    language = 'cpp',
    kind,
    symbol,
    depth: depthArg,
    breadthCap: breadthArg,
    totalCap: totalArg,
    waitForReadyMs,
    spawn
  } = args;
  const repoRoot = args.repoRoot || args.repo;
  let { file, line, col } = args;

  if (!repoRoot) return errorResponse('internal_error', 'repo (repoRoot) required');
  if (!kind || (!KIND_CALL.has(kind) && !KIND_TYPE.has(kind))) {
    return errorResponse('internal_error', `kind must be one of callers|callees|subtypes|supertypes (got ${JSON.stringify(kind)})`);
  }

  // Position resolution: explicit file+line wins; else resolve the symbol via
  // the graph (like the other graph verbs).
  if (!(file && line)) {
    if (!symbol) return errorResponse('no_position', 'pass file+line (+col) OR symbol');
    const resolved = resolveSymbolPosition({ repoRoot, symbol });
    if (!resolved) return errorResponse('symbol_not_found', `could not resolve symbol "${symbol}" to a position via the graph`);
    file = resolved.file; line = resolved.line; col = resolved.col;
  }

  const depth = Math.min(Math.max(Number(depthArg) || DEFAULT_DEPTH, 1), MAX_DEPTH);
  const breadthCap = Math.min(Math.max(Number(breadthArg) || DEFAULT_BREADTH_CAP, 1), 100);
  const totalCap = Math.min(Math.max(Number(totalArg) || DEFAULT_TOTAL_NODES, 1), 1000);

  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  // Open the anchor file so clangd has the TU loaded.
  const uri = await openIfNeeded(session, file);

  // Mode matrix + readiness — mirror the provider. In INDEXED mode wait for the
  // background index to go idle so the tree is trustworthy (exhaustive). In
  // BOUNDED mode skip the wait (fast inner loop; banner says lsp-partial).
  const mode = resolveClangdMode();
  let indexReady = null;
  let indexWaitMs = 0;
  let indexWaitReason = 'skipped_bounded_mode';
  if (mode === 'indexed' && typeof session.client.waitForIndexReady === 'function') {
    const budget = Number.isFinite(waitForReadyMs) ? Math.max(0, waitForReadyMs) : resolveIndexWaitMs();
    try {
      const r = await session.client.waitForIndexReady({ timeoutMs: budget });
      indexReady = !!r.ready;
      indexWaitMs = r.waitMs;
      indexWaitReason = r.reason;
    } catch {
      indexReady = false;
      indexWaitReason = 'index_wait_error';
    }
  }

  // Capability check — older clangd may not advertise the providers.
  const needsCall = KIND_CALL.has(kind);
  if (needsCall && session.client.supportsCallHierarchy && !session.client.supportsCallHierarchy()) {
    return errorResponse('hierarchy_unsupported', 'server does not advertise callHierarchyProvider');
  }
  if (!needsCall && session.client.supportsTypeHierarchy && !session.client.supportsTypeHierarchy()) {
    return errorResponse('hierarchy_unsupported', 'server does not advertise typeHierarchyProvider');
  }

  const pos = { line: line - 1, character: (col || 1) - 1 };

  // Prepare the hierarchy root(s).
  let items;
  try {
    items = needsCall
      ? await session.client.prepareCallHierarchy(uri, pos)
      : await session.client.prepareTypeHierarchy(uri, pos);
  } catch (err) {
    return errorResponse('internal_error', `prepare ${needsCall ? 'call' : 'type'} hierarchy failed: ${err.message}`);
  }
  items = Array.isArray(items) ? items : (items ? [items] : []);

  const evidence = buildHierarchyEvidence({ mode, indexReady, nodeCount: 0 });

  if (items.length === 0) {
    return {
      status: 'ok',
      kind,
      anchor: { file, line, col: col || 1, symbol: symbol || null },
      mode,
      indexReady,
      tree: null,
      treeText: `(no ${needsCall ? 'call' : 'type'} hierarchy root at ${file}:${line}:${col || 1})`,
      trust: buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount: 0 }),
      evidence,
      telemetry: {
        operation: 'hierarchy', kind, nodes: 0, depth, breadthCap, totalCap,
        latencyMs: latencyMs(startedAt), mode, indexReady, indexWaitMs, indexWaitReason
      }
    };
  }

  // Walk from the first resolved root (clangd usually returns one; multiple
  // means overload sets — we take the first to stay budgeted, and note it).
  const rootItem = items[0];
  const walkOpts = { depth, breadthCap, totalCap, projectRoot: repoRoot };
  let walked;
  if (needsCall) {
    walked = await walkCallHierarchy(session, rootItem, { ...walkOpts, direction: kind });
  } else {
    walked = await walkTypeHierarchy(session, rootItem, { ...walkOpts, direction: kind });
  }

  const nodeCount = walked.nodeCount;
  const finalEvidence = buildHierarchyEvidence({ mode, indexReady, nodeCount });
  const trust = buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount });
  // I3 — only stamp the ground-truth `[lsp✓]` when the tree is index-ready
  // exhaustive (INDEXED mode + indexReady===true). Otherwise the banner is
  // lsp-partial, so use the distinct partial marker `[lsp~]`.
  const nodeMark = (mode === 'indexed' && indexReady === true) ? '[lsp✓]' : '[lsp~]';
  const treeText = [
    `${kind.toUpperCase()} of ${rootItem.name || symbol || file} (depth ${depth})`,
    ...renderTree(walked.root, { isRoot: true, mark: nodeMark }),
    trust
  ].join('\n');

  return {
    status: 'ok',
    kind,
    anchor: { file, line, col: col || 1, symbol: symbol || null },
    mode,
    indexReady,
    roots: items.length,
    tree: walked.root,
    treeText,
    trust,
    evidence: finalEvidence,
    telemetry: {
      operation: 'hierarchy', kind, nodes: nodeCount, roots: items.length,
      depth, breadthCap, totalCap, latencyMs: latencyMs(startedAt),
      mode, indexReady, indexWaitMs, indexWaitReason
    }
  };
}
