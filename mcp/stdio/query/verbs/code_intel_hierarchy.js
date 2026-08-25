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
import { computeCoverage, coverageCause } from '../../code-intel/coverage.js';
import { inferLanguage } from '../../code-intel/backends.js';
import { identifierColumn, leafNameOf } from '../../code-intel/identifier-position.js';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';
import { openExistingDb } from '../../storage/db.js';

const HINTS = {
  language_unsupported: 'no live LSP session registered for this language; supported: cpp',
  language_server_missing: 'install the language server (e.g. clangd) and ensure it is on PATH; run `apg code-intel doctor` for details',
  hierarchy_unsupported: 'this clangd build does not advertise callHierarchyProvider/typeHierarchyProvider; upgrade clangd (>=12)',
  symbol_not_found: 'no graph node matched this symbol; pass explicit file+line (and col) instead, or run graph_search',
  no_position: 'pass file+line (+col) OR a symbol name that resolves via the graph',
  // ★ A CALLER MISTAKE IS NOT AN INTERNAL ERROR, and "see message" is not a hint.
  // A field reviewer reported never getting a useful answer out of this verb; the
  // first thing it says on a missing required arg is that the TOOL failed
  // internally, which tells an agent to give up rather than to fix the call.
  invalid_request: 'this is a problem with the CALL, not the tool — fix the argument named in the message and retry',
  internal_error: 'the tool failed while handling a valid request; this is not something the caller can fix by changing arguments'
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

// PROVENANCE IS A PROPERTY OF THE NODE, NOT OF THE TREE.
// Every node in both walkers is built from an LSP response — the root from
// prepare{Call,Type}Hierarchy, children from incoming/outgoingCalls — so it is stamped where it
// is CONSTRUCTED. `[lsp✓]` then renders from the node's own provenance and nothing else.
//
// ⛔ WHY, per graph-senior-dev's review of 0d1fd1d: the previous repair rendered the mark from
// `mode !== 'bounded' && indexReady && nodeCount > 1`. Those constrain POPULATION COMPLETENESS,
// not whether a returned edge came from clangd. A bounded or not-yet-idle response may
// undercount while every edge it DID return is still compiler-resolved — so that predicate
// withheld a true per-edge precision mark whenever completeness was uncertain. It was the same
// precision/completeness collapse as the original defect, running in the opposite direction:
// I moved the error instead of removing it.
const LSP_PROVENANCE = 'clangd@live';

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

// Per-attempt budget for the cold-prepare retry (waiting on clangd's first
// diagnostics publish for the URI = the parse-complete signal). Kept small so a
// genuinely-rootless position costs little. Bounded mode is the low-latency
// inner loop (its whole contract is "no index wait"), so it gets a much smaller
// budget than indexed mode. Explicit env override wins for both.
function resolveColdParseWaitMs(mode) {
  const raw = Number(process.env.APG_CLANGD_COLD_PARSE_WAIT_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return mode === 'bounded' ? 600 : 1500;
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
//
// HIGH-1 (gtest-claude 2026-05-31) — the SAME false-exhaustive bug we fixed in
// graph_callers, in the live hierarchy verb's transitive path. The old contract
// claimed exhaustive whenever `indexReady===true`, REGARDLESS of whether any
// caller/callee actually resolved. So `kind=callers` on a symbol that HAS a real
// cross-TU caller but whose caller TU was not confirmably indexed returned
// "0 callers, exhaustive=true, lsp-verified" — a dangerous false absence.
// ZERO-ROOT ANCHOR DIAGNOSIS.
//
// `prepareCallHierarchy` answers about the token under the position it is given.
// When it resolves nothing, the cause is almost never "this symbol has no
// hierarchy" — it is that the position was not on an identifier. That is
// checkable with one file read, and the check is what separates a stated fact
// from the unverified cause the field report caught this verb printing.
//
// Returns null only when the file cannot be read (then we claim nothing).
export function diagnoseAnchor({ repoRoot, file, line, col, symbol }) {
  let lines;
  try {
    lines = fs.readFileSync(join(repoRoot, file), 'utf8').split(/\r?\n/u);
  } catch {
    return null;
  }
  const text = lines[line - 1];
  if (text === undefined) {
    return { verdict: 'line_out_of_range', lineCount: lines.length };
  }
  const idx = Math.max(0, (col || 1) - 1);
  const onIdentifier = /[A-Za-z0-9_$]/u.test(text[idx] ?? '');
  const leaf = symbol ? leafNameOf(symbol) : null;
  const betterCol = leaf ? identifierColumn(text, leaf) : -1;
  return {
    verdict: onIdentifier ? 'on_identifier' : 'not_on_identifier',
    onIdentifier,
    // Only ever offered when we located the symbol's own name on that line.
    suggestCol: betterCol >= 0 && betterCol !== idx ? betterCol + 1 : null,
    charAt: text[idx] ?? '(past end of line)',
    lineText: text.trim().slice(0, 120),
  };
}

export function renderAnchorDiagnosis(d, kind) {
  if (!d) return '';
  if (d.verdict === 'line_out_of_range') {
    return `\nCAUSE: the anchor line is past the end of the file (${d.lineCount} lines) — the anchor is stale. Re-resolve the symbol.`;
  }
  if (d.verdict === 'not_on_identifier') {
    const fix = d.suggestCol
      ? ` The symbol's name is at col ${d.suggestCol} on that line — retry with col=${d.suggestCol}.`
      : ' Retry with a column that lands on the symbol name.';
    return `\nCAUSE: the anchor column is not on an identifier (character there: "${d.charAt}").${fix}`;
  }
  // On an identifier and still nothing. State what was ruled out and name the
  // remaining space; do not invent a single cause we did not verify.
  const wanted = (kind === 'subtypes' || kind === 'supertypes') ? 'type' : 'callable';
  return '\nCAUSE UNKNOWN. Ruled out: the anchor IS on an identifier.'
    + ` Remaining possibilities: the token is not a ${wanted}, or it is macro-generated so the server sees no`
    + ` declaration there. The anchor line reads: ${d.lineText}`;
}

// Mirror code_intel_references' gating (buildReferencesEvidence): an EMPTY result
// is only ever exhaustive when there is POSITIVE evidence (a non-empty tree). A
// `prepareCallHierarchy` root that returns 0 incoming/outgoing on a background
// index that has not confirmably resolved the caller/callee TUs is NOT safe
// evidence of "no callers" — it is `degraded`, `exhaustive:false`, cause
// `no_incoming_unconfirmed`, exactly like references' `definition_only`.
//
//   incoming === 0 (root-only, nodeCount<=1)  → never exhaustive, even if ready
//   indexReady === true  AND non-empty        → exhaustive:true (tree complete to depth)
//   indexReady === false                      → degraded, cause:cold_index, exhaustive:false
//   bounded mode                              → degraded, cause:bounded_mode, exhaustive:false
//                                               (never claims completeness — fast inner loop)
//
// `nodeCount` is the total nodes in the walked tree (root + resolved
// callers/callees/subtypes). nodeCount<=1 means the root resolved but NOTHING
// linked to it — the "0 callers" case the thesis bug mis-reported.
export function buildHierarchyEvidence({ mode, indexReady, nodeCount, kind, coverage, truncated = 0, multiRoot = false }) {
  const noun = (kind === 'subtypes' || kind === 'supertypes') ? 'subtypes' : (kind === 'callees' ? 'callees' : 'callers');
  const empty = !(Number(nodeCount) > 1); // root-only / unresolved root → empty
  if (mode === 'bounded') {
    return {
      ready: false, degraded: true, operationallyDegraded: true, cause: 'bounded_mode', confidence: 'medium',
      exhaustive: false,
      fallback: 'bounded mode never waits for the index — re-run in INDEXED mode (unset APG_CLANGD_MODE) for an exhaustive tree',
      warnings: ['bounded mode: tree may undercount cross-TU callers/overrides']
    };
  }
  if (indexReady === true && empty) {
    // HIGH-1 — index-ready but 0 incoming/outgoing. This is the false-exhaustive
    // trap: a background index can report idle while a relevant caller TU has not
    // been confirmably resolved (LSP cross-TU resolution under the WSL/Linux-DB
    // sysroot limit). An EMPTY hierarchy is therefore NOT safe evidence of
    // absence — mirror references' definition_only: degraded, not exhaustive.
    return {
      ready: false, degraded: true, operationallyDegraded: true, cause: 'no_incoming_unconfirmed', confidence: 'low',
      exhaustive: false,
      fallback: `verify with code_intel_references (live clangd, per-symbol evidence) or rg before any "no ${noun}" / dead-code claim`,
      warnings: [`0 ${noun} is NOT safe evidence of no ${noun} — cross-TU resolution unconfirmed; verify with code_intel_references / rg`]
    };
  }
  if (indexReady === true) {
    // FALSE-EXHAUSTIVE GUARD (2026-06-02): same fix as references — index-ready +
    // a non-empty tree is NOT exhaustive when the compile DB can't cover all TUs
    // (foreign Linux/WSL DB on a host clangd, or unexpanded unity). The tree is a
    // FLOOR; transitive callers in uncovered TUs are invisible. Downgrade.
    if (coverage && coverage.complete === false) {
      return {
        ready: true, degraded: true, cause: coverageCause(coverage), confidence: 'medium',
        exhaustive: false,
        fallback: coverage.reason || `compile DB does not fully cover this repo; verify with code_intel_references / rg before any "no ${noun}" / dead-code claim`,
        warnings: [coverage.reason || `tree may undercount — compile-DB coverage incomplete; verify ${noun} with rg before delete/rename`],
      };
    }
    // Audit 2026-06-12 B3: a tree that hit the breadth/total caps (edges dropped)
    // OR an overload set where only the first root was walked is COMPLETE ONLY UP
    // TO THE CAPS — not a basis for "no callers / dead code". Downgrade exhaustive.
    if (Number(truncated) > 0 || multiRoot) {
      const bits = [];
      if (Number(truncated) > 0) bits.push(`${truncated} ${noun} dropped at the breadth/total caps`);
      if (multiRoot) bits.push('overload/multi-root set — only the first root was walked');
      const why = bits.join('; ');
      return {
        ready: true, degraded: true, operationallyDegraded: true, cause: 'truncated_to_caps', confidence: 'medium',
        exhaustive: false,
        fallback: `tree is complete only up to the caps (${why}); raise breadthCap/totalCap or verify with code_intel_references / rg before any "no ${noun}" / dead-code claim`,
        warnings: [`hierarchy truncated: ${why} — NOT exhaustive`],
      };
    }
    // FAIL-CLOSED GATE (P0-2 parity, 2026-07-26). Everything above only
    // downgrades when coverage is PROVEN incomplete (`complete === false`), so
    // undefined / null / undecided coverage fell through to exhaustive:true here
    // exactly as it used to in buildReferencesEvidence. This verb answers the
    // TRANSITIVE "who calls X" and licenses dead-code claims just as strongly,
    // so it needs the same rule: silence is not proof.
    if (coverage?.complete !== true) {
      return {
        ready: true, degraded: true, operationallyDegraded: true, cause: 'coverage_unknown', confidence: 'medium',
        exhaustive: false,
        fallback: `coverage for this query is unproven; the ${noun} tree is a FLOOR — verify with code_intel_references / rg before any "no ${noun}" / dead-code claim`,
        warnings: [`compile-DB / project coverage could not be verified — the ${noun} tree is a FLOOR, not a complete set`],
      };
    }
    // ⛔ THIS RETURNED exhaustive:true AND IT WAS THE LAST PLACE THAT COULD.
    //
    // On 2026-08-19 `code_intel_references` withdrew the exhaustive grant entirely, cause
    // `index_population_unattested`, on this reasoning (its own words):
    //
    //     "the compile DB does not report which TUs clangd actually DID index. A file present
    //      in it can still fail to compile (a missing include path is enough) and its callers
    //      are then invisible, while background indexing still reports idle."
    //
    // That reasoning applies to THIS VERB IDENTICALLY — the comment ten lines above says so:
    // hierarchy answers the transitive "who calls X" and "licenses dead-code claims just as
    // strongly". But the withdrawal reached `references` and stopped at its sibling, so the
    // gate below kept granting the certification on `coverage.complete === true`, which is
    // EXACTLY the evidence that reasoning declares insufficient.
    //
    // ⭐ AND 2026-08-25 MADE IT CONCRETE RATHER THAN THEORETICAL. A TU that fails on
    // `#include <cstddef>` has a PERFECTLY COMPLETE compile DB — coverage.complete is true —
    // and produces an empty tree, because clangd built no AST for it. Measured: 2 references
    // vs 0 on identical TUs differing only by that include. So this line could certify
    // "no callers, safe to delete" over a translation unit that never compiled.
    //
    // ⇒ Withheld on the same standing basis. A caller that cannot tell which TUs compiled
    // cannot certify an absence, whichever verb it asked.
    return {
      ready: true,
      // ⛔ `degraded` KEPT FOR COMPATIBILITY, BUT IT NO LONGER DISCRIMINATES — read
      // `operationallyDegraded` instead. graph-senior-dev, reviewing 0d1fd1d: "a flag true on
      // every successful answer is not health information." `index_population_unattested` is a
      // STANDING EPISTEMIC LIMIT — the compile DB never reports which TUs produced usable ASTs —
      // so it is true of every call and cannot mark an incident. An operational degradation is
      // something that HAPPENED to this request: a cold index, a timeout, truncation.
      degraded: true,
      operationallyDegraded: false,
      cause: 'index_population_unattested',
      confidence: 'medium',
      exhaustive: false,
      completeness: 'floor',
      precision: 'compiler_resolved',
      fallback: `the compile DB reports which TUs clangd MAY index, never which it DID — a file in it can still fail to compile (one missing include is enough) and its ${noun} are then invisible while indexing reports idle. The tree is a FLOOR of compiler-resolved results; verify with rg before any "no ${noun}" / dead-code / safe-to-delete claim.`,
      warnings: [`index population unattested — the ${noun} tree is a FLOOR, not a complete set`],
    };
  }
  // INDEXED mode but the index never reached idle within budget.
  return {
    ready: false, degraded: true, operationallyDegraded: true, cause: 'cold_index', confidence: 'low',
    exhaustive: false,
    fallback: 'clangd index not ready within budget — raise APG_CLANGD_INDEX_WAIT_MS / waitForReadyMs and re-run; absence claims unsafe',
    warnings: ['index NOT ready — tree may undercount; re-collect']
  };
}

// Single-line TRUST banner, same vocabulary as lsp-evidence.js buildTrustLine,
// but derived from the LIVE session's index-ready state (not a collection row).
export function buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount, coverage, truncated = 0, multiRoot = false }) {
  const noun = (kind === 'subtypes' || kind === 'supertypes') ? 'type' : 'call';
  const edgeNoun = (kind === 'subtypes' || kind === 'supertypes') ? 'subtypes' : (kind === 'callees' ? 'callees' : 'callers');
  const empty = !(Number(nodeCount) > 1);
  if (mode === 'bounded') {
    return `TRUST: lsp-partial (clangd, bounded mode — no index wait; may undercount ${noun} hierarchy; re-run INDEXED) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
  }
  if (indexReady === true && empty) {
    // HIGH-1 — index-ready but 0 resolved edges. Never claim "lsp-verified
    // exhaustive" on an empty tree; the absence is unconfirmed (cross-TU
    // resolution not confirmed). Say lsp-partial and point at references/rg.
    return `TRUST: lsp-partial (clangd, index-ready but 0 ${edgeNoun} — NOT safe evidence of no ${edgeNoun}; cross-TU resolution unconfirmed; verify with code_intel_references / rg) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
  }
  // FALSE-EXHAUSTIVE GUARD (2026-06-02): index-ready + a non-empty tree is NOT
  // exhaustive when the compile DB can't cover all TUs (foreign Linux/WSL DB on
  // host clangd, or unexpanded unity). MUST agree with buildHierarchyEvidence
  // (which returns partial_compile_db_coverage / exhaustive:false here) and with
  // the `[lsp~]` node mark — so the banner can't say lsp-verified while the
  // evidence + nodes say partial. Without this the banner alone falsely licenses
  // "safe to delete" on a foreign/unity DB.
  if (indexReady === true && coverage && coverage.complete === false) {
    return `TRUST: lsp-partial (clangd, index-ready but compile-DB coverage incomplete — ${noun} hierarchy is a FLOOR, may undercount; verify with code_intel_references / rg before any "no ${edgeNoun}" / delete) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
  }
  if (indexReady === true && (Number(truncated) > 0 || multiRoot)) {
    // Audit 2026-06-12 B3 — capped/overload tree is complete only up to the caps.
    const why = [Number(truncated) > 0 ? `${truncated} dropped at caps` : null, multiRoot ? 'overload set, first root only' : null].filter(Boolean).join('; ');
    return `TRUST: lsp-partial (clangd, index-ready but tree TRUNCATED — ${why}; a FLOOR, not exhaustive; raise breadthCap/totalCap or verify with code_intel_references / rg) [${nodeCount} node${nodeCount === 1 ? '' : 's'}]`;
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
  const root = { ...itemLabel(rootItem, projectRoot), children: [], truncated: 0, provenance: LSP_PROVENANCE };
  // `truncated` accumulates every edge dropped at the breadth/total caps so the
  // caller can downgrade the exhaustive claim — a capped tree is a FLOOR, not a
  // complete caller set (audit 2026-06-12 B3).
  const budget = { nodes: 1, truncated: 0 };
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
    budget.truncated += node.truncated;
    for (const edge of capped) {
      if (budget.nodes >= totalCap) {
        node.truncated += 1;
        budget.truncated += 1;
        continue;
      }
      const childItem = direction === 'callers' ? edge.from : edge.to;
      if (!childItem) continue;
      const childLabel = itemLabel(childItem, projectRoot);
      const child = { ...childLabel, children: [], truncated: 0, provenance: LSP_PROVENANCE };
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
  return { root, nodeCount: budget.nodes, truncated: budget.truncated };
}

// Type hierarchy is one level of subtypes/supertypes by default but we honor
// `depth` for deep inheritance chains, with the same caps.
async function walkTypeHierarchy(session, rootItem, { direction, depth, breadthCap, totalCap, projectRoot }) {
  const root = { ...itemLabel(rootItem, projectRoot), children: [], truncated: 0, provenance: LSP_PROVENANCE };
  const budget = { nodes: 1, truncated: 0 };
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
    budget.truncated += node.truncated;
    for (const kid of capped) {
      if (budget.nodes >= totalCap) { node.truncated += 1; budget.truncated += 1; continue; }
      const childLabel = itemLabel(kid, projectRoot);
      const child = { ...childLabel, children: [], truncated: 0, provenance: LSP_PROVENANCE };
      budget.nodes += 1;
      if (seen.has(child.key)) { child.cycle = true; node.children.push(child); continue; }
      seen.add(child.key);
      node.children.push(child);
      await expand(kid, child, level + 1);
    }
  }

  await expand(rootItem, root, 0);
  return { root, nodeCount: budget.nodes, truncated: budget.truncated };
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
export function renderTree(node, { indent = '', isLast = true, isRoot = true } = {}) {
  const lines = [];
  const branch = isRoot ? '' : (isLast ? '└─ ' : '├─ ');
  const cycleMark = node.cycle ? ' (cycle)' : '';
  const detail = node.detail ? node.detail : '';
  // Per-node, from its own provenance. A node with no LSP provenance never gets the mark,
  // whatever the tree around it claims.
  const mark = node.provenance === LSP_PROVENANCE ? '[lsp✓]' : '[lsp~]';
  lines.push(`${indent}${branch}${node.name}${detail}  ${node.file}:${node.line} ${mark}${cycleMark}`);
  const childIndent = isRoot ? '' : indent + (isLast ? '   ' : '│  ');
  const kids = node.children || [];
  kids.forEach((child, i) => {
    const last = i === kids.length - 1 && (!node.truncated || node.truncated === 0);
    lines.push(...renderTree(child, { indent: childIndent, isLast: last, isRoot: false }));
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
    language,
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

  if (!repoRoot) return errorResponse('invalid_request', 'repoRoot is required');
  if (!kind || (!KIND_CALL.has(kind) && !KIND_TYPE.has(kind))) {
    return errorResponse(
      'invalid_request',
      `kind is REQUIRED and must be one of callers|callees|subtypes|supertypes (got ${JSON.stringify(kind)}). `
      + 'Example: code_intel_hierarchy({ symbol: "MyClass::method", kind: "callers" }). '
      + 'Use callers/callees for functions and subtypes/supertypes for classes.',
    );
  }

  // Position resolution: explicit file+line wins; else resolve the symbol via
  // the graph (like the other graph verbs).
  if (!(file && line)) {
    if (!symbol) return errorResponse('no_position', 'pass file+line (+col) OR symbol');
    const resolved = resolveSymbolPosition({ repoRoot, symbol });
    if (!resolved) {
      // Carry candidates instead of redirecting. A one-character typo on a symbol
      // the graph definitely holds returned a bare "run graph_search" here — the
      // same wasted round-trip did-you-mean removed elsewhere, still live on the
      // verb a field user actually reached for (ef-manager, 2026-07-31).
      let suggestions = [];
      try {
        const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
        try { suggestions = findSimilarSymbols(db, symbol); } finally { db.close(); }
      } catch { /* suggestions are a convenience, never a new failure mode */ }
      const near = suggestions.length
        ? ` Did you mean: ${suggestions.map((s) => `${s.label} (${s.file_path}${s.start_line ? `:${s.start_line}` : ''})`).join(' · ')}`
        : '';
      const err = errorResponse('symbol_not_found', `could not resolve symbol "${symbol}" to a position via the graph.${near}`);
      if (suggestions.length) err.suggestions = suggestions.map((s) => ({ symbol: s.label, file: s.file_path, line: s.start_line }));
      return err;
    }
    file = resolved.file; line = resolved.line; col = resolved.col;
  }

  const depth = Math.min(Math.max(Number(depthArg) || DEFAULT_DEPTH, 1), MAX_DEPTH);
  const breadthCap = Math.min(Math.max(Number(breadthArg) || DEFAULT_BREADTH_CAP, 1), 100);
  const totalCap = Math.min(Math.max(Number(totalArg) || DEFAULT_TOTAL_NODES, 1), 1000);

  // Explicit language wins; else infer from the file extension; else default cpp.
  const lang = language || inferLanguage(file) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  // FALSE-EXHAUSTIVE GUARD: per-language coverage gates the exhaustive claim (a
  // foreign/unity C++ DB, a no-tsconfig TS project, or Python's dynamic dispatch
  // all yield a silently-partial index). Best-effort.
  // Pass `file` so TS coverage verifies the file is inside the nearest tsconfig
  // project, and FAIL CLOSED on a detection error (audit 2026-06-12) — a missing
  // guard must never let a partial index earn an exhaustive hierarchy claim.
  let coverage = null;
  try { coverage = computeCoverage({ language: lang, projectRoot: repoRoot, file }); }
  catch { coverage = { complete: false, partial: true, kind: 'unknown', foreignToolchain: false, unityUnexpanded: false, reason: 'coverage detection failed — treating as partial (fail-closed)' }; }

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

  // Prepare the hierarchy root(s). COLD-INDEX FIX (2026-06-02): clangd often
  // returns NO ROOT on the first call against a freshly-opened file because
  // didOpen returns immediately and the file's AST has not been built yet (even
  // when the *background index* reports idle — that's cross-TU, not this TU's
  // ASTWorker). The eval saw this as a false "no call hierarchy root" on cold
  // clangd. When the root is empty and the index/AST is not confirmed ready,
  // wait for clangd's first diagnostics publish on this URI (the parse-complete
  // signal) and retry the prepare. A confirmed-ready index skips the retry, so a
  // genuinely-rootless position (not a function/type) stays cheap.
  const prepareRoots = async () => {
    const r = needsCall
      ? await session.client.prepareCallHierarchy(uri, pos)
      : await session.client.prepareTypeHierarchy(uri, pos);
    return Array.isArray(r) ? r : (r ? [r] : []);
  };
  let items;
  let coldPrepareRetries = 0;
  try {
    items = await prepareRoots();
    const canWaitParse = typeof session.client.waitForDiagnostics === 'function'
      && typeof session.client.diagnosticPublishCount === 'function';
    // Retry ONLY while clangd has not yet published diagnostics for this URI —
    // publishCount === 0 means the file's AST is not built yet (the real cold
    // race). Once any publish lands, an empty root is genuine and we stop, so
    // this costs at most one parse-wait and never delays a warm file or a truly
    // rootless position on an already-parsed TU. (A confirmed-ready background
    // index does NOT imply this file's ASTWorker has finished — hence we gate on
    // the per-file publish, not indexReady.)
    while (items.length === 0 && coldPrepareRetries < 2 && canWaitParse
        && session.client.diagnosticPublishCount(uri) === 0) {
      const parsed = await session.client.waitForDiagnostics(uri, 0, resolveColdParseWaitMs(mode));
      if (!parsed) break; // no parse signal within budget — treat as genuinely empty
      items = await prepareRoots();
      coldPrepareRetries++;
    }
  } catch (err) {
    return errorResponse('internal_error', `prepare ${needsCall ? 'call' : 'type'} hierarchy failed: ${err.message}`);
  }

  const evidence = buildHierarchyEvidence({ mode, indexReady, nodeCount: 0, kind, coverage });

  if (items.length === 0) {
    // ROOT DEFECT, LAST INSTANCE (field report 2026-07-27): a zero-result path
    // must state what it KNOWS and what it RULED OUT, never a cause nobody
    // checked. "no call hierarchy root at f:l:c" reads as "this symbol has no
    // callers", which is a completeness claim we did not make and cannot support.
    //
    // The overwhelmingly common reason a prepare resolves nothing is that the
    // POSITION IS NOT ON AN IDENTIFIER — the same class of bug that made
    // identifier-position.js necessary. That is checkable in one file read, and
    // checking it turns a dead end into a corrected call.
    const diagnosis = diagnoseAnchor({ repoRoot, file, line, col: col || 1, symbol });
    const anchorNote = renderAnchorDiagnosis(diagnosis, kind);
    return {
      status: 'ok',
      kind,
      anchor: { file, line, col: col || 1, symbol: symbol || null },
      mode,
      indexReady,
      tree: null,
      // Distinguish a confirmed-empty root from one we could not confirm because
      // clangd was still cold (no parse signal within the retry budget). The
      // latter is a "retry"/"warm the index" signal, NOT "this symbol has no
      // hierarchy" — surfacing it stops an agent reading cold as absence.
      treeText: (indexReady === true)
        ? `(no ${needsCall ? 'call' : 'type'} hierarchy root at ${file}:${line}:${col || 1})${anchorNote}`
        : `(no ${needsCall ? 'call' : 'type'} hierarchy root resolved at ${file}:${line}:${col || 1} — clangd index/AST not confirmed ready${coldPrepareRetries ? ` after ${coldPrepareRetries} parse-wait retr${coldPrepareRetries === 1 ? 'y' : 'ies'}` : ''}; re-run in INDEXED mode or after warmup before treating this as "no hierarchy")${anchorNote}`,
      trust: buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount: 0, coverage }),
      evidence,
      telemetry: {
        operation: 'hierarchy', kind, nodes: 0, depth, breadthCap, totalCap,
        latencyMs: latencyMs(startedAt), mode, indexReady, indexWaitMs, indexWaitReason,
        coldPrepareRetries
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
  const truncated = walked.truncated || 0;
  const multiRoot = items.length > 1;
  const finalEvidence = buildHierarchyEvidence({ mode, indexReady, nodeCount, kind, coverage, truncated, multiRoot });
  const trust = buildHierarchyTrustLine({ mode, indexReady, kind, nodeCount, coverage, truncated, multiRoot });
  // I3 + HIGH-1 — stamp the ground-truth `[lsp✓]` only on a tree whose edges really are
  // compiler-resolved: INDEXED mode, index ready, and a non-empty resolved tree. An
  // index-ready-but-empty tree stays lsp-partial (no_incoming_unconfirmed), so its marker is
  // the distinct `[lsp~]` and never contradicts its own banner.
  //
  // ⛔ THIS USED TO READ `finalEvidence.exhaustive ? ...` AND WITHDRAWING exhaustive MADE THE
  // GROUND-TRUTH MARK UNREACHABLE. Caught by six red tests, not by reading.
  //
  // The mark and the banner answer DIFFERENT QUESTIONS, and collapsing them was the bug:
  //   `[lsp✓]` per node  — PRECISION: this edge came from the compiler, do not re-grep it.
  //   banner/exhaustive  — COMPLETENESS: is this the whole set?
  // Precision survives the withdrawal intact. Completeness does not. THE-GOAL states the rule
  // this violated — "precision and exhaustiveness are orthogonal, never let one become the
  // other" — and gating the per-edge mark on the set claim did exactly that: it would have
  // stripped a TRUE signal from every edge to express a doubt about the set.
  // (no tree-wide mark: renderTree reads each node's own provenance — see LSP_PROVENANCE)
  const treeText = [
    `${kind.toUpperCase()} of ${rootItem.name || symbol || file} (depth ${depth})`,
    // Overload/multi-root sets: we walk only the first root to stay budgeted —
    // say so, since callers of the OTHER overloads are absent from this tree.
    ...(multiRoot ? [`(note: ${items.length} hierarchy roots resolved — overload/multi-decl set; only the first was walked; the others' ${kind} are NOT shown)`] : []),
    ...renderTree(walked.root, { isRoot: true }),
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
      mode, indexReady, indexWaitMs, indexWaitReason, coldPrepareRetries
    }
  };
}
