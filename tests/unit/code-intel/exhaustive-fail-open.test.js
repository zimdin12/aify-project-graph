// PROOF of the v0.3 P0 defect, found by the Sand Castle scored field test
// (2026-07-26): `code_intel_references` returned 3 of 8 real call sites while
// reporting exhaustive:true / confidence:"high" / warnings:[].
//
// FIXED 2026-07-26 (P0-2): the grant now fails CLOSED. `exhaustive:true` requires
// POSITIVE proof of coverage (`coverage.complete === true`); anything that cannot
// prove coverage — undefined, null, an undecided probe — returns
// `exhaustive:false, cause:'coverage_unknown'`.
//
// The four tests below were the defect's acceptance criteria and are now
// inverted. They stay as regression guards: the safety-critical default must
// never drift back to trusting silence.
import { describe, expect, it } from 'vitest';
import { buildReferencesEvidence, buildDefinitionsEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

const freshWithCallsites = { freshness: 'fresh', callsiteCount: 3, defCount: 1, resultState: 'found' };
const proven = { complete: true };

describe('exhaustive grant fails CLOSED on unproven coverage', () => {
  it('coverage UNDEFINED must NOT grant exhaustive', () => {
    // The sand_castle shape: clangd answered with SOME callsites and nothing
    // proved the compile DB covered the queried code.
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: undefined });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
    expect(e.warnings.join(' ')).toMatch(/could not be (verified|confirmed)|not a completeness oracle/i);
  });

  it('coverage NULL must NOT grant exhaustive', () => {
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: null });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
  });

  it('a coverage probe that could not decide must NOT grant exhaustive', () => {
    // complete:undefined means "we could not determine coverage" — NOT "complete".
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: { complete: undefined, reason: 'probe failed' } });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
  });

  it('definitions must NOT grant exhaustive without proven coverage', () => {
    const e = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1 });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
  });

  // ⛔ SUPERSEDED 2026-08-19 BY AN EXECUTED COUNTEREXAMPLE, and rewritten rather than deleted so
  // the reason survives. This asserted that PROVEN compile-DB coverage grants exhaustive:true.
  // the reviewer built two sources, BOTH in compile_commands (ratio 1, census fresh), one
  // carrying a command with a missing include path so clangd could not compile it. Its caller
  // was absent from the result and the verb still returned exhaustive:true / cause:null /
  // confidence:'high'. Upstream: clangd's BackgroundQueue counts a task Completed regardless of
  // outcome, so "indexing idle" never meant "indexing succeeded".
  // ⇒ Membership in the DB is SELECTION, not SUCCESS. The grant is withheld until an attested
  // index generation exists; what survives is per-location precision, which is a different
  // dimension and is still reported.
  it('PROVEN coverage no longer grants exhaustive — membership is not index success', () => {
    const e = buildReferencesEvidence({ ...freshWithCallsites, coverage: proven });
    expect(e.exhaustive, 'the DB says which files MAY be indexed, not which were').toBe(false);
    expect(e.cause).toBe('index_population_unattested');
    // The fix must not over-correct into uselessness: what is still known is still reported.
    expect(e.precision, 'each returned location is compiler-resolved').toBe('compiler_resolved');
    expect(e.completeness, 'the SET is a floor — a separate dimension').toBe('floor');

    // ⚠ I LEFT DEFINITIONS GRANTING HERE AND WAS WRONG. Declining to extend a finding to an
    // untested surface was the right instinct; the honest move was to ASK for the fixture,
    // which is what happened — and it falsified definitions too, by a different mechanism.
    // Absence of a counterexample is not evidence of soundness.
    const d = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1, coverage: proven });
    expect(d.exhaustive, 'falsified for definitions too — see live-verbs.test.js').toBe(false);
  });

  // ---- The paths that ARE correct today (guard against regressing them) ----

  it('correctly downgrades when coverage is PROVEN incomplete', () => {
    const e = buildReferencesEvidence({
      ...freshWithCallsites,
      coverage: { complete: false, reason: 'foreign compile DB' },
    });
    expect(e.exhaustive).toBe(false);
    expect(e.degraded).toBe(true);
    // The reason is asserted where it CANONICALLY lives — `fallback`. This
    // previously read it out of `warnings`, which held a byte-for-byte copy;
    // duplicating a ~300-word paragraph on every degraded call was named the most
    // annoying thing about the tool by a field user (the field test, 2026-07-30).
    // Asserting the canonical field means the test cannot re-pin the duplication.
    expect(e.fallback).toMatch(/foreign compile DB/);
    expect(e.warnings).not.toContain(e.fallback);
  });

  it('correctly refuses exhaustive on a stale or cold index', () => {
    expect(buildReferencesEvidence({ freshness: 'stale', callsiteCount: 3, coverage: proven }).exhaustive).toBe(false);
    expect(buildReferencesEvidence({ freshness: 'cold', callsiteCount: 0, coverage: proven }).exhaustive).toBe(false);
  });

  it('correctly refuses exhaustive for a definition-only result', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 0, defCount: 2, coverage: proven });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('definition_only');
  });
});
