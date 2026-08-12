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

const ok = {
  route: 'probe',
  response: { status: 'ok' },
  invoked: () => true,
  identity: () => true,
  succeeded: () => true,
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
    expect(failureFrom({ invoked: () => false })).toMatch(/NOT INVOKED/);
  });

  it('★★ WRONG IDENTITY fails, and says so', () => {
    // dev's provider-identity mutant: a fake claiming `pyright` while in the cpp-clangd slot.
    expect(failureFrom({ identity: () => false })).toMatch(/WRONG IDENTITY/);
  });

  it('★★ DID NOT COMPLETE fails — the one that cost me twice', () => {
    // The error-envelope case. My provider test asserted counters inside a status:"error"
    // response whose import had failed, and passed. Being end-to-end did not save it.
    expect(failureFrom({ succeeded: () => false })).toMatch(/DID NOT COMPLETE/);
  });

  it('★★ LEAKED fails — a green response is not cleanup evidence', () => {
    // The dashboard case: the call succeeded and the SQLite handle outlived it.
    expect(failureFrom({ cleanedUp: () => false })).toMatch(/LEAKED/);
  });

  it('★ cleanup is OPTIONAL but never silently skipped when supplied', () => {
    // Omitting the probe must not be the same as passing it — otherwise a route with no
    // cleanup check looks identical to one that verified cleanup, which is the kind of
    // false equivalence this whole exercise has been about.
    expect(failureFrom({}), 'omitted cleanup is not asserted').toBeNull();
    expect(failureFrom({ cleanedUp: () => false }), 'supplied cleanup IS asserted').toMatch(/LEAKED/);
  });
});
