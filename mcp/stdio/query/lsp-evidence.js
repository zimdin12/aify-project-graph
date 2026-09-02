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
import { prepareCompileDb } from '../code-intel/compile-db.js';
// Language normalisation comes from the backend REGISTRY, never a parallel alias list here.
import { normalizeLanguage } from '../code-intel/backends.js';

const LSP_PROVENANCE = 'LSP_VERIFIED';

// ⛔ CONFIDENCE IS NOT AN EVIDENCE TIER, AND SORTING BY IT INVERTED THE TIERS. Measured on click:
//
//     EXTRACTED     n=10976   conf 0.75..1.00  (avg 0.933)
//     LSP_VERIFIED  n=1460    conf 0.95..0.95  (avg 0.950)
//     AMBIGUOUS     n=1145    conf 0.75..0.95  (avg 0.930)
//
// The ranges OVERLAP and the averages are indistinguishable, so `ORDER BY confidence DESC LIMIT n`
// ranks a heuristic edge exactly as highly as a compiler-verified one — the whole set ties at 0.95
// and SQLite breaks the tie arbitrarily.
//
// ⛔ THE CONSEQUENCE, ON THE VERB THAT ANSWERS "IS THIS SAFE TO CHANGE":
// `graph_preflight("Context")` rendered five EXTRACTED callers, all from test files, while 124
// LSP_VERIFIED callers existed on that same symbol in that same graph. The verified evidence was
// not missing — it lost a coin toss and was never shown.
//
// ⇒ Rank by TIER first, confidence second. One owner for the order, and the SQL is GENERATED from
// it rather than restated as a CASE a maintainer must remember to update in two languages.
const PROVENANCE_RANK = Object.freeze({
  LSP_VERIFIED: 3,   // compiler ground truth
  EXTRACTED: 2,      // the AST said so
  INFERRED: 1,       // framework synthesis
  AMBIGUOUS: 1,      // heuristic name resolution — several candidates matched
});

// ⚠ UNKNOWN SORTS LAST, NOT FIRST. A provenance this build has never heard of is not promoted above
// evidence we can vouch for; the fail-closed direction is the one that cannot manufacture trust.
export function provenanceRank(p) {
  return PROVENANCE_RANK[p] ?? 0;
}

/**
 * SQL expression ranking a provenance column, generated from `PROVENANCE_RANK` above.
 *
 * ⚠ The column name is interpolated, so it must be a literal from our own source — never a value
 * that reached us from a caller. Every current call site passes a hardcoded `e.provenance`.
 *
 * Use as: `ORDER BY ${provenanceRankSql('e.provenance')} DESC, e.confidence DESC`
 */
export function provenanceRankSql(column) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)) {
    throw new Error(`provenanceRankSql: refusing to interpolate ${JSON.stringify(column)}`);
  }
  const cases = Object.entries(PROVENANCE_RANK)
    .map(([name, rank]) => `WHEN '${name}' THEN ${rank}`)
    .join(' ');
  return `(CASE ${column} ${cases} ELSE 0 END)`;
}

// True if any edge in the result is clangd ground truth.
export function hasLspVerifiedEdge(edges = []) {
  return edges.some((e) => e?.provenance === LSP_PROVENANCE);
}

// Count of clangd ground-truth edges in the result (the "N callers" the
// banner can honestly attribute to clangd).
export function lspVerifiedEdgeCount(edges = []) {
  return edges.reduce((n, e) => (e?.provenance === LSP_PROVENANCE ? n + 1 : n), 0);
}

