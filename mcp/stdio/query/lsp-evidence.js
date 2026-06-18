// Shared LSP-evidence trust-banner logic (Code-Intel v2 / L2b).
//
// One place — consumed by graph_callers / graph_impact / graph_callees /
// graph_neighbors — so the trust line can't drift between verbs (cohesive,
// not copy-pasted).
//
// Per the Hermes tech-lead review: LSP_VERIFIED (clangd ground truth) must
// never read as equal to a heuristic edge, and an absence / "no callers"
// claim is only trustworthy when backed by FRESH lsp evidence. So this module
// returns exactly one of two banner shapes:
//
//   lsp-verified — the symbol has ≥1 LSP_VERIFIED edge in this result. We name
//     the clangd compile-db hash + how long ago it was collected, and append a
//     "— STALE, re-collect" caveat when the collection is stale vs current HEAD
//     or the compile_db changed. Stale evidence is a visible caveat, never a
//     silent pass.
//
//   heuristic — no LSP_VERIFIED edge for the symbol. We keep/strengthen the
//     existing tree-sitter undercount caveat and point at graph_collect_code_intel
//     / rg, because tree-sitter undercounts C++ virtual / cross-TU dispatch.
//
// The banner is always ONE line (budget-stable). It is derived from the edges
// already loaded by the verb plus the latest code_intel_collections row, so no
// extra graph traversal is needed.

import { getLatestCollection } from '../code-intel/query.js';
import { getHeadCommit } from '../freshness/git.js';
import { computeCoverage } from '../code-intel/coverage.js';

const LSP_PROVENANCE = 'LSP_VERIFIED';

// True if any edge in the result is clangd ground truth.
export function hasLspVerifiedEdge(edges = []) {
  return edges.some((e) => e?.provenance === LSP_PROVENANCE);
}

// Count of clangd ground-truth edges in the result (the "N callers" the
// banner can honestly attribute to clangd).
export function lspVerifiedEdgeCount(edges = []) {
  return edges.reduce((n, e) => (e?.provenance === LSP_PROVENANCE ? n + 1 : n), 0);
}

// Short hash for display. The clangd extractor tags edges `cpp-clangd#<dbhash8>`
// and the collection row carries the full compile_db_hash; we show 8 chars.
function hash8(value) {
  if (!value) return '????????';
  return String(value).slice(0, 8);
}

