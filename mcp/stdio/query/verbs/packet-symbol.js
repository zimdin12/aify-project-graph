// PACKET SYMBOL ROUTE — the authority that answers "what is this symbol, and where does it live".
//
// Phase 0 slice 2, and MECHANICAL: the three bodies below are byte-identical to the ones that
// were in packet.js, comment blocks included. Nothing about their behaviour is reshaped here.
//
// ⛔ `buildSymbolPointerPacket` IS DELIBERATELY NOT HERE, and that is the reviewer's ruling
// rather than a convenience. It returns a SERIALIZED string via `renderPacketLines`, so exporting
// it from an island would create the exact failure they pre-registered as the most likely way
// this phase goes wrong:
//
//   "an unsealed escape introduced for testability — an extracted renderer gets exported, tests
//    begin calling it directly, and its string output bypasses withSealScope/sealPacketOutput.
//    Everything inside the route looks correct and focused tests pass, while the only product
//    guarantee lives one boundary above the thing now treated as API."
//
// So the renderer stays private in the facade and only the DATA-producing helpers move. Reshaping
// the route to return typed entries is a behaviour change with its own evidence, not this slice.
//
// ⚠ THE EXPORT SURFACE WAS PRE-REGISTERED BEFORE THIS FILE EXISTED, in
// tests/unit/query/packet-authority-boundaries.test.js. Writing the allowlist first makes the
// surface a decision; writing it afterwards makes it a description of whatever the extraction
// happened to leave reachable — which is how slice 1 ended up exporting all 31 of its
// declarations and had to be minimized back to 16.
import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbolWithTotal, languageCensusExact } from './symbol_lookup.js';

// Definitions grouped by language, over ALL nodes rather than the displayed slice.
// Falls back to the file extension when the language column is empty, so a repo indexed
// before languages were recorded still gets a breakdown instead of a blank one.
export function countByLanguage(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const ext = (n.file_path || '').split('.').pop();
    const key = n.language || (ext && ext !== n.file_path ? ext : 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Largest group first: the dominant mirror set is the one a reader must act on.
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([lang, count]) => ({ lang, count }));
}

// ★ SYMBOL→FEATURE DOES NOT NEED THE FULL CONSEQUENCES TRAVERSAL.
//
// Measured (the field test, echoes, 2026-08-10): ALL THREE bare symbols tried —
// SimCoordinator, WorldBuffer, GpuMaterial — blew the 2000ms budget. Not an edge
// case: graph_packet's bare-symbol path was non-functional on a 12k-node C++ repo,
// which is the repo class this verb exists to serve.
//
//   graphConsequences round-trip:  601ms @ 3,958 nodes · 4316ms @ 12,126 nodes
//
// The fix is not a bigger budget — that moves the cliff and leaves the reader
// unable to tell which side they are on. It is to stop asking an expensive
// question. graphConsequences computes callers, importers, documents_mentioning,
// tasks, tests, git history, risk flags and a receipt. To answer "which feature
// owns this symbol" none of that is needed: resolve the label, then check which
// feature anchors it. Two cheap steps against data already in hand.
//
// The full traversal is still one NEXT line away for a reader who wants it.
export function resolveFeatureForSymbolCheap(repoRoot, functionality, symbol) {
  if (!symbol || !functionality?.features?.length) return null;
  let db;
  try {
    db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // ⛔ `nodes` is capped at 50 by the retrieval query; `resolvedTotal` is the COUNT.
    // Reporting nodes.length as the total was the same cap-as-total defect this whole
    // change exists to remove, one level upstream — caught by review, hermes session.
    const { rows: nodes, total: resolvedTotal } = resolveSymbolWithTotal(db, symbol);
    // ⇒ UNCAPPED census where the exact-label predicate applies; null (=> SAMPLED) otherwise.
    // An exact total must never lend its authority to a composition built from the page.
    const exactCensus = languageCensusExact(db, symbol);
    const censusIsExact = Boolean(exactCensus);
    const census = exactCensus ?? countByLanguage(nodes);
    if (!nodes.length) return null;

    const matchedSymbols = new Set(nodes.map((n) => n.label).filter(Boolean));
    const matchedFiles = new Set(nodes.map((n) => n.file_path).filter(Boolean));

    // Same anchor semantics as consequences, deliberately — a different rule here
    // would make the cheap path and the full path disagree about the same repo.
    for (const f of functionality.features) {
      const symbolHit = (f.anchors?.symbols ?? []).some((s) => matchedSymbols.has(s));
      const fileHit = (f.anchors?.files ?? []).some((pattern) => (
        pattern.endsWith('/*')
          ? [...matchedFiles].some((p) => p.startsWith(pattern.slice(0, -1)))
          : matchedFiles.has(pattern)
      ));
      if (symbolHit || fileHit) {
        return {
          feature: f,
          // ★ locationsTotal is NOT decoration. The slice below is a display cap, and
          // without the true count the renderer printed the CAP as the total —
          // "UNRANKED (3 matches)" for a symbol with nine definitions. Same class as
          // the symbol_lookup candidate defect: a limit reported as a finding.
          locationsTotal: resolvedTotal,
          // ★★ BY LANGUAGE, because for a mirrored type the COUNT IS THE FINDING.
          // the field test, echoes: `GpuMaterial` is 16 definitions — 1 C++ header and 15 GLSL
          // shaders on a shared std430 stride, where every copy must agree or
          // materialPalette[id] addresses the wrong entry for every material above 0. A
          // fixed cap treats N definitions as a list to SAMPLE; here N is a property of
          // the symbol and the property is the hazard.
          locationsByLanguage: census, locationsCensusExact: censusIsExact,
          locations: nodes.slice(0, 3).map((n) => ({
            file: n.file_path, line: n.start_line, type: n.type,
          })),
        };
      }
    }
    return { feature: null, locationsTotal: resolvedTotal, locationsByLanguage: census, locationsCensusExact: censusIsExact, locations: nodes.slice(0, 3).map((n) => ({
      file: n.file_path, line: n.start_line, type: n.type,
    })) };
  } catch {
    return null; // fall through to the budgeted path; never make orientation fail
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

export function resolvePopulation(total, sampleLength) {
  // `>= sampleLength` because a total smaller than the sample we are holding is not a total,
  // it is a contradiction — and a contradicting field must not be trusted merely for existing.
  if (Number.isInteger(total) && total >= sampleLength) return { attested: true, total };
  return { attested: false, total: null };
}
