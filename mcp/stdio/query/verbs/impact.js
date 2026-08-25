import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { expandClassRollupTargets } from './target_rollup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { loadManifest } from '../../freshness/manifest.js';
import { computeTrustLevel } from './health.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { buildTrustLine, buildAbsenceTrustLine } from '../lsp-evidence.js';
import { IMPACT_FAMILY } from '../../storage/taxonomy.js';
import { noMatchMessage } from '../did-you-mean.js';

// IMPACT_FAMILY includes OVERRIDDEN_BY (it belongs to the blast-radius family),
// but impact.js queries override edges with a dedicated FORWARD walk below
// (base virtual → its overrides) rather than the reverse CALLS walk. The
// recursive reverse traversal therefore uses the family minus OVERRIDDEN_BY —
// behavior-preserving vs the prior IMPACT_RELATIONS list.
const IMPACT_RELATIONS = IMPACT_FAMILY.filter((r) => r !== 'OVERRIDDEN_BY');

export async function graphImpact({ repoRoot, symbol, depth = 3, top_k = 30 }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_impact' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const { targets, targetIds, rolledUp, header, error } = expandClassRollupTargets(db, symbol);
    if (error) return error;
    if (targets.length === 0) return noMatchMessage(db, symbol);

    const relFilter = IMPACT_RELATIONS.map(r => `'${r}'`).join(',');
    const placeholders = targetIds.map((_, index) => `$tid${index}`).join(', ');
    const params = Object.fromEntries(targetIds.map((id, index) => [`tid${index}`, id]));

    const edges = db.all(
      `WITH RECURSIVE impact(from_id, to_id, depth) AS (
         SELECT from_id, to_id, 1
         FROM edges
         WHERE to_id IN (${placeholders}) AND relation IN (${relFilter})
         UNION ALL
         SELECT e.from_id, e.to_id, i.depth + 1
         FROM edges e
         JOIN impact i ON e.to_id = i.from_id
         WHERE e.relation IN (${relFilter}) AND i.depth < $depth AND i.depth <= 10
       )
       -- DEDUPED PATHS, NOT EDGES. SELECT DISTINCT kept i.depth in the distinct key, so one
       -- edge reachable by two paths OF DIFFERENT LENGTHS survived twice, and the confidence
       -- line then counted it twice. the field test measured it in the field: five rows rendered,
       -- two byte-identical, four distinct edges, "5 edges found".
       -- Reproduced by depth: absent at depth=1, present at depth=3.
       --
       -- ⇒ GROUP BY the edge's own identity and keep the SHORTEST depth that reached it, which
       -- is the meaningful one. Deduping HERE rather than after means the rows the reader sees
       -- and the number describing them come from ONE operation, so they cannot drift apart —
       -- the same conclusion as deleting the type list in the path probe rather than extending
       -- it, and as deduping the packet NEXT lines at emission rather than testing for repeats.
       SELECT e.*, n.label AS from_label, n.type AS from_type,
              n.file_path AS from_file, n.start_line AS from_line,
              t.label AS to_label, MIN(i.depth) AS depth
       FROM impact i
       JOIN edges e
         ON e.from_id = i.from_id
        AND e.to_id = i.to_id
        AND e.relation IN (${relFilter})
       JOIN nodes n ON n.id = e.from_id
       LEFT JOIN nodes t ON t.id = e.to_id
       -- The edges table has no surrogate id. Identity is the tuple, and source_file/line
       -- are part of it ON PURPOSE: two genuine call sites to the same target are two
       -- edges and must both survive. Only the path duplicate collapses.
       GROUP BY e.from_id, e.to_id, e.relation, e.source_file, e.source_line
       LIMIT 100`,
      { ...params, depth }
    );

    // P0-5: forward virtual-override expansion. OVERRIDDEN_BY is a base→derived
    // edge (FROM a base virtual TO its overrides). Impact ("what's affected if I
    // change this") should surface the override implementations when the target
    // IS a base virtual: a contract change to the base ripples to every
    // overrider. The reverse CALLS walk above won't pick these up (it walks
    // INTO the target), so query them forward explicitly. Marked INFERRED in
    // the output — the verified set is code_intel_hierarchy kind=subtypes on the
    // OWNING CLASS (kind=subtypes on a METHOD resolves to its return type, not
    // its overrides — validated against real clangd on echoes ISimDomain).
    const overrideEdges = db.all(
      `SELECT e.*, n.label AS from_label, n.type AS from_type,
              n.file_path AS from_file, n.start_line AS from_line,
              t.label AS to_label, t.file_path AS to_file, t.start_line AS to_line
       FROM edges e
       JOIN nodes n ON n.id = e.from_id
       LEFT JOIN nodes t ON t.id = e.to_id
       WHERE e.from_id IN (${placeholders}) AND e.relation = 'OVERRIDDEN_BY'
       LIMIT 100`,
      params,
    );

    // I1 — gate the absence claim on exhaustive evidence (see callers.js). A
    // "NO IMPACT" line can green-light a deletion; it must carry the heuristic
    // non-exhaustive caveat unless fresh index-ready clangd evidence backs it.
    if (edges.length === 0 && overrideEdges.length === 0) {
      let line = '';
      try { line = '\n' + await buildAbsenceTrustLine({ noun: 'impact', db, repoRoot }); }
      catch { /* defensive */ }
      return prefixReadWarnings(
        // `graph_status()` is not in the default tools/list profile, so this told most readers
        // to call something they cannot reach. graph_health is the listed verb that answers
        // "can I trust this", which is the actual question behind the suggestion.
        `NO IMPACT — no edges found for "${symbol}". The symbol may have 0 callers, or the graph may be incomplete. Check graph_health().` + line,
        freshness.warnings,
      );
    }

    const mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.from_file, source_line: e.from_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: e.depth ?? 1,
      from_type: e.from_type, from_label: e.from_label,
      to_label: e.to_label, fan_in: 1,
    }));

    // Append override edges with the DERIVED override as the navigable target.
    // Location points at the override implementation so an agent can jump to
    // the code that must be updated to honor the changed base contract.
    let overrideCount = 0;
    for (const e of overrideEdges) {
      mapped.push({
        from_id: e.from_id, to_id: e.to_id, relation: e.relation,
        source_file: e.to_file, source_line: e.to_line,
        confidence: e.confidence ?? 0.7,
        provenance: e.provenance ?? 'INFERRED',
        depth: 1,
        from_type: e.from_type, from_label: e.from_label,
        to_label: e.to_label, fan_in: 1,
      });
      overrideCount += 1;
    }
    const { kept, dropped } = enforceBudget(mapped, top_k);
    let body = renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `depth=${depth + 1}` });

    // P0-5 cross-reference: when INFERRED virtual-override edges actually
    // survived the budget, point the agent at the clangd-verified hierarchy
    // verb so it knows these are static best-effort overrides, not ground truth.
    overrideCount = kept.filter((e) => e.relation === 'OVERRIDDEN_BY').length;
    if (overrideCount > 0) {
      // Validated on real clangd: kind=subtypes on a METHOD resolves to its
      // return type, not its overrides — run subtypes on the OWNING CLASS (or
      // callers on the virtual method) for the verified override set.
      const owningClass = symbol.includes('::') ? symbol.slice(0, symbol.lastIndexOf('::')) : null;
      const verifyHint = owningClass
        ? `code_intel_hierarchy(symbol="${owningClass}", kind="subtypes") for the derived classes`
        : `code_intel_hierarchy(kind="subtypes") on the OWNING CLASS for derived overriders, or code_intel_hierarchy(symbol="${symbol}", kind="callers") on the virtual method`;
      body += `\nNOTE: ${overrideCount} OVERRIDDEN_BY edge${overrideCount === 1 ? ' is an' : 's are'} INFERRED static virtual-override link${overrideCount === 1 ? '' : 's'} (base virtual → derived overrides).`
        + ` Verified override set: ${verifyHint}.`;
    }

    // CONFIDENCE footer (added 2026-04-27 after the echoes IMPACT bench
    // showed graph_impact returning 2 callers when grep found ~65 — silent
    // undercount caused by unresolved cross-file CALLS edges at trust=weak).
    // Compares result count to label-occurrence count in the indexed graph
    // and to the total unresolved-edge backlog. If the result looks
    // suspiciously thin, append an explicit verify-with-Grep nudge so the
    // agent doesn't take the count at face value when planning a deletion
    // or rename.
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
      // Fire only when the result actually looks suspicious:
      // (a) trust=weak AND result is small/empty (the IMPACT bench's
      //     silent-undercount failure mode), or
      // (b) more indexed nodes labeled <symbol> than edges returned —
      //     the graph likely missed cross-file resolution.
      // Trust=strong with healthy result count stays quiet.
      const suspicious = (trust === 'weak' && resultCount < 10)
        || (occurrences >= 3 && resultCount < occurrences);
      if (suspicious) {
        const parts = [
          `[${resultCount} edges found`,
          `trust=${trust}`,
          `${occurrences} indexed node${occurrences === 1 ? '' : 's'} labeled "${symbol}"`,
          `${trustCount} unresolved CALLS edges not attributed to any caller`,
        ];
        // ⛔ THE SAME ONE-DIRECTIONAL LEAN graph_callers CARRIED, and finding it here is the point.
        // The lesson written at that site is "when a claim is withdrawn, grep for every surface that
        // restates it before calling the fix done" — fixing callers.js alone would have been that
        // defect a fourth time, in the commit that names it.
        //
        // ⚠ "Likely undercount" tells a reader the list is a FLOOR, and a floor licenses acting on
        // what is shown. Heuristic edges resolve calls BY NAME, so the list is not a floor: it can
        // overcount with unrelated same-named calls as well as undercount.
        const overcountRisk = occurrences >= 2 || symbol.length <= 8;
        confidenceFooter = `\nCONFIDENCE: ${parts.join(' · ')}.`
          + `\n  ⚠ This list is NOT a floor. On a weak-trust graph it can UNDERCOUNT (C++ cross-file`
          + ` dispatch, PHP traits/Eloquent, dynamic dispatch) and, because heuristic edges resolve`
          + ` calls BY NAME, it can also OVERCOUNT with unrelated same-named calls`
          + `${overcountRisk ? ' — and this symbol is exactly the shape that overcounts' : ''}.`
          + `\n  Verify with: rg -n "${symbol}\\b" before any deletion, rename, or signature change.`;
      }
    } catch { /* defensive — never block result on confidence-check failure */ }

    // TRUST banner (Code-Intel v2 / L2b). See callers.js for the rationale —
    // shared helper keeps the line identical across all four read verbs.
    let trustLine = '';
    try {
      trustLine = '\n' + await buildTrustLine({ edges: mapped, db, repoRoot });
    } catch { /* defensive — never block result on trust-line failure */ }

    return prefixReadWarnings(
      (rolledUp ? `${header}\n${body}` : body) + trustLine + confidenceFooter,
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
