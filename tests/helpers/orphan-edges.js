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
 *
 * ⛔⛔ AND IT REFUSES OVER AN EMPTY GRAPH RATHER THAN REPORTING A VACUOUS ZERO.
 *
 * The first version of this file DOCUMENTED that every caller must assert the edge count is non-zero. I
 * then added a caller WITHOUT that control three lines later, in the same commit that wrote the sentence
 * (`corpus-attestation.test.js:191`) — and that is a CHUNK ROLLBACK test, where a near-empty graph is a
 * realistic state rather than a hypothetical one. ⇒ A CONTRACT IN A HEADER IS A NOTE, and mine degraded
 * inside an hour in the file that declared it. The rule is the same one applied to the coverage limb in
 * `scripts/lib/coverage-verdict.mjs`: A CHECK THAT CANNOT TELL WHICH OF TWO WORLDS IT IS IN MUST NOT REPORT
 * EITHER. An empty graph and a perfectly consistent one produce the IDENTICAL `{from:0,to:0}`.
 *
 * ⚠ THIS MAKES IT A GUARD RATHER THAN A REPORTER, AND EVERY CALLER INHERITS THAT — dashboard-manager's
 * limit, checked rather than argued. All four call sites were MEASURED before this landed:
 *     corpus-attestation.test.js:191                    1 edge
 *     doc-edges-have-a-deletion-trigger.test.js:82      1, 3 and 5 edges across its three calls
 *     deleting-code-leaves-no-orphan-edge.test.js       10, 15, 15, 16 edges
 * None runs over an empty graph, and all four are test ASSERTIONS rather than reporters, which is the
 * condition that makes throwing correct here. ⚠ But two sit at ONE edge, so the margin is a single edge —
 * which is the measurement that turns "vacuity is theoretical" into "vacuity is one fixture change away".
 * A future caller that legitimately reports over an empty graph needs a different function, not this one.
 */
export function orphanEdgeCounts(openDb, dbPath) {
  const db = openDb(dbPath);
  try {
    const edges = db.all('SELECT COUNT(*) c FROM edges')[0].c;
    if (edges === 0) {
      throw new Error(
        'orphanEdgeCounts: the graph holds ZERO edges, so "no orphan edges" would be vacuously true. '
        + 'An empty graph and a consistent one give the identical verdict, so this refuses rather than '
        + 'reporting one. Assert the population first, or the state under test was never built.',
      );
    }
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
 * ⭐⭐ PRINT THE POPULATION BESIDE THE VERDICT. Still worth asserting explicitly where the count is part of
 * the claim — "the delete actually removed edges" needs a number, not just an absence of orphans.
 *
 * ⚠ THIS USED TO SAY "every consumer must assert this is non-zero, or its zero means nothing". That was a
 * contract stated in prose, and I broke it three lines later in the same commit. `orphanEdgeCounts` now
 * REFUSES over an empty graph instead, so the requirement is enforced rather than remembered. The sentence
 * is kept here only to record why the enforcement exists.
 */
export function edgeCount(openDb, dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all('SELECT COUNT(*) c FROM edges')[0].c;
  } finally {
    db.close();
  }
}
