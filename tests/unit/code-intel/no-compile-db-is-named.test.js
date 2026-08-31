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
