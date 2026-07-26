// PROOF of the v0.3 P0 defect, found by the Sand Castle scored field test
// (2026-07-26): `code_intel_references` returned 3 of 8 real call sites while
// reporting exhaustive:true / confidence:"high" / warnings:[].
//
// These tests characterize the CURRENT behavior so the defect is demonstrable
// rather than asserted. The grant in buildReferencesEvidence fails OPEN — its own
// source comment says "coverage may be undefined ... -> treated as trustworthy" —
// so any path that cannot prove coverage still earns the exhaustive attestation.
//
// When the fail-closed fix lands, the tests marked EXPECTED-TO-FLIP must be
// inverted; that inversion IS the fix's acceptance criteria.
import { describe, expect, it } from 'vitest';
import { buildReferencesEvidence, buildDefinitionsEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

const freshWithCallsites = { freshness: 'fresh', callsiteCount: 3, defCount: 1, resultState: 'found' };

describe('P0 PROOF — exhaustive grant fails open on unproven coverage', () => {
  it('EXPECTED-TO-FLIP: coverage UNDEFINED still grants exhaustive:true', () => {
    // The exact sand_castle shape: clangd answered with SOME callsites, nothing
    // proved the compile DB covered every TU, and we attested completeness.
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: undefined });
    expect(e.exhaustive).toBe(true);      // ← the defect
    expect(e.degraded).toBe(false);
    expect(e.confidence).toBe('high');
    expect(e.warnings).toEqual([]);       // ← no hint anything was unverified
  });

  it('EXPECTED-TO-FLIP: coverage NULL still grants exhaustive:true', () => {
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: null });
    expect(e.exhaustive).toBe(true);      // ← the defect
  });

  it('EXPECTED-TO-FLIP: a coverage probe that could not decide still grants exhaustive:true', () => {
    // complete:undefined means "we could not determine coverage" — NOT "complete".
    // Only `complete === false` downgrades, so an undecided probe reads as proof.
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: { complete: undefined, reason: 'probe failed' } });
    expect(e.exhaustive).toBe(true);      // ← the defect
  });

  it('EXPECTED-TO-FLIP: definitions grant exhaustive with no coverage input at all', () => {
    // buildDefinitionsEvidence takes no coverage parameter whatsoever, so a
    // partial index yields "this is THE definition" unconditionally.
    const e = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1 });
    expect(e.exhaustive).toBe(true);      // ← the defect
  });

  // ---- The paths that ARE correct today (guard against regressing them) ----

  it('correctly downgrades when coverage is PROVEN incomplete', () => {
    const e = buildReferencesEvidence({
      ...freshWithCallsites,
      coverage: { complete: false, reason: 'foreign compile DB' },
    });
    expect(e.exhaustive).toBe(false);
    expect(e.degraded).toBe(true);
    expect(e.warnings.join(' ')).toMatch(/foreign compile DB/);
  });

  it('correctly refuses exhaustive on a stale or cold index', () => {
    expect(buildReferencesEvidence({ freshness: 'stale', callsiteCount: 3 }).exhaustive).toBe(false);
    expect(buildReferencesEvidence({ freshness: 'cold', callsiteCount: 0 }).exhaustive).toBe(false);
  });

  it('correctly refuses exhaustive for a definition-only result', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 0, defCount: 2 });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('definition_only');
  });
});