// Coarse relative-time string ("just now", "5m ago", "3h ago", "2d ago").
// Coarser than a raw ISO date and good enough for a freshness signal.
function relativeTime(iso) {
  if (!iso) return 'unknown time';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown time';
  const secs = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// The heuristic-only undercount caveat. Identical wording everywhere so the
// callers/impact/callees/neighbors footers can't drift. ONE line.
export const HEURISTIC_TRUST_LINE =
  'TRUST: heuristic only (tree-sitter) — may undercount C++ virtual/cross-TU '
  + 'dispatch; run graph_collect_code_intel for exhaustive clangd evidence, or verify with rg';

// I1 / R2-2026-05-31 — absence-claim trust gating for the GRAPH-EDGE traversal
// verbs (graph_callers / graph_callees / graph_neighbors / graph_impact). The
// MOST dangerous output a graph verb can emit is an absence claim ("NO CALLERS
// for X"): an agent may delete/rename a symbol on the strength of it.
//
// CRITICAL HONESTY CONTRACT: these verbs read graph EDGES, not live per-symbol
// clangd evidence. A repo-level "a collection is index-ready" signal is NOT
// evidence that THIS symbol's callers were exhaustively resolved by clangd —
// LSP_VERIFIED edges are currently intra-file only (cross-TU callsites are
// unresolved under the WSL/Linux-DB sysroot limit), so a missing cross-file
// caller edge yields an EMPTY result that is NOT a true absence. Therefore the
// graph-traversal absence can NEVER honestly claim exhaustive/trustworthy
// absence. An empty result from these verbs is ALWAYS heuristic.
//
// For a trustworthy "no callers" check the agent must use code_intel_references
// (live clangd, per-symbol evidence) or code_intel_hierarchy — those keep their
// own per-symbol exhaustiveness contract and legitimately CAN attest exhaustive.
//
//   noun — 'callers' | 'callees' | 'neighbors' | 'impact' (for the message).
// Returns a string (no leading newline) the verb appends on its own line after
// the bare "NO CALLERS for X" line. ALWAYS the heuristic-not-exhaustive caveat.
export async function buildAbsenceTrustLine({ noun = 'edges' } = {}) {
  return `TRUST: absence is from the heuristic graph and is NOT exhaustive — `
    + `for a trustworthy "no ${noun}" check use code_intel_references `
    + `(live clangd, per-symbol evidence), or verify with rg.`;
}

// Build the single trust line for a result.
//   edges    — the mapped result edges (carry .provenance).
//   db       — open graph db (for getLatestCollection).
//   repoRoot — repo root (for HEAD comparison).
// Returns a string (no leading newline) the verb can append on its own line.
export async function buildTrustLine({ edges = [], db, repoRoot }) {
  if (!hasLspVerifiedEdge(edges)) {
    return HEURISTIC_TRUST_LINE;
  }

  // We have verified evidence — name the collection that produced it.
  let collection = null;
  try { collection = getLatestCollection(db, { language: 'cpp' }) ?? getLatestCollection(db); }
  catch { /* defensive — fall back to a generic verified line below */ }

  const dbHash = hash8(collection?.compileDbHash);
  const when = relativeTime(collection?.collectedAt);
  const verifiedCount = lspVerifiedEdgeCount(edges);

  // FALSE-EXHAUSTIVE GUARD (2026-06-02): index-ready attests only that clangd's
  // background index went idle — NOT that the compile DB covers every TU. On a
  // foreign (Linux/WSL) or unexpanded-unity DB the index is silently PARTIAL, so
  // an "index-ready, N callers" banner would falsely license "safe to delete".
  // Gate the same way code_intel_references/hierarchy do; degrade to lsp-partial
  // with the foreign/unity remedy. Best-effort — coverage failure never blocks.
  // Only an actually FOREIGN or UNITY compile DB downgrades a pre-collected
  // lsp-verified banner. A DB that is merely absent at query time (coverage
  // complete:false with reason "no compile DB") must NOT downgrade — these edges
  // were clangd ground truth at collection time, and the STALE check below
  // already handles drift. So gate on the foreign/unity flags, not bare complete.
  // `partial` is the generic "intrinsically incomplete" flag (foreign/unity C++,
  // no-tsconfig TS, or any Python collection). It is FALSE for a C++ DB merely
  // absent at query time, so pre-collected ground-truth edges aren't downgraded.
  let coverageIncomplete = false;
  let coverageReason = '';
  try {
    const cov = computeCoverage({ language: collection?.language || 'cpp', projectRoot: repoRoot });
    if (cov && cov.partial === true) { coverageIncomplete = true; coverageReason = cov.reason || ''; }
  } catch { /* defensive — treat as complete */ }
  if (coverageIncomplete) {
    return `TRUST: lsp-partial (index coverage incomplete — caller set is a FLOOR, verify with code_intel_references / rg before any "no callers" / delete) `
      + `[${verifiedCount} verified caller${verifiedCount === 1 ? '' : 's'}, compile-db ${dbHash}; ${coverageReason}]`;
  }

  // FIX A/B — readiness-gated honesty. references are only trustworthy-as-
  // exhaustive when clangd's background index was idle before they ran. When a
  // collection explicitly recorded indexReady===false, the verified set is a
  // FLOOR, not a ceiling — say lsp-partial and tell the agent to re-collect,
  // rather than implying the N callers are complete. indexReady===true earns
  // the "index-ready, N callers" attestation; null/unknown (older collections,
  // or BOUNDED mode which never claims exhaustive) keeps the prior
  // compile-db/collected wording (still honest — names provenance + freshness,
  // makes no completeness claim).
  if (collection && collection.indexReady === false) {
    const notFound = Number(collection.refsNotFound) || 0;
    const undercount = notFound > 0
      ? ` — ${notFound} symbol(s) unresolved`
      : '';
    return `TRUST: lsp-partial (clangd index NOT ready${undercount} — may undercount; re-collect) `
      + `[${verifiedCount} verified caller${verifiedCount === 1 ? '' : 's'}, compile-db ${dbHash}]`;
  }

  // Audit 2026-06-12 B4: the "index-ready, N callers" wording is the one banner
  // that licenses "safe to delete / dead code" (server-instructions). It must NOT
  // fire when the result MIXES verified + heuristic edges — a heuristic caller in
  // the set means clangd did not verify the whole caller set for this symbol, so
  // it's a FLOOR, not an exhaustive ceiling. Only an all-LSP_VERIFIED result over
  // an index-ready collection earns the exhaustive attestation.
  const totalEdges = Array.isArray(edges) ? edges.length : 0;
  const allVerified = totalEdges > 0 && verifiedCount === totalEdges;
  let line;
  if (collection && collection.indexReady === true && allVerified) {
    line = `TRUST: lsp-verified (clangd, index-ready, ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, compile-db ${dbHash}, collected ${when})`;
  } else if (collection && collection.indexReady === true) {
    const heur = totalEdges - verifiedCount;
    line = `TRUST: lsp-partial (clangd index-ready but result mixes ${verifiedCount} verified + ${heur} heuristic edge${heur === 1 ? '' : 's'} — caller set is a FLOOR, not exhaustive; verify with code_intel_references / rg before any "no callers" / delete) `
      + `[compile-db ${dbHash}]`;
  } else {
    // null/unknown indexReady: name provenance + freshness, make NO completeness
    // claim (honest for a mixed set — it isn't licensing "exhaustive").
    line = `TRUST: lsp-verified (clangd, compile-db ${dbHash}, collected ${when})`;
  }

  // Stale check: HEAD moved past the indexed commit, OR the compile-db hash
  // recorded on the collection no longer matches its freshness anchor. Either
  // way the verified edges may be out of date — say so, don't pass silently.
  let stale = false;
  if (collection) {
    try {
      const head = await getHeadCommit(repoRoot).catch(() => null);
      if (head && collection.indexedCommit && head !== collection.indexedCommit) {
        stale = true;
      }
    } catch { /* defensive */ }
    // freshnessBasis === 'compile_db_hash' means freshnessValue is the hash the
    // collection was gated on; a drift from compile_db_hash signals re-collect.
    if (
      collection.freshnessBasis === 'compile_db_hash'
      && collection.compileDbHash
      && collection.freshnessValue
      && collection.compileDbHash !== collection.freshnessValue
    ) {
      stale = true;
    }
  } else {
    // We saw a verified edge but no collection row to vouch for it — treat as
    // stale so the agent re-collects rather than trusting an orphan edge.
    stale = true;
  }

  if (stale) line += ' — STALE, re-collect';
  return line;
}
