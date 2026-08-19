import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { noMatchMessage } from '../did-you-mean.js';

export const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Variable', 'Test', 'Route', 'Entrypoint'];

export async function graphWhereis({ repoRoot, symbol, limit = 5, expand = false }) {
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
      if (mode === 'expand') {
        return `
${shown} of ${population} — ${basis}. Expand mode details the FIRST match only`
          + (capped ? `; re-run without expand, or with limit=${population}, for the whole set.` : '.');
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
      const asFile = db.get(
        `SELECT file_path FROM nodes WHERE type IN ('File','Directory')
           AND (file_path = $t OR file_path LIKE $suffix) LIMIT 1`,
        { t: symbol, suffix: `%/${symbol}` },
      );
      if (asFile?.file_path) {
        const base = `NOT A SYMBOL: "${symbol}" is a FILE in this graph (${asFile.file_path}), `
          + 'and graph_whereis answers "where is this SYMBOL defined". The file exists — this '
          + 'verb is the wrong question, not evidence of absence.\n'
          + `NEXT: graph_packet(target="${asFile.file_path}") — orientation for a file\n`
          + `NEXT: graph_pull(node="${asFile.file_path}") — cross-layer context for a file`;
        const fileCaveat = staleNotFoundCaveat(freshness);
        return fileCaveat ? `${base}\n${fileCaveat}` : base;
      }
      const base = noMatchMessage(db, symbol);
      const caveat = staleNotFoundCaveat(freshness);
      return caveat ? `${base}\n${caveat}` : base;
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
