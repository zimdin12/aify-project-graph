// ⛔ ONE OWNER for "does any edge reference a node that is not there".
//
// The invariant the SCHEMA declares and the DATABASE does not enforce: `schema.js:33-34` writes
// `FOREIGN KEY (from_id) REFERENCES nodes(id)` and `FOREIGN KEY (to_id) REFERENCES nodes(id)`, while
// `db.js:46` sets `foreign_keys = OFF` for bulk ingest. So the constraint is DECLARED AND INERT, and
// nothing at the declaration site says so. It holds today only because the manual paths —
// `deleteEdgesByFile`, `deleteNodesForFile`, `cleanupOrphanExternalNodes` — agree with each other.
//
// ⚠ MEASURED 2026-09-29, three ways, before this file existed: 0 orphans in the real 7,509-node /
// 35,826-edge graph, 0 after a document deletion (already tested), and 0 after a code-file deletion with
// three importers left dangling. So this is a BOUND on an invariant that currently holds, not a repair —
// stated at that size rather than dressed up.
//
// ⇒ WHY IT IS WORTH A BOUND ANYWAY: an orphan edge makes `graph_callers` count a caller that does not
// exist. That is the same confidently-wrong-in-the-direction-of-MORE as the phantom nodes fixed earlier
// today, and it is the shape a reader has no way to doubt.
//
// ⛔ WHY THIS LIVES HERE RATHER THAN BEING WRITTEN TWICE. `doc-edges-have-a-deletion-trigger.test.js`
// already had this query, already general (no relation filter), and only its INVOCATION was narrow — a
// repair that was general in the function and narrow at the call site, which reads as if the general case
// is covered because the generality is right there. A second inline copy would be a COPY, not a control:
// dashboard-manager's test is "would you still want the second one if the first were correct?", and here
// the answer is no. Compare `presentWithExactCase` in the rename audit, which is deliberately duplicated
// BECAUSE the answer there is yes.

/**
 * Count edges whose endpoints do not exist, at BOTH ends.
 *
 * ⛔ BOTH DIRECTIONS, ALWAYS. An edge can dangle at either end, and a check on one end reports a clean
 * graph while the other end hangs. This was already the rule in the doc test; it is carried here verbatim
 * rather than reasoned about again.
 */
export function orphanEdgeCounts(openDb, dbPath) {
  const db = openDb(dbPath);
  try {
    return {
      from: db.all(`SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.from_id
                     WHERE n.id IS NULL`)[0].c,
      to: db.all(`SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.to_id
                   WHERE n.id IS NULL`)[0].c,
    };
  } finally {
    db.close();
  }
}

/**
 * The total edge count, for use as a POPULATION CONTROL beside an orphan verdict.
 *
 * ⭐⭐ PRINT THE POPULATION BESIDE THE VERDICT. "No orphan edges" is trivially true of a graph with no
 * edges, and an empty graph and a perfectly consistent one give the IDENTICAL verdict. Every consumer of
 * `orphanEdgeCounts` must assert this is non-zero, or its zero means nothing.
 */
export function edgeCount(openDb, dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all('SELECT COUNT(*) c FROM edges')[0].c;
  } finally {
    db.close();
  }
}
