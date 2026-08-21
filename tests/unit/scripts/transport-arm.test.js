// ⚠ THIS TEST PROVES NOTHING ABOUT THE PRODUCT, ON PURPOSE.
//
// Normally a test that cannot name the bug it would catch is worse than no test — it manufactures
// confidence. This one is exempt because it is not a test OF anything: it is the readout of an
// INSTRUMENT.
//
// The per-arm workspace transport needs something to mutate in order to be observed working. Using
// a real scientific arm for that was refused, correctly: re-running a closed experiment is a sample
// nobody preregistered, and it contaminates the arm it borrows. So this pair — a worthless subject
// and this assertion — exists solely so a transport proof has a target with nothing at stake.
//
// ⇒ Its ONLY job is to go red when tests/fixtures/transport-arm/subject.js is mutated, so that
// self-review can demonstrate the mutation landed in a disposable worktree while the main checkout
// stayed byte-identical. Re-run it as often as you like; there is nothing here to use up.
import { describe, it, expect } from 'vitest';
import { TRANSPORT_CANARY } from '../../fixtures/transport-arm/subject.js';

describe('the transport arm canary', () => {
  it('★ reads intact — the readout of an instrument, not a guarantee', () => {
    expect(TRANSPORT_CANARY).toBe('intact');
  });
});
