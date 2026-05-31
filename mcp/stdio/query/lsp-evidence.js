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

// I1 — absence-claim trust gating. The MOST dangerous output a graph verb can
// emit is an absence claim ("NO CALLERS for X"): an agent may delete/rename a
// symbol on the strength of it. An absence is only SAFE when backed by FRESH,
// index-ready LSP evidence for that symbol — otherwise it is a heuristic
// (tree-sitter) absence that undercounts C++ virtual / cross-TU dispatch and
// MUST carry an explicit "not exhaustive — verify" caveat.
//
// Because an empty result has NO edges to inspect, we cannot read provenance
// off the result; instead we ask whether the latest collection for this repo is
// index-ready (the same signal buildTrustLine uses). When it is, the absence
// can honestly state it is lsp-verified-exhaustive. Otherwise we append the
// heuristic non-exhaustive caveat.
//
//   noun — 'callers' | 'callees' | 'neighbors' | 'impact' (for the message).
// Returns a string (no leading newline) the verb appends on its own line after
// the bare "NO CALLERS for X" line.
export async function buildAbsenceTrustLine({ noun = 'edges', db, repoRoot } = {}) {
  let collection = null;
  try { collection = getLatestCollection(db, { language: 'cpp' }) ?? getLatestCollection(db); }
  catch { /* defensive */ }

  if (collection && collection.indexReady === true) {
    // Fresh, index-ready clangd evidence backs this repo — but only honestly
    // "exhaustive" if the evidence isn't stale vs HEAD / compile-db drift.
    let stale = false;
    try {
      const head = await getHeadCommit(repoRoot).catch(() => null);
      if (head && collection.indexedCommit && head !== collection.indexedCommit) stale = true;
    } catch { /* defensive */ }
    if (
      collection.freshnessBasis === 'compile_db_hash'
      && collection.compileDbHash && collection.freshnessValue
      && collection.compileDbHash !== collection.freshnessValue
    ) stale = true;
    const dbHash = hash8(collection.compileDbHash);
    if (!stale) {
      return `TRUST: lsp-verified-exhaustive (clangd, index-ready, compile-db ${dbHash}) — no ${noun} found is a TRUSTWORTHY absence`;
    }
    return `TRUST: lsp evidence is STALE (compile-db ${dbHash}) — re-collect with graph_collect_code_intel before trusting this "no ${noun}" claim`;
  }

  // No fresh index-ready evidence — the absence is heuristic and NOT exhaustive.
  return `TRUST: absence is from the heuristic graph (tree-sitter) and is NOT exhaustive — `
    + `verify with rg, or run graph_collect_code_intel for clangd-verified ${noun}`;
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

  let line;
  if (collection && collection.indexReady === true) {
    line = `TRUST: lsp-verified (clangd, index-ready, ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, compile-db ${dbHash}, collected ${when})`;
  } else {
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
