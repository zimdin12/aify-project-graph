import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallees } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { selectBestRoot } from './path.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { buildTrustLine, buildAbsenceTrustLine } from '../lsp-evidence.js';
import { EXECUTION_FAMILY } from '../../storage/taxonomy.js';

const EXECUTION_RELATIONS = EXECUTION_FAMILY;

export async function graphCallees({ repoRoot, symbol, depth = 1, top_k = 10, file }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_callees' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = resolveSymbol(db, symbol);
    if (sources.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
    const ambiguity = buildAmbiguousMatchMessage(symbol, sources);
    if (ambiguity) return ambiguity;
    const root = selectBestRoot(sources);
    const sourceIds = [root.id];

    let edges;
    if (depth <= 1) {
      const placeholders = sourceIds.map((_, i) => `$s${i}`).join(',');
      const params = {};
      sourceIds.forEach((id, i) => { params[`s${i}`] = id; });
      edges = db.all(
        `SELECT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         LIMIT 100`,
        params
      );
    } else {
      const sid = root.id;
      edges = db.all(
        `WITH RECURSIVE callees(from_id, to_id, depth) AS (
           SELECT from_id, to_id, 1
           FROM edges
           WHERE from_id = $sid AND relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
           UNION ALL
           SELECT e.from_id, e.to_id, c.depth + 1
           FROM edges e
           JOIN callees c ON e.from_id = c.to_id
           WHERE e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')}) AND c.depth < $depth AND c.depth <= 10
         )
         SELECT DISTINCT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line, c.depth
         FROM callees c
         JOIN edges e
           ON e.from_id = c.from_id
          AND e.to_id = c.to_id
          AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         JOIN nodes n ON n.id = e.to_id
         LIMIT 100`,
        { sid, depth }
      );
    }

    // P0-5: a base virtual's dynamic-dispatch callees are its derived
    // override implementations. clangd resolves `base*->virt()` to the declared
    // base method only; OVERRIDDEN_BY (base→derived, INFERRED) lets callees
    // continue through vtable dispatch. Query forward from the root and merge.
    // Marked INFERRED in output. The verified override set is
    // code_intel_hierarchy kind=subtypes on the OWNING CLASS (clangd returns the
    // derived classes; their same-named methods are the overrides). NOTE: passing
    // the METHOD to kind=subtypes resolves to the method's return type, not its
    // overrides — validated against real clangd on echoes ISimDomain.
    const overrideEdges = db.all(
      `SELECT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line
       FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.from_id = $sid AND e.relation = 'OVERRIDDEN_BY'
       LIMIT 100`,
      { sid: root.id },
    );

    // I1 — gate the absence claim on exhaustive evidence (see callers.js).
    const absence = async (msg) => {
      let line = '';
      try { line = '\n' + await buildAbsenceTrustLine({ noun: 'callees', db, repoRoot }); }
      catch { /* defensive */ }
      return prefixReadWarnings(msg + line, freshness.warnings);
    };

    if (edges.length === 0 && overrideEdges.length === 0) return absence(`NO CALLEES for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);

    let mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.to_file, source_line: e.to_line,
      confidence: e.confidence,
      provenance: e.provenance ?? 'EXTRACTED',
      depth: e.depth ?? 1,
      from_type: 'Function', fan_in: 1,
      to_label: e.to_label,
    }));
    // Merge virtual-override callees (INFERRED). Kept separate from the ranked
    // execution edges so the override links aren't down-ranked out of view —
    // they're the whole point of following dynamic dispatch here.
    let overrideCount = 0;
    const overrideMapped = overrideEdges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      source_file: e.to_file, source_line: e.to_line,
      confidence: e.confidence ?? 0.7,
      provenance: e.provenance ?? 'INFERRED',
      depth: 1, from_type: 'Method', fan_in: 1,
      from_label: root.label,
      to_label: e.to_label,
    })).filter(e => !file || (e.source_file && e.source_file.startsWith(file)));
    overrideCount = overrideMapped.length;

    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));
    if (mapped.length === 0 && overrideCount === 0) return absence(file ? `NO CALLEES in "${file}"` : `NO CALLEES for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);
    const ranked = rankCallees(mapped);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    let body = renderCompact({ nodes: [], edges: [...kept, ...overrideMapped], truncated: dropped, suggestion: `top_k=${top_k + 10}` });

    // P0-5 cross-reference: flag the INFERRED override callees and point at the
    // clangd-verified hierarchy verb. IMPORTANT (validated on real clangd):
    // kind=subtypes on a METHOD resolves to the method's return type, not its
    // overrides — the verified override set comes from kind=subtypes on the
    // OWNING CLASS, or kind=callers on the virtual method itself.
    if (overrideCount > 0) {
      const owningClass = symbol.includes('::') ? symbol.slice(0, symbol.lastIndexOf('::')) : null;
      const verifyHint = owningClass
        ? `code_intel_hierarchy(symbol="${owningClass}", kind="subtypes") for the derived classes, then their same-named override`
        : `code_intel_hierarchy(kind="subtypes") on the OWNING CLASS for derived overriders, or code_intel_hierarchy(symbol="${symbol}", kind="callers") on the virtual method`;
      body += `\nNOTE: ${overrideCount} OVERRIDDEN_BY callee${overrideCount === 1 ? ' is an' : 's are'} INFERRED virtual-override link${overrideCount === 1 ? '' : 's'} (dynamic dispatch through a base virtual).`
        + ` Verified overrides: ${verifyHint}.`;
    }

    // TRUST banner (Code-Intel v2 / L2b). callees.js previously had NO trust
    // caveat at all — added here so a heuristic-only callee list carries the
    // same undercount warning as callers/impact, and an lsp-verified one is
    // marked as clangd ground truth. One line, shared helper.
    let trustLine = '';
    try {
      trustLine = '\n' + await buildTrustLine({ edges: mapped, db, repoRoot });
    } catch { /* defensive — never block result on trust-line failure */ }

    return prefixReadWarnings(
      body + trustLine,
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
