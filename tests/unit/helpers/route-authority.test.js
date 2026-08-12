// THE HELPER THAT POLICES ROUTE CLAIMS MUST ITSELF BE POLICED.
//
// expectRouteAuthority exists because six of eight findings in the a137782 review were one
// shape — component conformance promoted to route authority. If the helper silently passed
// everything, every test using it would inherit a false guarantee and the failure would be
// invisible in exactly the way the helper was built to prevent.
//
// ★ Same discipline as the raw-byte scanner being proven on Buffer.from([0x08]) and the
// live matcher being proven against its own forbidden canary: an instrument that cannot
// fail is not an instrument. Each of the four dimensions is shown to fail INDEPENDENTLY,
// because a helper that only ever fails on one of them would let the other three through.
import { describe, it, expect } from 'vitest';
import { expectRouteAuthority } from '../../helpers/route-authority.js';

// ⚠ THE PREDICATES MUST READ THE RESPONSE, and the first version of this file used
// `() => true` constants — which the helper now rejects, correctly. A constant wearing a
// function's clothes cannot say anything about a response, so a test built from constants
// was proving the helper's truth table rather than its purpose.
const RESPONSE = Object.freeze({ status: 'ok', marker: 'real-response' });

const ok = {
  route: 'probe',
  response: RESPONSE,
  invoked: (r) => r?.marker === 'real-response',
  identity: (r) => r?.marker === 'real-response',
  succeeded: (r) => r?.status === 'ok',
};

// Runs the helper and reports which dimension complained, so a test cannot pass because
// the WRONG check fired.
function failureFrom(overrides) {
  try {
    expectRouteAuthority({ ...ok, ...overrides });
    return null;
  } catch (e) {
    return e.message;
  }
}

describe('expectRouteAuthority discriminates all four dimensions', () => {
  it('★★ passes only when every dimension holds', () => {
    expect(failureFrom({ cleanedUp: () => true }), 'a fully-authorised route must pass').toBeNull();
  });

  it('★★ NOT INVOKED fails, and says so', () => {
    // The MCP-misbinding class: something answered, but not via the route claimed.
    expect(failureFrom({ invoked: (r) => r?.marker === 'never' })).toMatch(/NOT INVOKED/);
  });

  it('★★ WRONG IDENTITY fails, and says so', () => {
    // dev's provider-identity mutant: a fake claiming `pyright` while in the cpp-clangd slot.
    expect(failureFrom({ identity: (r) => r?.marker === 'never' })).toMatch(/WRONG IDENTITY/);
  });

  it('★★ DID NOT COMPLETE fails — the one that cost me twice', () => {
    // The error-envelope case. My provider test asserted counters inside a status:"error"
    // response whose import had failed, and passed. Being end-to-end did not save it.
    expect(failureFrom({ succeeded: (r) => r?.status === 'never' })).toMatch(/DID NOT COMPLETE/);
  });

  it('★★ LEAKED fails — a green response is not cleanup evidence', () => {
    // The dashboard case: the call succeeded and the SQLite handle outlived it.
    expect(failureFrom({ cleanedUp: () => false })).toMatch(/LEAKED/);
  });

  it('★★ an UNBOUND predicate is rejected — dev\'s exact substitution', () => {
    // They rebound each predicate to consume a canned satisfying object instead of the
    // supplied response, independently, and the selected suite stayed 25/25 GREEN.
    // Deleting the helper reds; changing what it READS did not. So the helper was proving
    // the callbacks returned true, never that they returned true ABOUT THIS RESPONSE.
    const canned = { status: 'ok', marker: 'real-response' };
    expect(failureFrom({ invoked: () => canned.marker === 'real-response' }),
      'a predicate that reads a closed-over object, not the argument, must be rejected')
      .toMatch(/not reading the response/);
    expect(failureFrom({ identity: () => true })).toMatch(/not reading the response/);
    expect(failureFrom({ succeeded: () => true })).toMatch(/not reading the response/);
  });

  it('★ a predicate that THROWS on a foreign shape counts as reading it', () => {
    // Throwing is discrimination — it plainly consumed the argument. Treating it as a
    // failure would push authors toward defensive predicates that swallow everything,
    // which is the opposite of what this check is for.
    expect(failureFrom({ invoked: (r) => { if (!r.marker) throw new Error('no marker'); return true; } }),
      'a throwing predicate has demonstrably read its argument').toBeNull();
  });

  it('★ cleanup is OPTIONAL but never silently skipped when supplied', () => {
    // Omitting the probe must not be the same as passing it — otherwise a route with no
    // cleanup check looks identical to one that verified cleanup, which is the kind of
    // false equivalence this whole exercise has been about.
    expect(failureFrom({}), 'omitted cleanup is not asserted').toBeNull();
    expect(failureFrom({ cleanedUp: () => false }), 'supplied cleanup IS asserted').toMatch(/LEAKED/);
  });
});
