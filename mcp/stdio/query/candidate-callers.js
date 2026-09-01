// CALLER SETS FOR ONE NODE — the single owner of "who calls this specific definition".
//
// ⛔ WHY THIS EXISTS: the same query was written twice, in `preflight.js` (a COUNT plus a
// provenance-ranked top-N) and inside `callers.js`. Two copies of one question drift, and the
// fix that lands in one is absent from the other. This is the owner; both call it.
//
// ★ WHAT IT IS FOR, beyond deduplication: M1's stop condition is that an ambiguous refusal must
// NOT be a dead end — it must return the qualified candidates WITH their caller sets. Answering
// that needs a per-candidate caller summary that is CHEAP enough to run for every candidate shown,
// which is why this returns a bounded summary rather than the caller rows a verb would render.
import { CALL_FAMILY } from '../storage/taxonomy.js';
import { provenanceRankSql } from './lsp-evidence.js';

const asSqlList = (family) => family.map((relation) => `'${relation}'`).join(',');

/**
 * A bounded caller summary for ONE node.
 *
 * ⛔ `total` IS A COUNT OVER THE WHOLE RELATION, NOT THE LENGTH OF `top`. Reporting `top.length`
 * as the total is the cap-as-population defect this repo has now fixed in three separate places
 * (`buildAmbiguousMatchMessage`, `graph_packet`, `resolveSymbolWithTotal`). The two numbers are
 * returned separately so a caller cannot accidentally print one as the other.
 *
 * @returns {{ total:number, top:Array<object>, truncated:boolean }}
 */
export function summarizeCallersFor(db, nodeId, { limit = 5 } = {}) {
  const relations = asSqlList(CALL_FAMILY);
  const total = db.get(
    `SELECT count(*) AS c FROM edges WHERE to_id = $id AND relation IN (${relations})`,
    { id: nodeId },
  )?.c ?? 0;

  // Ordered by provenance first so an LSP-verified caller outranks a heuristic one: when only a
  // few names are shown, they should be the ones with the strongest evidence behind them.
  const top = total === 0 ? [] : db.all(
    `SELECT n.label, n.file_path, n.start_line, e.source_line, e.relation, e.confidence, e.provenance
     FROM edges e JOIN nodes n ON n.id = e.from_id
     WHERE e.to_id = $id AND e.relation IN (${relations})
     ORDER BY ${provenanceRankSql('e.provenance')} DESC, e.confidence DESC LIMIT ${Number(limit)}`,
    { id: nodeId },
  );

  return { total, top, truncated: total > top.length };
}

/**
 * One line describing a candidate's caller set, for the ambiguous-refusal listing.
 *
 * ⛔ AN EMPTY SET IS AN ABSENCE CLAIM AND MUST NOT RENDER AS A BARE "no callers".
 * `graph_callers` routes every empty result through `absence()`, which attaches the
 * not-exhaustive trust caveat, precisely because an absence claim is the most dangerous output
 * this verb produces. A per-candidate "0 callers" printed without that caveat would be the same
 * defect `d17f2a2` fixed from the other side: a refusal a consumer can read as data. So zero is
 * phrased as a scoped statement — "in the indexed graph" — and the caller attaches ONE shared
 * caveat to the whole listing.
 */
export function renderCallerSummary({ total, top }, { nameLimit = 3 } = {}) {
  if (total === 0) return '0 callers in the indexed graph';
  const names = top.slice(0, nameLimit).map((row) => row.label).filter(Boolean);
  const shown = names.length > 0 ? `: ${names.join(', ')}` : '';
  // `total` is the population and `names` is what fits, so the remainder is stated rather than
  // left for a reader to infer from a list that stops.
  const more = total > names.length ? ` (+${total - names.length} more)` : '';
  return `${total} caller${total === 1 ? '' : 's'}${shown}${more}`;
}
