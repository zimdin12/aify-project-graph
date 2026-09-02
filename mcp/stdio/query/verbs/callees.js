import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallees } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { selectBestRoot } from './path.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { buildTrustLine, buildAbsenceTrustLine, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';
import { EXECUTION_FAMILY, CALL_FAMILY } from '../../storage/taxonomy.js';
import { normalizePathArg } from '../../util/paths.js';
import { scanDynamicBoundaries, renderDynamicBoundaries, readSymbolBody } from '../dynamic-boundaries.js';
import { noMatchMessage } from '../did-you-mean.js';
// ⚠ Shared with graph_callers. This verb is the exact MIRROR — same narrowing, outgoing
// instead of incoming — so it gets the same owner rather than a pasted copy that can drift.
import { unsearchedRelationNote } from '../unsearched-scope.js';

const EXECUTION_RELATIONS = EXECUTION_FAMILY;

// ⛔ DERIVED BY SUBTRACTION, never listed — a relation joining CALL_FAMILY is covered with no edit.
// Measured on click: 71 of 88 "NO CALLEES" answers (81%) had unsearched OUTGOING edges.
const UNSEARCHED_RELATIONS = Object.freeze(CALL_FAMILY.filter((r) => !EXECUTION_FAMILY.includes(r)));

export async function graphCallees({ repoRoot, symbol, depth = 1, top_k = 10, file }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  file = normalizePathArg(file); // accept Windows backslash file filters (mirror graph_callers)
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_callees' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = resolveSymbol(db, symbol);
    // ⛔ A NOT-FOUND IS A CLAIM, AND A STALE INDEX MAKES IT A FALSE ONE. `staleNotFoundCaveat` is
    // MEASURED (n commits behind HEAD) and SILENT on a fresh index, so it adds no noise on the happy
    // path — the standard the whereis miss-scope work set: a generic "may be incomplete" costs the
    // reader as much as a false claim. find/search/whereis already did this; these did not.
    if (sources.length === 0) return [noMatchMessage(db, symbol), staleNotFoundCaveat(freshness)].filter(Boolean).join('\n');
    const ambiguity = buildAmbiguousMatchMessage(symbol, sources);
    if (ambiguity) return ambiguity;
    const root = selectBestRoot(sources);
    const sourceIds = [root.id];
    // ⚠ HOISTED. These were declared inside the depth<=1 branch, so the absence path below could not
    // see them. The scope note needs the same target set the query used — reconstructing it there
    // would be a second implementation of "which nodes is this about".
    const scopePlaceholders = sourceIds.map((_, i) => `$s${i}`).join(',');
    const scopeParams = {};
    sourceIds.forEach((id, i) => { scopeParams[`s${i}`] = id; });

    let edges;
    if (depth <= 1) {
      const placeholders = sourceIds.map((_, i) => `$s${i}`).join(',');
      const params = {};
      sourceIds.forEach((id, i) => { params[`s${i}`] = id; });
      edges = db.all(
        `SELECT e.*, n.label AS to_label, n.type AS to_type, n.file_path AS to_file, n.start_line AS to_line
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})
         -- Mirror rankCallees so the SQL cut and the final ranking agree: a
         -- verified edge late in the body must not be dropped by LIMIT in favour
         -- of a heuristic one early in it. Without any ORDER BY at all this
         -- LIMIT truncated arbitrarily.
         ORDER BY CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 0 ELSE 1 END,
                  e.source_line, n.label
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
         ORDER BY CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 0 ELSE 1 END,
                  c.depth, e.source_line, n.label
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
      // ⛔ BEFORE THE FIRST AWAIT. Callers `return` this promise, so the enclosing
      // `finally { db.close() }` has already run by the time an awaited continuation resumes — a db
      // read placed after the await throws on every call and the catch returns '', leaving the
      // feature inert with output byte-identical to not existing. That happened in graph_callers,
      // and is why this note is computed first here.
      const scope = unsearchedRelationNote({
        db, column: 'from_id', placeholders: scopePlaceholders, params: scopeParams, symbol,
        searched: EXECUTION_RELATIONS, unsearched: UNSEARCHED_RELATIONS,
        // ⚠ graph_neighbors is not in the default tool profile — and neither is graph_callees, so
        // the remedy-reachability invariant ("a LISTED verb must not name an UNLISTED one") permits
        // it: anyone who reached this verb already has the full toolset.
        remedy: 'graph_neighbors shows every relation on this symbol, in both directions.',
      });
      let line = '';
      try { line = '\n' + await buildAbsenceTrustLine({ noun: 'callees', db, repoRoot, language: sources[0]?.language }); }
      // ⛔ NOT an empty catch — see lsp-evidence.js ABSENCE_TRUST_UNAVAILABLE.
      catch { line = '\n' + ABSENCE_TRUST_UNAVAILABLE; }
      return prefixReadWarnings(msg + line + scope, freshness.warnings);
    };

    if (edges.length === 0 && overrideEdges.length === 0) return absence(`NO CALLEES for "${symbol}". Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);

    let mapped = edges.map(e => ({
      from_id: e.from_id, to_id: e.to_id, relation: e.relation,
      // Displayed location stays the CALLEE'S DEFINITION — that is where the
      // agent navigates next.
      source_file: e.to_file, source_line: e.to_line,
      // The CALL SITE is kept separately for ordering. Overwriting source_line
      // with the definition line discarded the only field that could express
      // call order, which is why the list came back scrambled (see rankCallees).
      call_line: e.source_line ?? null,
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
    // OVERLOAD SELF-CALL DISCLOSURE. Node identity carries no signature, so all
    // overloads of a name in one file collapse to a single node — a call from
    // `render(int)` to `render(Widget&)` renders as the symbol calling itself.
    // "This function is recursive" changes how an agent reasons about it, so a
    // self-edge on a merged node must not be presented as recursion.
    const selfEdges = [...kept, ...overrideMapped].filter((e) => e.to_id === root.id);
    let overloadCount = 1;
    try {
      const extra = JSON.parse(root.extra || '{}');
      overloadCount = extra.overloads ?? 1;
    } catch { /* extra unparseable — claim nothing */ }
    if (selfEdges.length > 0 && overloadCount > 1) {
      body += `\nNOTE: "${root.label}" is ONE node merging ${overloadCount} overloads in ${root.file_path}`
        + ` (symbol identity does not yet carry the signature). The self-CALLS edge${selfEdges.length === 1 ? '' : 's'} above`
        + ' may be a call to a DIFFERENT overload rather than recursion — read the call site before treating it as recursive.';
    }

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
      trustLine = '\n' + await buildTrustLine({ edges: mapped, db, repoRoot, file: root?.file_path ?? null });
    // ⛔ Still never BLOCKS the result — but no longer silent. An empty banner lets a partial caller
    // set read as COMPLETE; see lsp-evidence.js RESULTS_TRUST_UNAVAILABLE.
    } catch { trustLine = '\n' + RESULTS_TRUST_UNAVAILABLE; }

    // P2-1: turn "this set may be incomplete" into a POINTER. A callee list is
    // OUTGOING, which is exactly the direction the boundary scanner models — a
    // dynamic-dispatch site inside THIS symbol's body is a place where its callee
    // set provably ends, and naming the site beats a generic caveat.
    //
    // Deliberately NOT wired into graph_callers: that question is INCOMING, and
    // scanning the queried symbol's own body would report its outgoing dispatch
    // as if it explained missing callers. (The obvious alternative — treating
    // REFERENCES edges as "address taken, may be invoked indirectly" — measured
    // too noisy to use: name-collision matches like `file`/`abs`/`trust`
    // dominate, and noise on the trust surface is worse than silence.)
    let boundaryBlock = '';
    try {
      const src = readSymbolBody(repoRoot, root);
      if (src) {
        const matches = scanDynamicBoundaries({
          source: src,
          language: root.language,
          baseLine: root.start_line ?? 1,
        });
        const rendered = renderDynamicBoundaries(matches, { symbolLabel: root.label });
        if (rendered) boundaryBlock = `\n${rendered}`;
      }
    } catch { /* best-effort — never block the result on boundary scanning */ }

    return prefixReadWarnings(
      body + trustLine + boundaryBlock,
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