// Derive the backend LANGUAGE from a verified edge's extractor tag
// (`cpp-clangd#…`, `ts-langserver#…`, `pyright#…`). Audit finding #11: the
// banner used to always prefer the cpp collection, so a TS/Python verified edge
// was attributed to clangd's compile-db hash + coverage. Returns null when no
// verified edge / unknown tag (caller falls back to the latest collection).
export function verifiedEdgeLanguage(edges = []) {
  const v = edges.find((e) => e?.provenance === LSP_PROVENANCE);
  const ex = String(v?.extractor || '').toLowerCase();
  if (!ex) return null;
  if (ex.startsWith('cpp-clangd') || ex.startsWith('clangd')) return 'cpp';
  if (ex.startsWith('ts-langserver') || ex.startsWith('typescript')) return 'typescript';
  if (ex.startsWith('pyright') || ex.startsWith('python')) return 'python';
  return null;
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

// The heuristic-trust caveat. Identical wording everywhere so the
// callers/impact/callees/neighbors footers can't drift. ONE line.
//
// ⛔ IT USED TO NAME ONLY THE UNDERCOUNT, AND THE OVERCOUNT IS THE LARGER ERROR HERE.
//
// "may undercount C++ virtual/cross-TU dispatch" is true, and a reader takes from it that the list
// is at least a SUBSET of the truth — safe to act on, merely incomplete. Measured on this repo:
//
//     graph_callers("has")        100 callers, essentially all of them `Map.has()` / `Set.has()`
//     graph_callers("writeFile")   70 callers, resolved onto a symbol declared in a TEST file
//
// Tree-sitter resolves a call by NAME. Every `x.has(y)` in the corpus was attributed to whichever
// node happened to be labelled `has`. So the list is not a subset of the truth; on a common name it
// is mostly not the truth at all.
//
// ⇒ THE DIRECTION OF AN ERROR IS PART OF THE ERROR. A caveat that names the safe direction while
// the dangerous one dominates is worse than no caveat: it tells the reader which way to lean, and
// the lean is wrong. Someone reading "may undercount" before a deletion concludes the danger is a
// caller they cannot see, when the live danger is that most of what they CAN see is a name
// collision.
//
// ⚠ Both directions now, shortest form that keeps them distinguishable. This line prints on every
// caller answer in the product, so it is paid for constantly and cannot grow.
export const HEURISTIC_TRUST_LINE =
  'TRUST: heuristic only (tree-sitter) — resolves calls BY NAME, so a common name '
  + '(has, get, writeFile) OVERCOUNTS with unrelated same-named calls, and C++ virtual/cross-TU '
  + 'dispatch UNDERCOUNTS; run graph_collect_code_intel for compiler-resolved evidence, or verify with rg';

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
// ⛔ THE CALLERS ALREADY PASSED db AND repoRoot; THIS FUNCTION THREW THEM AWAY.
//
// All four call sites (callers / callees / impact / neighbors) invoke this as
// `buildAbsenceTrustLine({ noun, db, repoRoot })`, but the signature destructured only `noun`, so
// the line was a constant string. It told a reader to DOUBT the absence without ever naming why,
// and "doubt this" is what an agent already gets free from grep. The facts were in scope the whole
// time; nothing consumed them.
//
// ⚠ SYNCHRONOUS, AND CALLED BEFORE ANY await. The verbs `return` this promise while their enclosing
// `finally { db.close() }` runs, so a db read after an await fails with "database connection is not
// open" — the defect recorded at callers.js:93, where a scope note threw on every call and its
// catch returned '', leaving the feature inert and the output unchanged.
//
// ⚠ NAMES ONLY WHAT IT READ. No collection row → say that. A cpp collection with no compile-db hash
// → the standing no_compile_db limit. Anything else → no clause at all, rather than a guess.
// ⛔ ONE SOURCE OF TRUTH FOR THE SPINE'S SCOPE. `graph_consequences` needs the same facts as a
// STRUCTURED field (it mirrors `overlay_coverage {cause, consequence, remedy}`), and the prose
// clause below needs them as a sentence. Two copies of a trust statement drifting apart is exactly
// what this module's header says it exists to prevent, so both derive from here.
//
// ⚠ SYNCHRONOUS. Callers `return` a promise while their enclosing `finally { db.close() }` runs, so
// any db read must happen before the first await — see callers.js:93.
//
// ⚠ Returns `null` when nothing can be read, never a reassuring default.
export function spineCoverage(db) {
  if (!db) return null;
  let latest = null;
  try { latest = getLatestCollection(db); } catch { return null; }
  if (!latest) {
    return {
      collection: null, language: null, files_processed: null, files_eligible: null,
      cause: 'no_code_intel_collection',
      consequence: 'No code-intel collection exists for this repository, so NO structural edge here is '
        + 'compiler-verified. Callers, importers and co-consumers are heuristic only, and an empty one '
        + 'is evidence about the SPINE, not about the code.',
      remedy: 'run graph_collect_code_intel to build the trust spine.',
    };
  }
  let cpp = null;
  try { cpp = getLatestCollection(db, { language: 'cpp' }); } catch { /* leave cpp unknown */ }
  if (cpp && !cpp.compileDbHash) {
    return {
      collection: cpp.collectionId ?? null, language: 'cpp',
      files_processed: cpp.filesProcessed ?? null, files_eligible: cpp.filesEligible ?? null,
      cause: 'no_compile_db',
      consequence: 'The C++ collection ran with no compile_commands.json, so clangd resolved no call. '
        + 'Structural results are a FLOOR and an empty one cannot license a deletion.',
      remedy: 'generate a compile DB with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON, then re-collect.',
    };
  }
  // ⚠ UNKNOWN STAYS UNKNOWN — null, never 0 and never "all". A fabricated denominator would let a
  // reader compute a completeness figure nobody measured.
  // ⛔ THE CAUSES ARE LITERALS ON PURPOSE — a ternary HID TWO OF THEM FROM THE VOCABULARY GATE.
  //
  // `cause-vocabulary.test.js` harvests `cause: '...'` literals across mcp/stdio and requires each
  // to be documented in SERVER_INSTRUCTIONS, because agents branch on those exact strings. My first
  // version computed the cause with a ternary, so the harvester saw only ONE of the three new
  // causes and the other two were undocumented AND invisible to the guard meant to catch that.
  // Its own header names this class: a checker that cannot see its population will eventually
  // certify an empty one. Widening the regex would have been the wrong repair — the code should be
  // legible to the gate, not the gate stretched around the code.
  const processed = latest.filesProcessed;
  const eligible = latest.filesEligible;
  const known = Number.isFinite(processed) && Number.isFinite(eligible) && eligible > 0;
  const base = { collection: latest.collectionId ?? null, language: latest.language ?? null };

  if (!known) {
    return {
      ...base, files_processed: null, files_eligible: null,
      cause: 'coverage_unrecorded',
      consequence: `The newest code-intel collection is ${latest.language} but did not record its file `
        + 'coverage, so how much of the repository it covers is UNKNOWN.',
      remedy: null,
    };
  }
  if (processed < eligible) {
    return {
      ...base, files_processed: processed, files_eligible: eligible,
      cause: 'partial_spine_coverage',
      consequence: `The newest code-intel collection is ${latest.language} and processed ${processed} of `
        + `${eligible} eligible files. Structural fields are compiler-verified only inside that set; `
        + 'outside it they are heuristic.',
      remedy: 'run graph_collect_code_intel with scope:"all" to cover the remainder.',
    };
  }
  // ⛔ PROSE IS CONDITIONAL ON RESULT SHAPE, AND MY FIRST VERSION IGNORED THAT.
  //
  // The plan's wording is exact: "structured contracts at every action or absence-authorising
  // result, WITH PROSE CONDITIONAL ON RESULT SHAPE. Recreating the warning wall the pilot agents
  // skimmed would undo M2's own purpose." I emitted `consequence` on every branch, so a fully
  // covered repository paid for a sentence saying nothing was wrong.
  //
  // Measured before this change: the field was 445 bytes, 18.1% of the whole graph_consequences
  // response (~111 estimated tokens), on a surface M4 measured as already expensive. A caveat that
  // fires when there is nothing to caveat is exactly the wall the plan warns about — and it trains
  // a reader to skim the block it lives in, which is the note `consequences.js` already makes about
  // a field that is "always empty".
  //
  // ⚠ THE NUMBERS STAY. They are the answer to "what scope was this computed over", which the
  // reader asked for. Only the WARNING disappears when there is nothing to warn about.
  return {
    ...base, files_processed: processed, files_eligible: eligible,
    cause: null,
    consequence: null,
    remedy: null,
  };
}

// ⛔ THIS USED TO BE A SECOND IMPLEMENTATION, AND I CLAIMED IT WAS NOT.
//
// When `spineCoverage` was extracted, the commit message said it "backs BOTH this field and the
// prose clause". It did not — this function kept its own `getLatestCollection` calls and its own
// branch logic, so the two were PARALLEL implementations of one trust statement, the precise drift
// this module's header says it exists to prevent. Two mutants reported `NOT APPLIED 2 matches`,
// and that duplicate-anchor count is what exposed the overclaim.
//
// Now it renders `spineCoverage`'s verdict as a sentence and decides nothing itself.
function spineScopeClause(db, noun) {
  const c = spineCoverage(db);
  if (!c) return '';
  if (c.cause === 'no_code_intel_collection') {
    // Phrased without the noun so it stays grammatical across callers/callees/impact/neighbors.
    return ` SCOPE: no code-intel collection exists for this repository, so nothing here is`
      + ` compiler-verified — run graph_collect_code_intel to build the trust spine.`;
  }
  if (c.cause === 'no_compile_db') {
    return ` SCOPE: the C++ collection ran with no compile_commands.json, so clangd resolved no`
      + ` call and this absence is a FLOOR — generate one with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON.`;
  }
  // ⛔ NAME THE COVERAGE, NOT JUST THE LANGUAGE. Measured on this repository, the newest collection
  // processed 73 of 627 eligible files. An agent asking for callers got an absence answer backed by
  // that spine and was told only "heuristic" — the identical wording a fully-covered repo produces.
  // The same shape is already recorded in the importer: a run covering 0.6% of the repo silenced
  // graph_health's only code-intel warning.
  //
  // ⚠ THE NOUNS ARE NOT INTERCHANGEABLE, and the schema says so. `files_in_scope` is what the run
  // SET OUT to collect — a scope:"files" run with three paths reports 3 of 3 and reads as complete.
  // `files_eligible` is how many the provider COULD collect, and is "the only one that makes
  // coverage mean anything". So the ratio is processed / ELIGIBLE, never processed / in-scope.
  //
  // ⚠ AND IT IS COVERAGE BY THIS COLLECTION, NOT BY THE GRAPH. Earlier collections may still
  // contribute edges, so their union is a different and larger number. A claim about
  // trustworthiness names the surface it governs — the over-broad true statement is the defect
  // recorded in surfaces-agree-on-scope.test.js.
  //
  // ⚠ UNKNOWN STAYS UNKNOWN. A collection that did not record its coverage gets no ratio: a
  // fabricated denominator would let a reader compute a completeness figure that was never measured.
  // ⛔ NO SECOND RATIO COMPUTATION. The first repair moved the CAUSE branches here but left this
  // tail recomputing `known` from a shimmed object, so `filesEligible` still appeared twice and the
  // wrong-noun mutant (denominator becomes IN-SCOPE) reported NOT APPLIED — unverifiable, which is
  // not the same as passing. `spineCoverage` already decided; this renders its numbers verbatim.
  const coverage = (c.files_processed !== null && c.files_eligible !== null)
    ? `, which processed ${c.files_processed} of ${c.files_eligible} eligible files`
    : ', whose file coverage was not recorded';
  return ` SCOPE: the newest code-intel collection is ${c.language}${coverage};`
    + ` anything outside it is heuristic only.`;
}

// ⛔ EVIDENCE QUALITY AND CONSTRUCT COVERAGE ARE DIFFERENT CLAIMS, and until now only the first was
// ever stated. Every existing TRUST line describes HOW GOOD THE INDEX IS — heuristic-only, coverage
// incomplete, index not ready, collection stale, fetch cap hit. None describes what the analysis
// STRUCTURALLY CANNOT SEE, however perfect the index. M2 asks for the second: "state what was NOT
// modelled (indirection, macros, conditional compilation, …)". A search for "not modelled" across
// mcp/ returned zero hits before this.
//
// Verified in the extractor rather than assumed:
//   - ingest/languages/cpp.js:422 — "every macro-mangled shape produced no qualified symbol at all"
//   - its ONLY preprocessor handling is `preproc_include` and `blankCppClassHeadMacros`; there is no
//     #if/#ifdef evaluation anywhere in the module.
//
// ⛔ EVERY CELL BELOW IS OBSERVED. TWO EARLIER VERSIONS OF THIS SENTENCE WERE WRONG BECAUSE THEY
// WERE NOT. The first said an inactive `#ifdef` branch was "invisible to BOTH tiers"; the second
// still asserted that function-pointer and macro calls were unmodelled generally. Both were
// DERIVED from how a compile database works and shipped without anyone watching them.
//
// Measured on purpose-built fixtures, each with an always-compiled plain call as positive control
// (scripts/m2-conditional-compilation-probe.mjs and the scratch probes it grew from):
//
//   construct                    heuristic (tree-sitter)        clangd
//   ---------------------------  -----------------------------  -----------------------------
//   plain call        [CONTROL]  edge conf=0.60                 edge conf=0.95 [lsp✓]
//   extern, no header [CONTROL]  edge conf=0.60                 edge conf=0.95 [lsp✓]
//   macro-generated call         NO EDGE                        NO EDGE
//   function-pointer call        NO EDGE                        edge conf=0.95 [lsp✓]
//   inactive #ifdef branch       edge conf=0.60  (OVERCOUNT)    NO EDGE
//   #include'd .cpp (not a TU)   edge conf=0.60                 NO EDGE
//
// ⇒ Only the MACRO case is blind in both tiers. Everything else is tier-dependent, and the
// direction is what an agent can act on: tree-sitter parses TEXT (so it counts calls that never
// compile and cannot follow a pointer), while clangd only ever sees what the compile database
// actually compiles.
//
// ⛔ `extern`-without-header is in M2's milestone list and is NOT included here: both tiers resolve
// it. Shipping it would be a FALSE caveat — telling an agent we cannot see something we can, which
// corrodes trust in correct results exactly as badly as the reverse.
//
// ⚠ Pointing an agent at code_intel_references does not escape the undercount rows.
//
// C and C++ are singled out because the clause is about the C PREPROCESSOR. `c` normalises to `cpp`
// through the backend registry; `c_cpp` is the resolver's family bucket (ingest/resolver.js:47-48)
// and is matched explicitly rather than by adding an alias, which would change backend selection.
const CPP_FAMILY_BUCKET = 'c_cpp';

export function constructCoverageClause(language) {
  const raw = String(language || '').trim().toLowerCase();
  if (!raw) return '';
  if (normalizeLanguage(raw) !== 'cpp' && raw !== CPP_FAMILY_BUCKET) return '';
  return ' NOT MODELLED: a macro-generated call is invisible to BOTH tiers. The rest is'
    + ' TIER-DEPENDENT — the heuristic graph misses function-pointer calls that clangd resolves,'
    + ' while clangd covers only what the compile DB compiles, so calls in an inactive #ifdef branch'
    + " or an #include'd .cpp are missing from it (the heuristic graph carries those, counting"
    + ' inactive branches as if live).'
    + ' This states what the analysis cannot see, NOT that this symbol is affected.';
}

export async function buildAbsenceTrustLine({ noun = 'edges', db, language = null } = {}) {
  const scope = db ? spineScopeClause(db, noun) : '';
  // Zero bytes on a repo with no C/C++ — the 445-byte warning wall this project already had to tear
  // out was unconditional prose, and the lesson was that a caveat everyone skims protects nobody.
  const constructs = constructCoverageClause(language);
  return `TRUST: absence is from the heuristic graph and is NOT exhaustive — `
    + `for a trustworthy "no ${noun}" check use code_intel_references `
    + `(live clangd, per-symbol evidence), or verify with rg.${scope}${constructs}`;
}

// Build the single trust line for a result.
//   edges    — the mapped result edges (carry .provenance).
//   db       — open graph db (for getLatestCollection).
//   repoRoot — repo root (for HEAD comparison).
// Returns a string (no leading newline) the verb can append on its own line.
export async function buildTrustLine({ edges = [], db, repoRoot, truncated = false, file = null }) {
  if (!hasLspVerifiedEdge(edges)) {
    return HEURISTIC_TRUST_LINE;
  }

  // We have verified evidence — name the collection that produced it. Select by
  // the verified edge's OWN language (#11) so a TS/Python banner doesn't cite the
  // cpp compile-db hash/coverage; fall back to cpp, then any latest.
  const verifiedLang = verifiedEdgeLanguage(edges);
  let collection = null;
  try {
    collection = (verifiedLang ? getLatestCollection(db, { language: verifiedLang }) : null)
      ?? getLatestCollection(db, { language: 'cpp' })
      ?? getLatestCollection(db);
  } catch { /* defensive — fall back to a generic verified line below */ }

  const when = relativeTime(collection?.collectedAt);
  const verifiedCount = lspVerifiedEdgeCount(edges);

  // L11: name the backend that ACTUALLY produced the evidence. Every banner
  // hardcoded "clangd" and a "compile-db <hash>" tag, so a pyright- or
  // tsserver-verified result claimed a C++ toolchain and printed
  // `compile-db ????????` (hash8 of an absent hash). Small, but it is a false
  // statement on the trust surface, and the compile DB is a C++-only concept.
  const lang = collection?.language || verifiedLang || 'cpp';
  const backend = lang === 'python' ? 'pyright'
    : (lang === 'typescript' || lang === 'javascript') ? 'tsserver'
      : 'clangd';
  // Only C++ has a compile DB; for other backends cite the collection instead.
  const provenanceTag = (backend === 'clangd' && collection?.compileDbHash)
    ? `compile-db ${hash8(collection.compileDbHash)}`
    : `${backend} collection`;
  const dbHash = provenanceTag;

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
  //
  // M5 (2026-07-27): `file` is now threaded in. Without it this computed
  // repo-wide coverage while code_intel_references computed FILE-AWARE coverage,
  // so the same symbol could get `exhaustive:false, partial_compile_db_coverage`
  // from one verb and the exhaustive-licensing banner from another. Our own
  // instructions tell agents the structured flag wins "when they could disagree"
  // — but an agent reading graph_callers never sees the flag. Two trust surfaces
  // contradicting each other is the worst possible failure for a tool whose
  // product IS its honesty, so the file-level verdict now downgrades the banner
  // too: if the queried symbol's own TU has no compile command, the collected
  // edges for it came from an index that could not compile it.
  let coverageIncomplete = false;
  let coverageReason = '';
  try {
    const cov = computeCoverage({ language: collection?.language || 'cpp', projectRoot: repoRoot, file: file || null });
    if (cov && (cov.partial === true || cov.fileUncovered === true)) {
      coverageIncomplete = true;
      coverageReason = cov.reason || '';
    }
  } catch { /* defensive — treat as complete */ }
  if (coverageIncomplete) {
    return `TRUST: lsp-partial (index coverage incomplete — caller set is a FLOOR, verify with code_intel_references / rg before any "no callers" / delete) `
      + `[${verifiedCount} verified caller${verifiedCount === 1 ? '' : 's'}, ${dbHash}; ${coverageReason}]`;
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
    return `TRUST: lsp-partial (${backend} index NOT ready${undercount} — may undercount; re-collect) `
      + `[${verifiedCount} verified caller${verifiedCount === 1 ? '' : 's'}, ${dbHash}]`;
  }

  // Audit 2026-06-12 B4: the "index-ready, N callers" wording is the one banner
  // that licenses "safe to delete / dead code" (server-instructions). It must NOT
  // fire when the result MIXES verified + heuristic edges — a heuristic caller in
  // the set means clangd did not verify the whole caller set for this symbol, so
  // it's a FLOOR, not an exhaustive ceiling. Only an all-LSP_VERIFIED result over
  // an index-ready collection earns the exhaustive attestation.
  const totalEdges = Array.isArray(edges) ? edges.length : 0;
  const allVerified = totalEdges > 0 && verifiedCount === totalEdges;

  // P0-5 (2026-07-26): staleness must be decided BEFORE the wording is chosen.
  // It used to be appended as " — STALE, re-collect" AFTER the
  // "index-ready, N callers" attestation had already been emitted — the one
  // banner our server-instructions say licenses "safe to delete". Sand Castle
  // ran against a collection 5 weeks / 100+ commits behind HEAD and still saw
  // the exhaustive wording. A stale collection can never license exhaustiveness.
  let stale = false;
  if (collection) {
    try {
      const head = await getHeadCommit(repoRoot).catch(() => null);
      if (head && collection.indexedCommit && head !== collection.indexedCommit) stale = true;
    } catch { /* defensive */ }
    // M4 (2026-07-27): this used to compare collection.compileDbHash against
    // collection.freshnessValue — but the provider writes BOTH from the same
    // variable (cpp-clangd.js), so the condition could never be true and the
    // documented "or the compile DB changed" staleness signal never fired once.
    // Compare against the compile DB as it exists NOW: a rebuilt/re-configured
    // DB means the collected evidence describes a different index.
    if (collection.freshnessBasis === 'compile_db_hash' && collection.compileDbHash) {
      try {
        const prep = prepareCompileDb({ projectRoot: repoRoot });
        if (prep?.found && prep.dbHash && prep.dbHash !== collection.compileDbHash) stale = true;
      } catch { /* best-effort — a probe failure must not fabricate staleness */ }
    }
  } else {
    // A verified edge with no collection row to vouch for it — treat as stale so
    // the agent re-collects rather than trusting an orphan edge.
    stale = true;
  }

  // P0-3: a collection that left a large share of symbols unresolved did not
  // index the repo completely, so its verified set is a floor regardless of the
  // indexReady bit. sand_castle: 2274 unresolved of 8917 (25%).
  // M4: `refsFound`/`refsNotFound` are NULL on any pre-telemetry collection. A
  // missing measurement is not a good measurement — treating absent telemetry as
  // "0% unresolved" would grant the exhaustive banner on exactly the collections
  // we know least about, which is the same "unknown treated as proven" pattern
  // the fail-closed work removed elsewhere.
  const refsFound = Number(collection?.refsFound);
  const refsNotFound = Number(collection?.refsNotFound);
  const haveTelemetry = Number.isFinite(refsFound) && Number.isFinite(refsNotFound)
    && (refsFound + refsNotFound) > 0;
  const refsTotal = haveTelemetry ? refsFound + refsNotFound : 0;
  const unresolvedRatio = haveTelemetry ? refsNotFound / refsTotal : 0;
  const heavilyUnresolved = haveTelemetry && unresolvedRatio >= 0.1;
  const telemetryMissing = !haveTelemetry;

  let line;
  if (collection && collection.indexReady === true && allVerified && stale) {
    line = `TRUST: lsp-partial (${backend} verified ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, but the collection is STALE — `
      + `indexed ${String(collection.indexedCommit ?? '?').slice(0, 7)}, HEAD has moved. The set is a FLOOR, not exhaustive; `
      + `re-run graph_collect_code_intel, or verify with rg before any "no callers" / delete) [${dbHash}, collected ${when}]`;
    return line;
  }
  if (collection && collection.indexReady === true && allVerified && heavilyUnresolved) {
    line = `TRUST: lsp-partial (${backend} verified ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, but the collection left `
      + `${refsNotFound} of ${refsTotal} symbols (${Math.round(unresolvedRatio * 100)}%) unresolved — the index is incomplete, so this `
      + `is a FLOOR, not exhaustive; verify with rg before any "no callers" / delete) [${dbHash}, collected ${when}]`;
    return line;
  }
  // The caller edges were capped by the SQL fetch, so rows beyond the cap were
  // never seen. "N callers" would name a floor while reading as a census — the
  // same false-exhaustive shape the evidence contract already refuses.
  if (collection && collection.indexReady === true && allVerified && truncated) {
    return `TRUST: lsp-partial (${backend} verified ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, but the edge fetch hit its cap `
      + `— more callers exist that were never retrieved, so this is a FLOOR, not a complete set. Narrow with file=, or use `
      + `code_intel_references for a per-symbol census) [${dbHash}, collected ${when}]`;
  }
  if (collection && collection.indexReady === true && allVerified && telemetryMissing) {
    // No resolution telemetry recorded, so we cannot show the index actually
    // resolved what it saw. Name the provenance without licensing exhaustiveness.
    line = `TRUST: lsp-partial (${backend} verified ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, but this collection recorded no resolution telemetry, so completeness is unproven — treat as a FLOOR and verify before any "no callers" / delete) [${dbHash}, collected ${when}]`;
    return line;
  }
  if (collection && collection.indexReady === true && allVerified) {
    line = `TRUST: lsp-verified (${backend}, index-ready, ${verifiedCount} caller${verifiedCount === 1 ? '' : 's'}, ${dbHash}, collected ${when})`;
  } else if (collection && collection.indexReady === true) {
    const heur = totalEdges - verifiedCount;
    line = `TRUST: lsp-partial (${backend} index-ready but result mixes ${verifiedCount} verified + ${heur} heuristic edge${heur === 1 ? '' : 's'} — caller set is a FLOOR, not exhaustive; verify with code_intel_references / rg before any "no callers" / delete) `
      + `[${dbHash}]`;
  } else {
    // null/unknown indexReady: name provenance + freshness, make NO completeness
    // claim (honest for a mixed set — it isn't licensing "exhaustive").
    line = `TRUST: lsp-verified (clangd, ${dbHash}, collected ${when})`;
  }

  // `stale` was computed above, before the wording was chosen (P0-5), so an
  // exhaustive-licensing banner can never be emitted for a stale collection.
  // The remaining (already non-exhaustive) wordings still carry the marker.

  if (stale) line += ' — STALE, re-collect';
  return line;
}
