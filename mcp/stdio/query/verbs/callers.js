import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallers } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { collapseCallerEdges, expandClassRollupTargets } from './target_rollup.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { loadManifest } from '../../freshness/manifest.js';
import { computeTrustLevel } from './health.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { buildTrustLine, buildAbsenceTrustLine, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';
import { EXECUTION_FAMILY, CALL_FAMILY } from '../../storage/taxonomy.js';
import { normalizePathArg } from '../../util/paths.js';
import { noMatchMessage } from '../did-you-mean.js';
// ⚠ Shared with graph_callees, which has the identical defect mirrored onto outgoing edges.
// One owner: fixing one verb and pasting into the other is how the two drift apart.
import { unsearchedRelationNote } from '../unsearched-scope.js';
import { indexedScopePhrase } from '../miss-scope.js';

const EXECUTION_RELATIONS = EXECUTION_FAMILY;

// ⛔ THE RELATIONS THIS VERB DELIBERATELY DOES NOT SEARCH. Derived by SUBTRACTING one family from
// the other, never listed — the moment a relation joins CALL_FAMILY it belongs here automatically,
// and a hand-written copy would silently stop covering it.
const UNSEARCHED_RELATIONS = Object.freeze(CALL_FAMILY.filter((r) => !EXECUTION_FAMILY.includes(r)));

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
    const { targets, targetIds, rolledUp, header, error } = expandClassRollupTargets(db, symbol, { withCallerSets: true });
    if (error) return error;
    // ⛔ A NOT-FOUND IS A CLAIM, AND A STALE INDEX MAKES IT A FALSE ONE. `staleNotFoundCaveat` is
    // MEASURED (n commits behind HEAD) and SILENT on a fresh index, so it adds no noise on the happy
    // path — the standard the whereis miss-scope work set: a generic "may be incomplete" costs the
    // reader as much as a false claim. find/search/whereis already did this; these did not.
    if (targets.length === 0) return [noMatchMessage(db, symbol), staleNotFoundCaveat(freshness)].filter(Boolean).join('\n');

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
      // ⛔ READ THE DATABASE BEFORE THE FIRST AWAIT. This function is async and its callers `return`
      // its promise, so the enclosing `finally { db.close() }` runs while that promise is still
      // pending — any db access AFTER an await here fails with "The database connection is not
      // open". Placed after the await, the scope note threw on every call and its catch returned
      // '', so the feature was inert and the output looked exactly as it had before.
      const scope = unsearchedRelationNote({
        db, column: 'to_id', placeholders, params, symbol,
        searched: EXECUTION_RELATIONS, unsearched: UNSEARCHED_RELATIONS,
        // ⚠ graph_impact, NOT graph_preflight: the default tool profile does not list preflight,
        // and the repo's remedy-reachability guard rejects pointing a reader at an uncallable verb.
        remedy: 'graph_impact answers "who touches this" across the wider family.',
      });
      let line = '';
      // The language comes from the resolved target, so the construct-coverage clause appears on a
      // C/C++ absence and costs zero bytes anywhere else.
      try { line = '\n' + await buildAbsenceTrustLine({ noun: 'callers', db, repoRoot, freshness, language: targets[0]?.language }); }
      // ⛔ NOT an empty catch. Measured 2026-09-02: swallowing this shipped a BARE absence with no
      // TRUST, no SCOPE and no NOT MODELLED — indistinguishable from an authoritative "nothing calls
      // this". The answer still returns; the agent is told the caveat is missing.
      catch { line = '\n' + ABSENCE_TRUST_UNAVAILABLE; }
      // ⚠ The scope note goes WITH the absence claim, where the reader is deciding whether nothing
      // uses this symbol — not into a separate field they would have to know to consult.
      return prefixReadWarnings(msg + line + scope, freshness.warnings);
    };

    if (edges.length === 0) return absence(`NO CALLERS for "${symbol}"${indexedScopePhrase(db)}. Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);

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
    if (mapped.length === 0) return absence(file ? `NO CALLERS from "${file}"${indexedScopePhrase(db)}` : `NO CALLERS for "${symbol}"${indexedScopePhrase(db)}. Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);
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
        // ⛔ THE LEAN THIS BLOCK USED TO CARRY, TWO LINES BELOW THE SENTENCE THAT WITHDREW IT.
        //
        // `HEURISTIC_TRUST_LINE` was repaired to name BOTH directions after `graph_callers("has")`
        // returned 100 callers that were nearly all `Map.has()`. This footer — the half carrying
        // the NUMBERS, and the more authoritative-looking one — still said only "Likely undercount"
        // and "may hide additional sites". the field test, field-testing the fix: "the subset story
        // restated, immediately after the sentence that withdrew it. A reader who takes the last
        // word takes the wrong one."
        //
        // ⇒ THIRD TIME IN ONE SESSION a repair landed in one surface and left the claim standing in
        // another: a retracted H1 over a corrected body, a reasoning comment fixed while the printed
        // output still said 38%, and now TRUST fixed while CONFIDENCE leaned. ⇒ When a claim is
        // withdrawn, grep for every surface that restates it before calling the fix done.
        //
        // ⚠ AND THE DIRECTION MATTERS MORE HERE THAN ANYWHERE. the field test, asked directly whether
        // the old wording would have misled them: "YES… 'may undercount' says the list is a floor,
        // and a floor licenses acting on what IS shown — that is the whole value of a floor." So it
        // did not merely omit the overcount; it named the direction that makes a list SAFE TO USE.
        const overcountRisk = occurrences >= 2 || symbol.length <= 8;
        confidenceFooter = `\nCONFIDENCE: ${resultCount} callers · trust=${trust} · ${occurrences} indexed nodes labeled "${symbol}" · ${trustCount} unresolved CALLS edges not attributed to any caller.`
          + `\n  ⚠ This list is NOT a floor. On a weak-trust graph it can UNDERCOUNT (C++ cross-file`
          + ` dispatch, PHP traits/Eloquent, dynamic dispatch) and, because heuristic edges resolve`
          + ` calls BY NAME, it can also OVERCOUNT with unrelated same-named calls`
          + `${overcountRisk ? ' — and this symbol is exactly the shape that overcounts' : ''}.`
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
        // A NON-EMPTY caller set is the answer an agent acts on, and it was the one result shape
        // carrying no word about the agent's own uncommitted work. Relevance-gated inside, so a
        // dirty tree alone says nothing — only a file that MENTIONS this symbol does.
        freshness, symbol,
      });
    // ⛔ Still never BLOCKS the result — but no longer silent; see lsp-evidence.js
    // RESULTS_TRUST_UNAVAILABLE.
    } catch { trustLine = '\n' + RESULTS_TRUST_UNAVAILABLE; }

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
