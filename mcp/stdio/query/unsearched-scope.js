// ⛔ AN ABSENCE CLAIM MUST NAME THE POPULATION IT SEARCHED.
//
// `graph_callers` and `graph_callees` both walk the STRICT call graph — CALLS / INVOKES /
// PASSES_THROUGH — a deliberate, documented choice. Both then said "NO CALLERS" / "NO CALLEES",
// and the trust caveat beneath speaks only about EVIDENCE DEPTH ("heuristic, NOT exhaustive,
// verify with rg"). Nothing said a whole relation had never been consulted.
//
// ⛔⛔ "INCOMPLETE" AND "UNASKED" ARE DIFFERENT FAILURES AND ONE CAVEAT CANNOT SERVE BOTH. Depth
// says *keep looking*; scope says *you asked a narrower question than you think*. The second is
// worse, because the graph ALREADY HOLDS the answer the verb declined to look for.
//
// Measured through the verbs on four pinned third-party repositories:
//
//     graph_callers   381 labels carry a REFERENCES edge and no execution edge
//                     (click 272, fast-route 68, p-queue 26, fmt 15)
//     graph_callees   on click, 71 of 88 "NO CALLEES" answers (81%) had unsearched outgoing edges
//
// And because `graph_preflight` counts the WIDER family, two verbs contradicted each other on the
// same symbol in the same graph:
//
//     graph_callers("Class2")    ->  NO CALLERS for "Class2"
//     graph_preflight("Class2")  ->  CALLERS 1 total
//
// ⇒ Same shape as the LINKS_TO precedent recorded in taxonomy.js: "nothing in the receipt could
// tell 'the list was cut short' from 'a source was never consulted'."
//
// ⚠ ONE OWNER, NOT TWO COPIES. graph_callees is the exact mirror of graph_callers, and fixing one
// and pasting into the other is how the two drift. The direction is a parameter.

/**
 * A one-line note naming what an absence claim did NOT search, when the graph holds such edges.
 *
 * @param {object} args
 * @param {object} args.db            open database handle — see the async warning below
 * @param {string} args.column        'to_id' for incoming (callers), 'from_id' for outgoing (callees)
 * @param {string} args.placeholders  the caller's existing SQL placeholder list for its target ids
 * @param {object} args.params        the matching bound parameters
 * @param {string} args.symbol        the symbol being reported on
 * @param {string[]} args.searched    the relation family the verb DID walk
 * @param {string[]} args.unsearched  the relations it did not — DERIVED by the caller, never listed
 * @param {string} args.remedy        a verb the reader can actually call
 * @returns {string} the note, or '' when there is genuinely nothing to report
 *
 * ⛔ CALL THIS BEFORE THE FIRST `await` IN AN ASYNC PATH. Verbs `return` their async helper's
 * promise, so an enclosing `finally { db.close() }` runs while that promise is still pending. Placed
 * after an await, every call throws "The database connection is not open", the catch returns '', and
 * the feature is INERT with output byte-identical to not existing. That happened, and only deleting
 * the catch revealed it.
 */
export function unsearchedRelationNote({
  db, column, placeholders, params, symbol, searched, unsearched, remedy,
}) {
  if (!unsearched || unsearched.length === 0) return '';
  try {
    const rows = db.all(
      `SELECT relation, count(*) AS c FROM edges
       WHERE ${column} IN (${placeholders})
         AND relation IN (${unsearched.map((r) => `'${r}'`).join(',')})
       GROUP BY relation ORDER BY c DESC`,
      params
    );
    const total = rows.reduce((a, r) => a + r.c, 0);
    if (total === 0) return '';
    const detail = rows.map((r) => `${r.c} ${r.relation}`).join(', ');
    // ⚠ THE CLOSING CLAUSE IS DIRECTION-SPECIFIC. Incoming absence risks a wrongly-safe DELETE
    // ("nothing uses it"); outgoing absence risks a wrongly-isolated symbol ("it uses nothing").
    // A single phrasing shared by both would be wrong for one of them.
    const incoming = column === 'to_id';
    const direction = incoming ? 'pointing at' : 'out of';
    const misreading = incoming ? '"nothing uses it"' : '"it uses nothing"';
    return `${'\n'}SCOPE: this verb searched the strict call graph (${searched.join('/')}) and did NOT `
      + `search ${unsearched.join('/')} — of which this graph holds ${detail} ${direction} "${symbol}". `
      + `So this absence does NOT mean ${misreading} — ${remedy}`;
  } catch {
    // ⚠ SILENT ONLY ON A FAILED LOOKUP. A genuine zero returns '' at the `total === 0` branch above,
    // for the honest reason that there is nothing to report. The two paths are kept separate so a
    // broken query cannot masquerade as a clean absence — and the tests assert the note SPEAKS,
    // because a fail-silent path cannot be verified by observing it.
    return '';
  }
}
