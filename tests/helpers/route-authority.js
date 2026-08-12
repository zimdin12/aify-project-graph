// COMPONENT CONFORMANCE IS NOT ROUTE AUTHORITY.
//
// graph-senior-dev-hermes's refinement of the pattern behind six of eight findings in the
// a137782 review, and it is sharper than the version I wrote:
//
//   The recurring defect is component conformance being promoted to ROUTE AUTHORITY
//   without separately proving invocation, carried identity, successful terminal state,
//   and cleanup at the owner boundary. "End-to-end" is necessary but NOT sufficient —
//   an end-to-end call can still go green on an error envelope or a wrong handler.
//
// ⇒ That last clause is the one that cost me twice in a single review. My provider-boundary
// test made a REAL call through the REAL verb and asserted on a `status: "error"` response
// whose import had failed on a NOT NULL constraint; the counters appeared in the failure
// text and the case passed. Being end-to-end did not save it. And the MCP registry
// misbinding survived 19/19 because every test imported its verb directly — the route was
// never invoked by NAME at all.
//
// The four are independent, and each has its own way of going quietly green:
//
//   1. INVOCATION      — the intended route actually ran. Absent: a fallback, a cache, a
//                        short-circuit, or a different handler answered.
//   2. IDENTITY        — what answered is what was named. Absent: a fake occupying the
//                        slot, or a table row bound to the wrong function.
//   3. TERMINAL STATE  — it finished SUCCESSFULLY. Absent: an error envelope that still
//                        echoes the fields being asserted.
//   4. CLEANUP         — the owner released what it took. Absent: a handle, a child
//                        process, or a registry entry outliving the call, invisible to
//                        every assertion about the response.
//
// A response assertion speaks to none of them. This helper makes each one explicit and
// forces the failure message to name WHICH of the four is missing, because "the test
// failed" and "the route was never taken" are different diagnoses.
import { expect } from 'vitest';

/**
 * Assert a route has AUTHORITY before its output is treated as evidence.
 *
 * @param {object} claim
 * @param {string} claim.route            what is being claimed, for failure messages
 * @param {object} claim.response         what the route returned
 * @param {(r:any)=>boolean} claim.invoked        proof the intended path ran
 * @param {(r:any)=>boolean} claim.identity       proof the responder is the one named
 * @param {(r:any)=>boolean} claim.succeeded      proof of a SUCCESSFUL terminal state
 * @param {() => boolean} [claim.cleanedUp]       proof the owner released its resources
 */
export function expectRouteAuthority({ route, response, invoked, identity, succeeded, cleanedUp }) {
  const shown = () => {
    const t = typeof response === 'string' ? response : JSON.stringify(response);
    return t.length > 240 ? `${t.slice(0, 240)}…` : t;
  };

  expect(invoked(response), `${route}: NOT INVOKED — the intended route did not run, so nothing `
    + `it returned is evidence about that route. Response: ${shown()}`).toBe(true);

  expect(identity(response), `${route}: WRONG IDENTITY — something answered, but not the thing `
    + `named. A fake in the slot or a misbound handler produces exactly this. Response: ${shown()}`).toBe(true);

  // ★ The one that caught me: an error envelope echoing the asserted fields.
  expect(succeeded(response), `${route}: DID NOT COMPLETE — the route ran and FAILED. Values `
    + `appearing in an error envelope do not prove the journey finished. Response: ${shown()}`).toBe(true);

  if (cleanedUp) {
    expect(cleanedUp(), `${route}: LEAKED — the call succeeded but the owner did not release `
      + 'what it took. A green response is not cleanup evidence.').toBe(true);
  }
}
