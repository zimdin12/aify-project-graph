import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { noMatchMessage } from '../did-you-mean.js';
import { missScopeNote, emptyTypesAmong } from '../miss-scope.js';

export const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];

export async function graphWhereis({ repoRoot, symbol, limit = 5, expand = false }) {
  // ⛔ `limit: 0` ANSWERED A REAL SYMBOL WITH A MISS. graph-senior-dev executed it: the schema
  // accepts any integer, `LIMIT 0` returns no rows, and the population — which by design rides
  // ON the rows so that it cannot come from a second WAL snapshot — has nothing to ride on, so
  // the count falls to 0 and the not-found branch runs. A negative limit is treated by SQLite
  // as "no limit", which silently answers a different question again.
  //
  // ⇒ REFUSE RATHER THAN CLAMP. Clamping 0 up to 1 would answer a question nobody asked; a
  // request for zero rows cannot support any claim about a population. And a second COUNT to
  // rescue the zero case would put back the two-statement drift the window query removed.
  // ⚠ Validated HERE, not only in the schema: direct callers and tests bypass the schema, and a
  // guard that only exists at the boundary is not a guard on the function.
  if (!Number.isInteger(limit) || limit < 1) {
    return `INVALID REQUEST: limit must be an integer of 1 or more (got ${JSON.stringify(limit)}). `
      + 'This verb reports how many matches exist alongside the ones it shows, and a request for '
      + 'fewer than one row cannot establish that total. Nothing was searched — this is NOT a '
      + 'statement about whether "' + symbol + '" exists.';
  }
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_whereis' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // ⛔ ROWS AND POPULATION WERE TWO INDEPENDENT AUTOCOMMIT SELECTS. Under WAL a concurrent
    // write can commit between them — the server has no request queue and indexing runs out of
    // process — so `hits` and `population` could describe DIFFERENT SNAPSHOTS and render an
    // impossible "10 of 5", or misclassify the capped state. Bound now by one windowed query:
    // the count travels with the rows it counts, from a single read.
    //
    // ⚠ The predicate is derived ONCE. Two SQL strings carrying the same filter is how the
    // rows and the count drift apart later, which is the same defect one refactor away.
    const TYPES = SEARCH_TYPES.map((t) => `'${t}'`).join(',');
    const rows = db.all(
      `SELECT *, count(*) OVER () AS __population
         FROM nodes WHERE label = $label AND type IN (${TYPES}) LIMIT $limit`,
      { label: symbol, limit },
    );
    const hits = rows;
    const population = rows.length > 0 ? rows[0].__population : 0;
    const capped = population > hits.length;

    // ⛔ ONE RENDERER FOR EVERY ROUTE. There were three — capped compact, uncapped compact, and
    // expand — with three different disclosures and, in the 1-of-1 expand case, none at all.
    // The efficacy pilot found the silence in one route; I fixed that route and shipped it, and
    // the reviewer immediately executed the other two. If the basis is load-bearing for one it
    // is load-bearing for all, so there is now a single place that can say it.
    //
    // ⚠ THE POPULATION IS THE GRAPH, NOT THE REPOSITORY. This counts indexed nodes whose exact
    // label matches, among declaration types. A definition the extractor never saw is not in it.
    // Saying "every definition" would be the cap-as-total defect wearing a bigger scope.
    const basis = `nodes in this graph whose exact label is "${symbol}", among declaration types`;
    const populationLine = (shown, mode) => {
      if (population === 0) return '';
      // ⛔ THE SAME GLYPH, TWO DIFFERENT NUMERATORS, AND NO WAY OUT. ef-manager: compact's "2 of
      // 5" counts rows LISTED, expand's "1 of 5" counts rows DETAILED — and the capped route's
      // remedy ("re-run with limit=N") changes nothing here, because all N rows were already
      // fetched and there is no call that expands match 2.
      //
      // ⇒ Disclose BOTH halves. What exists: compact lists the other N-1 with file:line, from a
      // call the reader can actually make. What does not: their edges are unreachable. Naming
      // only the first half would be the "advice not conditioned on whether it applies" defect
      // again — the remedy is real for locations and absent for edges, and the sentence has to
      // say which. ef-manager's test for whether this is a remedy rather than a restatement:
      // does following it leave the reader knowing something they did not know? It does.
      //
      // ⚠ NOT building an `index` parameter to expand match 2. Nobody has asked for it,
      // including the reviewer who found this; that is structure with no consumer load. An
      // honest disclosure will produce the request if the need is real, and then there is a
      // reason instead of a guess.
      if (mode === 'expand') {
        if (population <= 1) return `
${shown} of ${population} — ${basis}. Nothing was truncated.`;
        return `
${shown} of ${population} — ${basis}. Expand mode details the FIRST match only; the other `
          + `${population - 1} are listed with file:line by graph_whereis without expand`
          + (capped ? ` (limit=${population} for the whole set)` : '')
          + '.\n⚠ There is NO call that expands match 2 — incoming/outgoing edges are available '
          + 'for the first match only, so an absence of edges here says nothing about the others.';
      }
      return capped
        ? `
⚠ SHOWING ${shown} OF ${population} — ${basis}. This verb caps at limit=${limit}; `
          + `re-run with limit=${population} for the full set.`
        : `
${shown} of ${population} — ${basis}. Nothing was truncated.`;
    };

    if (hits.length === 0) {
      // Suggest, do not redirect. This path was missed when did-you-mean landed on
      // callers/callees/impact/change_plan — and graph_whereis is the verb a field
      // user actually reached for, so the fix covered four verbs nobody hit and
      // skipped the one they did (ef-manager, 2026-07-31). Same "the fix reached
      // one path" shape this codebase keeps producing; the lesson is to enumerate
      // every emitter of a message rather than the ones that come to mind.
      // ⛔ "NO MATCH" FOR A FILE THAT IS INDEXED IS A FALSE STATEMENT ABOUT THE REPOSITORY.
      // ef-manager, in the field: graph_whereis on a real path said NO MATCH while graph_packet
      // resolved the same node. Two verbs, one node, opposite answers on existence.
      //
      // ★ Declining is CORRECT — this verb answers "where is this SYMBOL defined", matching on
      // `label` over declaration types, and a File node is neither a label match nor a
      // declaration. The defect is what the refusal SAYS. "NO MATCH" is a claim about the repo;
      // the true claim is about the QUESTION. A reader told no-match concludes the file is
      // unindexed and goes hunting a problem that does not exist.
      //
      // ⚠ Narrow on purpose: this does NOT widen the verb to resolve paths. It checks whether
      // the thing exists as a file and, if so, says which question it answered instead.
      // ⛔ AND THIS PROBE THEN UNDER-ENUMERATED, three lines under the comment about
      // under-enumerating. It listed `File` and `Directory`. This graph also holds 69
      // `Document` and 54 `Config` nodes — 123 indexed files on disk — and ef-manager found
      // every one of them still answering NO MATCH, reproduced on a second repo in another
      // language. A hand-written type list is a rule, and a rule fails silently the next time
      // someone adds a node type.
      //
      // ⇒ THE ENUMERATION IS DELETED RATHER THAN EXTENDED. "Is this path indexed" is answered
      // by whether ANY node carries that `file_path`. There is no list left to fall behind, so
      // a node type invented tomorrow is covered without an edit here.
      //
      // ⚠ It reports the TYPE it found rather than asserting "FILE", because the same query now
      // answers for directories and documents too, and printing a kind that is not the kind is
      // how every other false basis in this codebase got written.
      const asFile = db.get(
        `SELECT file_path, type FROM nodes
           WHERE file_path <> '' AND (file_path = $t OR file_path LIKE $suffix) LIMIT 1`,
        { t: symbol, suffix: `%/${symbol}` },
      );
      if (asFile?.file_path) {
        const kind = String(asFile.type || 'node').toLowerCase();
        const base = `NOT A SYMBOL: "${symbol}" is a PATH in this graph (${asFile.file_path}, `
          + `indexed as ${kind}), and graph_whereis answers "where is this SYMBOL defined". `
          + 'The path exists — this verb is the wrong question, not evidence of absence.\n'
          + '⚠ graph_search matches on BASENAME, so re-running this path there returns nothing '
          + 'at any kind. Use one of these instead:\n'
          + `NEXT: graph_packet(target="${asFile.file_path}") — orientation for a file\n`
          + `NEXT: graph_pull(node="${asFile.file_path}") — cross-layer context for a file`;
        const fileCaveat = staleNotFoundCaveat(freshness);
        return fileCaveat ? `${base}\n${fileCaveat}` : base;
      }
      // ⛔ THE MISS ROUTE MADE A CLAIM IT COULD NOT SUPPORT. `NO MATCH` reads as absence from
      // the repository; what was actually searched is `label` over SEARCH_TYPES. Measured on
      // this repo's own graph: no `Variable` node exists at all — tree-sitter emits none, and
      // the only producer is the code-intel importer — so every module constant answers NO
      // MATCH. `graph_whereis("SEARCH_TYPES")`, a constant declared in THIS FILE, was one.
      //
      // ⚠ BOTH MISS ROUTES GET IT. `noMatchMessage` returns suggestions OR the bare wording,
      // and a fix applied to one branch while its sibling keeps the old behaviour is the most
      // repeated defect in this codebase. The note is appended after the join, where there is
      // one string left and no branch to miss.
      //
      // ⚠ SEARCH_TYPES is PASSED, not re-listed: the sentence and the query must not be able
      // to drift apart. Two copies of a population is how a disclosure ends up describing a
      // search that no longer happens.
      // ⛔ THE TOP LINE SENT THE READER TO A VERB THAT CANNOT ANSWER THE CASE JUST DIAGNOSED.
      // When an empty declaration type explains the miss, graph_search is guaranteed to fail —
      // it queries the same node table. ef-manager executed exactly that on echoes: the
      // constant exists at CylindricalPosition.h:102, and the suggested search returned NO
      // RESULTS. The correct next step is the source file, and it has to be the FIRST thing
      // said, because the top line is the one that gets followed.
      const emptyDeclTypes = emptyTypesAmong(db, SEARCH_TYPES);
      const base = noMatchMessage(db, symbol, emptyDeclTypes.length > 0
        ? { nextInstruction: 'READ THE SOURCE FILE (grep/Read) — see the scope note below: '
            + 'declaration types are missing from this graph, and graph_search queries the same '
            + 'node table, so it cannot find what was never indexed.' }
        : undefined);
      const scope = missScopeNote(db, { types: SEARCH_TYPES, what: 'declaration types' });
      const caveat = staleNotFoundCaveat(freshness);
      return [base, scope, caveat].filter(Boolean).join('\n');
    }

    if (!expand) {
      return prefixReadWarnings(
        renderCompact({ nodes: hits, edges: [] }) + populationLine(hits.length, 'compact'),
        freshness.warnings,
      );
    }

    // Expand mode: include top 3 incoming + 3 outgoing edges (replaces graph_summary)
    const n = hits[0];
    const incoming = db.all(
      `SELECT e.*, src.label AS from_label FROM edges e
       JOIN nodes src ON src.id = e.from_id
       WHERE e.to_id = $id ORDER BY e.confidence DESC LIMIT 3`,
      { id: n.id }
    );
    const outgoing = db.all(
      `SELECT e.*, tgt.label AS to_label FROM edges e
       JOIN nodes tgt ON tgt.id = e.to_id
       WHERE e.from_id = $id ORDER BY e.confidence DESC LIMIT 3`,
      { id: n.id }
    );
    const edges = [
      ...incoming.map(e => ({ ...e, from_label: e.from_label })),
      ...outgoing.map(e => ({ ...e, to_label: e.to_label })),
    ];
    // ⚠ EXPAND MODE TRUNCATES HARDER THAN COMPACT AND WAS EQUALLY SILENT: it renders ONE node
    // regardless of how many matched. On the 60-definition case that is 1 of 60 with no marker.
    // This file's own comment thirty lines up records the lesson — "enumerate every emitter of
    // a message rather than the ones that come to mind" — and the first version of this very
    // fix patched only the compact branch.
    // ⛔ AND THIS ROUTE SAID NOTHING AT ALL WHEN population === 1. The old notice was gated on
    // `population > 1`, so the single-definition expand case — the commonest one — emitted no
    // count and no basis. The reviewer executed exactly that and found the pilot's gap alive in
    // a public mode, in the commit that claimed to have closed it.
    return prefixReadWarnings(
      renderCompact({ nodes: [n], edges }) + populationLine(1, 'expand'),
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
