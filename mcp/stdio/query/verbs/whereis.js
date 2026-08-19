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
    const hits = db.all(
      `SELECT * FROM nodes WHERE label = $label AND type IN (${SEARCH_TYPES.map(t => `'${t}'`).join(',')}) LIMIT $limit`,
      { label: symbol, limit }
    );
    // ⛔ THIS VERB IS THE ESCAPE HATCH EVERY OTHER DISCLOSURE POINTS AT, AND IT WAS CAPPED AND
    // SILENT. graph_packet and graph_consequences both end their truncation warnings with
    // `graph_whereis(symbol="X") — every definition, unsampled`. It returns `LIMIT 5` by
    // default with no total and no marker, so on a symbol with 60 definitions the remedy
    // silently returned five and the promise was false.
    //
    // ★ ef-manager flagged it from the disclosure text alone — "worth checking whether
    // graph_whereis, which both verbs point to as 'every definition, unsampled', actually is
    // unsampled above 50 rows. If it caps too, the escape hatch has the same hole and every
    // disclosure routes readers to it." It does, and it did.
    //
    // ⇒ Same cap-as-total defect as the three already fixed in graph_packet, in the verb those
    // fixes send people to. A COUNT over the same predicate costs one query and turns a silent
    // sample into a stated one.
    const population = db.get(
      `SELECT count(*) AS n FROM nodes WHERE label = $label AND type IN (${SEARCH_TYPES.map(t => `'${t}'`).join(',')})`,
      { label: symbol },
    )?.n ?? hits.length;
    const capped = population > hits.length;
    // ⛔ THE POPULATION WAS ONLY SPOKEN WHEN IT WAS BAD NEWS, AND THAT IS HALF A DISCLOSURE.
    //
    // Found by the first controlled efficacy run (2026-08-19). The augmented arm asked for every
    // definition of `detect` with limit=50, got exactly 10 rows, and could not tell "the true
    // count is 10" from "a cap clipped the list at 10" — because this verb said nothing at all
    // when nothing was capped. Its words: the verb that answers "where is X defined" cannot
    // itself license "and that is all of them". So it re-derived the whole answer with grep and
    // spent 15 tool calls against the baseline arm's 9, for an identical correct answer.
    //
    // ★ The tool was not WRONG. It was UNWARRANTED — and an unwarranted correct answer costs the
    // reader exactly as much as a wrong one, because they must go and check it either way. That
    // is the efficacy case for disclosure, measured rather than argued.
    //
    // ⚠ The count is stated WITH ITS PREDICATE. This verb matches an exact label over declaration
    // types, so "10 of 10" is a claim about that predicate and nothing wider; a count whose basis
    // is unstated is simply the next version of this defect.
    const capNotice = capped
      ? `\n⚠ SHOWING ${hits.length} OF ${population} — this verb caps at limit=${limit}. `
        + `Re-run with limit=${population} for the full set.`
      : `\n${hits.length} of ${population} — every node whose exact label is "${symbol}", `
        + 'among declaration types. Nothing was truncated.';
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
      return prefixReadWarnings(renderCompact({ nodes: hits, edges: [] }) + capNotice, freshness.warnings);
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
    const expandNotice = population > 1
      ? `\n⚠ EXPANDED 1 OF ${population} definitions — expand mode details the FIRST match only. `
        + 'Use expand=false to list them, or narrow the symbol.'
      : '';
    return prefixReadWarnings(renderCompact({ nodes: [n], edges }) + expandNotice, freshness.warnings);
  } finally {
    db.close();
  }
}
