import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallers } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { collapseCallerEdges, expandClassRollupTargets } from './target_rollup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { loadManifest } from '../../freshness/manifest.js';
import { computeTrustLevel } from './health.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { buildTrustLine, buildAbsenceTrustLine } from '../lsp-evidence.js';
import { EXECUTION_FAMILY } from '../../storage/taxonomy.js';
import { normalizePathArg } from '../../util/paths.js';

const EXECUTION_RELATIONS = EXECUTION_FAMILY;

// Hard ceiling on caller edges pulled from SQL. Distinct from the `top_k` display
// budget: past THIS the rows were never fetched, so the trust banner cannot claim
// the caller set is complete.
const EDGE_FETCH_CAP = 100;

export async function graphCallers({ repoRoot, symbol, depth = 1, top_k = 10, file }) {
  file = normalizePathArg(file); // accept Windows backslash dir/path filters
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_callers' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const { targets, targetIds, rolledUp, header, error } = expandClassRollupTargets(db, symbol);
    if (error) return error;
    if (targets.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;

    const placeholders = targetIds.map((_, i) => `$t${i}`).join(',');
    const params = {};
    targetIds.forEach((id, i) => { params[`t${i}`] = id; });

    // The SQL cap is a HARDER ceiling than the top_k display budget: past it the
    // edges were never fetched, so raising top_k cannot reveal them and the trust
    // banner must not claim an exhaustive caller set. Fetch one extra row purely
    // to detect that we hit it.
    let edges;
    if (depth <= 1) {
      edges = db.all(
        `SELECT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line
         FROM edges e JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         LIMIT ${EDGE_FETCH_CAP + 1}`,
        params
      );
    } else {
      edges = db.all(
        `WITH RECURSIVE callers(from_id, to_id, depth) AS (
           SELECT from_id, to_id, 1
           FROM edges
           WHERE to_id IN (${placeholders}) AND relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
           UNION ALL
           SELECT e.from_id, e.to_id, c.depth + 1
           FROM edges e
           JOIN callers c ON e.to_id = c.from_id
           WHERE e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')}) AND c.depth < $depth AND c.depth <= 10
         )
         SELECT DISTINCT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line, c.depth
         FROM callers c
         JOIN edges e
           ON e.from_id = c.from_id
          AND e.to_id = c.to_id
          AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         JOIN nodes n ON n.id = e.from_id
         LIMIT ${EDGE_FETCH_CAP + 1}`,
        { ...params, depth }
      );
    }

    const edgesTruncated = edges.length > EDGE_FETCH_CAP;
    if (edgesTruncated) edges = edges.slice(0, EDGE_FETCH_CAP);

    // I1 / R2-2026-05-31 — an absence claim ("NO CALLERS") is the most dangerous
    // output. Graph-edge traversal can never honestly attest an EXHAUSTIVE
    // absence (it reads edges, not live per-symbol clangd evidence), so route
    // through buildAbsenceTrustLine — which ALWAYS emits the heuristic
    // non-exhaustive caveat pointing at code_intel_references — never a bare
    // "NO CALLERS" and never a "trustworthy/exhaustive absence".
    const absence = async (msg) => {
      let line = '';
      try { line = '\n' + await buildAbsenceTrustLine({ noun: 'callers', db, repoRoot }); }
      catch { /* defensive */ }
      return prefixReadWarnings(msg + line, freshness.warnings);
    };

    if (edges.length === 0) return absence(`NO CALLERS for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);

    // NOTE (P0-4): `source_file`/`source_line` here carry the CALLER's
    // DECLARATION location, not the call site. That is deliberate — edges are
    // function-granular (see docs/known-limitations.md), so one edge can stand
    // for several call sites inside the caller and there is no single call-site
    // line to show. It is also what makes the `file` directory filter below mean
    // "callers living under this path". The location is honest data; what was
    // NOT honest was rendering it in a format that reads as a call site, so the
    // output now says which it is (see LOCATIONS note below).
    let mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.from_file, source_line: e.from_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: e.depth ?? 1,
      from_type: e.from_type, fan_in: 1,
      from_label: e.from_label,
      to_label: symbol,
    }));
    if (rolledUp) mapped = collapseCallerEdges(mapped, symbol);
    // File scope filter: only show callers from a specific directory
    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));
    if (mapped.length === 0) return absence(file ? `NO CALLERS from "${file}"` : `NO CALLERS for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);
    const ranked = rankCallers(mapped);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    const body = renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 10}` });

    // CONFIDENCE footer — same pattern as graph_impact (added 2026-04-27).
    // Echoes IMPACT bench showed graph_impact silently undercounting C++
    // method callers at trust=weak; graph_callers shares the same risk.
    let confidenceFooter = '';
    try {
      const { manifest } = await loadManifest(join(repoRoot, '.aify-graph'));
      const { trust: trustCount } = getUnresolvedCounts(manifest ?? {});
      const trust = computeTrustLevel(trustCount);
      const occRow = db.get(
        `SELECT COUNT(*) AS c FROM nodes WHERE label = $label`,
        { label: symbol },
      );
      const occurrences = occRow?.c ?? 0;
      const resultCount = mapped.length;
      // Same trigger as graph_impact: only fire when result actually
      // looks suspicious. Trust=strong with healthy count stays quiet.
      const suspicious = (trust === 'weak' && resultCount < 10)
        || (occurrences >= 3 && resultCount < occurrences);
      if (suspicious) {
        confidenceFooter = `\nCONFIDENCE: ${resultCount} callers · trust=${trust} · ${occurrences} indexed nodes labeled "${symbol}" · ${trustCount} unresolved CALLS edges may hide additional sites.`
          + `\n  ⚠ Likely undercount on weak-trust graphs (C++ cross-file dispatch, PHP traits/Eloquent, dynamic dispatch).`
          + `\n  Verify with: rg -n "${symbol}\\b" before any deletion, rename, or signature change.`;
      }
    } catch { /* defensive */ }

    // TRUST banner (Code-Intel v2 / L2b). One line, always present: either
    // `lsp-verified (...)` when the result carries clangd ground-truth edges
    // (with a STALE caveat when the collection is out of date) or the
    // heuristic-only undercount caveat. Shared helper so all four verbs agree.
    let trustLine = '';
    try {
      // M5: pass the queried symbol's own file so this banner and
      // code_intel_references compute the SAME coverage verdict, instead of one
      // granting the verified banner while the other returns exhaustive:false.
      trustLine = '\n' + await buildTrustLine({
        edges: mapped, db, repoRoot, truncated: edgesTruncated,
        file: targets?.[0]?.file_path ?? null,
      });
    } catch { /* defensive — never block result on trust-line failure */ }

    // P0-4: state what the printed locations ARE. The Sand Castle field test
    // scored graph_callers 0/8 on a call-site census because its `file:line`
    // values (function declarations) were read as call sites. The data was
    // right; the label was missing.
    const locationsNote = '\nLOCATIONS: each file:line is the CALLER FUNCTION\'s declaration, not a call site '
      + '(edges are function-granular — one caller may contain several call sites). '
      // -F (fixed-string): a symbol like `ns::foo(int)` interpolated into a regex
      // makes `(int)` a capture group, which silently matches `ns::fooint`.
      + `For exact call-site lines use code_intel_references, or rg -nF "${symbol}" within these files.`;

    return prefixReadWarnings(
      (rolledUp ? `${header}\n${body}` : body) + locationsNote + trustLine + confidenceFooter,
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
