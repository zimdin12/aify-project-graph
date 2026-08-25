import { describe, it, expect } from 'vitest';
import {
  EVIDENCE_CONTRACT_VERSION,
  DEPRECATED_EVIDENCE_FIELDS,
  canInterpretEvidence,
} from '../../../mcp/stdio/query/evidence-contract.js';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { buildHierarchyEvidence } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';

// graph-senior-dev, ruling 2026-08-25: deleting `degraded` and `operationallyDegraded` is
// APPROVED AS A TARGET, immediate silent deletion REFUSED, because:
//
//     "After deletion, `undefined` is falsy and `if (!evidence.degraded)` becomes true —
//      the dangerous direction."
//
// A consumer asking "is this clean?" would start getting YES for every answer. His step 8 requires
// "an old-reader hostile test proving unknown/new schema refuses rather than interpreting a
// missing boolean as healthy". That test is written NOW, in the compatible window, because a
// mechanism added at the same time as the removal has never been exercised against the old world.

describe('evidence contract version — the mechanism that lets a reader refuse', () => {
  it('every evidence object carries the version, on both verbs', () => {
    // If the stamp can go missing on any branch, a reader has nothing to compare and falls back
    // to guessing — which is the state this replaces.
    const refs = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1, resultState: 'found', coverage: { complete: true } });
    const hier = buildHierarchyEvidence({ mode: 'indexed', indexReady: true, nodeCount: 4, kind: 'callers', coverage: { complete: true } });
    expect(refs.contractVersion).toBe(EVIDENCE_CONTRACT_VERSION);
    expect(hier.contractVersion).toBe(EVIDENCE_CONTRACT_VERSION);
  });

  it('the stamp survives a DEGRADED branch too, not only the happy path', () => {
    // The inner builders have many return sites. A field present only on the path someone tested
    // is the defect this stamp exists to prevent.
    const cold = buildReferencesEvidence({ freshness: 'stale', callsiteCount: 0, defCount: 0, resultState: 'not_found_after_retry', coverage: { complete: false } });
    expect(cold.contractVersion).toBe(EVIDENCE_CONTRACT_VERSION);
  });
});

describe('canInterpretEvidence — FAILS CLOSED, which is the entire point', () => {
  it('accepts a version it understands', () => {
    expect(canInterpretEvidence(1, 1)).toBe(true);
  });

  it('accepts an OLDER payload — an old payload reaching a new reader is not the hazard', () => {
    expect(canInterpretEvidence(1, 2)).toBe(true);
  });

  it('⭐ REFUSES a NEWER payload — this is the actual hazard', () => {
    // A contract-2 payload (no `degraded`) reaching a contract-1 reader is where `!undefined`
    // silently means "healthy". Refusing is the only answer that cannot be mistaken for fine.
    expect(canInterpretEvidence(2, 1)).toBe(false);
  });

  it('⛔ REFUSES an ABSENT version rather than assuming 1', () => {
    // Assuming 1 would be the fail-open reading: a stripped or hand-built payload would be
    // interpreted with a contract it never promised.
    expect(canInterpretEvidence(undefined, 1)).toBe(false);
    expect(canInterpretEvidence(null, 1)).toBe(false);
  });

  it('⛔ REFUSES a malformed version — a string that looks like a number is not one', () => {
    expect(canInterpretEvidence('1', 1)).toBe(false);
    expect(canInterpretEvidence(1.5, 1)).toBe(false);
    expect(canInterpretEvidence(Number.NaN, 1)).toBe(false);
  });

  // ⛔ A CONTRACT VERSION IS A POSITIVE IDENTITY. 0 and negatives name no contract that has ever
  // existed, so they are malformed carriers, not "older schemas" — and `seen <= understood` waved
  // every one of them through. graph-senior-dev found this while checking the tripwire:
  //
  //     "a forged/corrupt contractVersion:-1 would be interpreted under contract 1 or 2 despite
  //      naming no real contract."
  //
  // ⛔⛔ AND THE TEST DIRECTLY ABOVE USED TO CERTIFY IT. Its assertion read `toEqual([1, 0, -1])`
  // under a comment saying "only real integers at or below the understood version". The comment
  // stated the correct rule; the assertion pinned the broken one. A comment adjacent to a defect
  // has never once caught it in this repo — the assertion is the instrument, and mine was aimed
  // at the wrong target.
  //
  // This matters specifically for step 8: after the booleans are deleted, a payload that gets
  // interpreted under the wrong contract is exactly how an absent `degraded` reads as healthy.
  it('⛔ REFUSES version 0, negatives, and MIN_SAFE_INTEGER — they name no contract', () => {
    for (const seen of [0, -1, -2, Number.MIN_SAFE_INTEGER]) {
      expect(canInterpretEvidence(seen, 1), `seen=${seen}`).toBe(false);
      expect(canInterpretEvidence(seen, 2), `seen=${seen} under contract 2`).toBe(false);
    }
  });

  it('⛔ REFUSES a reader claiming a non-positive understood version', () => {
    for (const understood of [0, -1]) {
      expect(canInterpretEvidence(1, understood), `understood=${understood}`).toBe(false);
    }
  });

  it('⭐ the guard can say NO more often than YES — it is not a rubber stamp', () => {
    // A predicate that accepts everything it is shown is decoration. Counting both outcomes is
    // the cheapest proof it discriminates at all.
    const cases = [1, 2, 0, undefined, null, '1', 1.5, Number.NaN, -1];
    const accepted = cases.filter((v) => canInterpretEvidence(v, 1));
    expect(accepted).toEqual([1]);   // the ONLY positive integer at or below the understood version
    expect(accepted.length).toBeLessThan(cases.length - accepted.length);
  });

  it('⭐ POSITIVE CONTROL — the valid grid still ACCEPTS, so the repair is not just refusing more', () => {
    // A guard hardened until it refuses everything passes every hostile test and is useless. The
    // accept side has to be exercised in the same pass as the refuse side.
    expect(canInterpretEvidence(1, 1)).toBe(true);
    expect(canInterpretEvidence(1, 2)).toBe(true);
    expect(canInterpretEvidence(2, 2)).toBe(true);
    expect(canInterpretEvidence(2, 1)).toBe(false);  // newer payload, older reader — the real hazard
  });
});

describe('deprecations are declared, so the removal commit has a list it cannot forget', () => {
  it('names both booleans and says what to read instead', () => {
    expect(Object.keys(DEPRECATED_EVIDENCE_FIELDS).sort()).toEqual(['degraded', 'operationallyDegraded']);
    for (const reason of Object.values(DEPRECATED_EVIDENCE_FIELDS)) {
      expect(reason).toMatch(/`cause`/);
      expect(reason).toMatch(/contract 2/);
    }
  });

  it('the deprecated fields are STILL PRESENT — this is the compatibility window, not the removal', () => {
    // Asserting presence is deliberate. If someone deletes them early, this fails and points at
    // the migration steps that have not run, rather than the change silently landing.
    const e = buildReferencesEvidence({ freshness: 'stale', callsiteCount: 0, defCount: 0, resultState: 'not_found_after_retry', coverage: { complete: false } });
    expect(e).toHaveProperty('degraded');
  });
});
