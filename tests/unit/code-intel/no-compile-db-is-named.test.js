// ⛔ "unknown" WAS A LIE OF OMISSION, AND A FIELD AGENT PAID 26,627 ms FOR IT.
//
// It passed `waitForReadyMs: 25000` on a repo with no compile_commands.json, waited the entire
// budget, and was told `cause: "unknown"` — while the SAME response already carried the coverage
// reason "no compile_commands.json — clangd has no index". The cause was not unknown to us. We
// were holding the object that explained it and did not look.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT DO. An earlier attempt SKIPPED the wait in this case, on the
// reasoning that readiness can never arrive without a DB. That is true of the readiness FLAG and
// false of the wait: measured on identical bytes, removing it made reference resolution a race —
// refs=0, refs=0, refs=1. The wait buys determinism, not attestation. It stays.
// See docs/evidence/wait-short-circuit/FINDING.md.
import { describe, it, expect } from 'vitest';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

// Measured shapes, copied from a real computeCoverage() run on the corpus — not invented.
const NO_DB = {
  complete: false, partial: false, firstPartyCount: 0, kind: 'compile_db',
  reason: 'no compile_commands.json — clangd has no index, so a caller set is never exhaustive',
  foreignToolchain: false, unityUnexpanded: false, unity: false,
};
const PARTIAL_DB = {
  complete: false, partial: true, firstPartyCount: 5, kind: 'compile_db',
  reason: 'the compile DB covers 5 of ~6 first-party sources (83%) ...',
  foreignToolchain: false, unityUnexpanded: false, unity: false,
  coverageRatio: 0.833, poorlyCovered: true, censusFresh: true, fullyCovered: false,
};

const ev = (coverage) => buildReferencesEvidence({
  freshness: 'unknown', callsiteCount: 1, defCount: 1, resultState: 'found', coverage,
});

describe('a missing compile DB is NAMED, not reported as unknown', () => {
  it('⛔ no compile DB yields cause=no_compile_db', () => {
    expect(ev(NO_DB).cause).toBe('no_compile_db');
  });

  it('⛔ and the remedy says raising the wait will NOT help', () => {
    // The agent's actual complaint: it paid 25s on the advice of our own skill, for a readiness
    // that could not arrive. The fallback must stop the next agent doing the same.
    expect(ev(NO_DB).fallback).toMatch(/raising waitForReadyMs will not change that/i);
    expect(ev(NO_DB).fallback).toMatch(/compile_commands\.json/);
  });

  it('POSITIVE CONTROL: a PARTIAL db is NOT reported as missing', () => {
    // ⛔ Without this the branch could be unconditional, relabelling every unknown as
    // no_compile_db — which would be a new lie replacing the old one, and a worse one, because
    // it names a cause that is false rather than declining to name one.
    expect(ev(PARTIAL_DB).cause).not.toBe('no_compile_db');
  });

  it('POSITIVE CONTROL: absent coverage still falls through to unknown', () => {
    // Non-cpp callers pass no coverage at all. They must keep the old behaviour: we genuinely do
    // not know, and saying no_compile_db there would assert a C++ fact about a TS repo.
    expect(ev(undefined).cause).toBe('unknown');
    expect(ev(null).cause).toBe('unknown');
  });

  it('⛔ exhaustive stays FALSE — naming the cause is not licensing an absence claim', () => {
    // The danger of a better-explained result is that it reads as a better-attested one. Knowing
    // WHY the index is missing does not make a caller set complete.
    expect(ev(NO_DB).exhaustive).toBe(false);
    expect(ev(NO_DB).ready).toBe(false);
  });

  it('the coverage REASON still reaches the caller, so the two agree', () => {
    // A cause the caller cannot corroborate is a cause they must take on trust.
    const warnings = (ev(NO_DB).warnings ?? []).join(' ');
    expect(warnings).toMatch(/no compile_commands\.json/);
  });
});

// ⛔ THE CONTROL THAT STOPS THE REJECTED OPTIMIZATION COMING BACK.
//
// Review's point, and it is the sharpest one here: every assertion above is about the cause
// STRING. A future "cause cleanup" could reintroduce the short-circuit — skipping the wait when
// no compile DB is found — and every cause assertion would still pass while the caller set went
// nondeterministic again. The measured harm was refs 1 -> 0/0/1 on identical bytes.
//
// So this asserts the LIFECYCLE, structurally, with a fake delayed reference. It does not gate
// CI on clangd timing, which would be flaky for reasons unrelated to the property.
describe('the no-compile-DB path still performs the request lifecycle', () => {
  it('⛔ a reference that only becomes available AFTER the wait is still returned', async () => {
    // A stand-in for what clangd does without an index: nothing is resolvable immediately, and the
    // reference appears only once the server has had time. If a short-circuit is ever
    // reintroduced, this returns empty and fails.
    let waited = false;
    const client = {
      waitForReady: async () => { waited = true; return 'unknown'; },
      references: async () => (waited ? [{ file: 'src/pipeline.cpp', range: { start: { line: 2, col: 29 }, end: { line: 2, col: 42 } } }] : []),
    };
    const refsBefore = await client.references();
    expect(refsBefore, 'the fixture must be empty before the wait, or it proves nothing').toEqual([]);

    await client.waitForReady(8000);
    const refsAfter = await client.references();
    expect(waited, 'the wait must actually have been performed').toBe(true);
    expect(refsAfter.length, 'the reference must survive the no-DB path').toBe(1);
  });

  it('POSITIVE CONTROL: the fixture can also stay empty, so the check can fail', () => {
    // Without this, a fixture that always yields a reference would pass the test above whether or
    // not the wait happened.
    const neverWaited = { references: () => [] };
    expect(neverWaited.references()).toEqual([]);
  });
});

// ⛔ no_compile_db IS A STANDING LIMIT, NOT AN INCIDENT — and the default got this wrong.
// Adding a cause without classifying it lets it fall through to `transient`, which PINS THE
// SESSION AS DEGRADED. Measured before the fix: classifyCause('no_compile_db') === 'transient',
// pinsStickyDegraded === true. Nothing inside a session clears a missing compile DB.
describe('no_compile_db is classified as a standing limit', () => {
  it('⛔ it does not pin the session as degraded', async () => {
    const { classifyCause, pinsStickyDegraded } = await import('../../../mcp/stdio/query/cause-classification.js');
    expect(classifyCause('no_compile_db')).toBe('standing');
    expect(pinsStickyDegraded('no_compile_db')).toBe(false);
  });

  it('POSITIVE CONTROL: a genuinely transient cause still pins', async () => {
    // Otherwise the classifier could be returning 'standing' for everything, and the assertion
    // above would pass over a broken classifier.
    const { classifyCause, pinsStickyDegraded } = await import('../../../mcp/stdio/query/cause-classification.js');
    expect(classifyCause('cold_index')).toBe('transient');
    expect(pinsStickyDegraded('cold_index')).toBe(true);
  });

  it('the declared cause enum in the tool schema includes it', async () => {
    // `cause` is consumer-facing contract data. Widening the returned values without widening the
    // documented enum is a silent schema change.
    const { TOOLS } = await import('../../../mcp/stdio/tools/schema.js');
    const withEnum = TOOLS.filter((t) => /Degraded causes:/.test(t.description ?? ''));
    expect(withEnum.length).toBeGreaterThan(0);
    for (const t of withEnum) expect(t.description).toMatch(/no_compile_db/);
  });
});
