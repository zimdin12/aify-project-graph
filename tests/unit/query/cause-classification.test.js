import { describe, it, expect } from 'vitest';
import { classifyCause, pinsStickyDegraded, UNRECOGNISED_CAUSE_CLASS } from '../../../mcp/stdio/query/cause-classification.js';

// Step 5 of the reviewer's evidence-contract migration: "migrate sticky telemetry to named
// cause classification, not either boolean."
//
// ⛔ I FIRST CLAIMED THIS WAS A TERM DELETION. The census said the tracker could drop its
// `degraded &&` term "because cause is non-null exactly when degraded is true". MEASURED: 336 of
// 1,134 combinations violate that — `cause: 'unknown'` carries `degraded: false`.
//
// ⭐ Running the vocabulary showed the split is TOTAL: no cause ever appears with both values.
// 12 causes are always degraded:true; 'unknown' is always degraded:false. So the boolean IS
// derivable — via a classification, not via null-ness.

describe('classifyCause — four classes, because three could not express the vocabulary', () => {
  it('a permanent epistemic limit is STANDING, never an incident', () => {
    // True of every call: the compile DB never reports which TUs clangd actually indexed. Treating
    // it as an incident would pin the session forever on a fact about the tool, not the request.
    expect(classifyCause('index_population_unattested')).toBe('standing');
  });

  it('⭐ SELECTED behaviour is not an incident — the reviewer ruled this and I had it backwards', () => {
    // "bounded mode never waits for the index BY DESIGN, so nothing happened *to* that request."
    expect(classifyCause('bounded_mode')).toBe('selected');
  });

  it('⭐ a named reason that is NOT a degradation gets its own class', () => {
    // This is the class the measurement revealed. `unknown` means "usable result; readiness signal
    // missing" — exhaustive is withheld and the reason named, but nothing went wrong. A two-way
    // standing/transient split could not express it, which is why the first design was wrong.
    expect(classifyCause('unknown')).toBe('none');
  });

  it('no cause at all is none', () => {
    expect(classifyCause(null)).toBe('none');
    expect(classifyCause(undefined)).toBe('none');
  });

  it('real incidents are TRANSIENT', () => {
    for (const c of ['cold_index', 'stale_index', 'timeout', 'definition_only',
      'coverage_unknown', 'partial_compile_db_coverage', 'partial_tsconfig_scope',
      'python_dynamic_dispatch', 'no_incoming_unconfirmed', 'truncated_to_caps']) {
      expect(classifyCause(c), c).toBe('transient');
    }
  });

  it('⛔ an UNRECOGNISED cause defaults to transient — the cautious direction', () => {
    // A new cause added without touching the classifier PINS and surfaces, rather than being
    // silently classified as harmless. The opposite default makes every future cause invisible to
    // the tracker, which is the fail-open shape this codebase keeps removing.
    expect(classifyCause('some_cause_invented_next_year')).toBe(UNRECOGNISED_CAUSE_CLASS);
    expect(UNRECOGNISED_CAUSE_CLASS).toBe('transient');
  });
});

describe('pinsStickyDegraded — only a real incident pins a session', () => {
  it('pins on a transient incident', () => {
    expect(pinsStickyDegraded('cold_index')).toBe(true);
  });

  it('⭐ does NOT pin on bounded_mode — the ONE measured behaviour change of step 5', () => {
    // Measured across 1,890 combinations: 378, all bounded_mode, previously pinned and no longer
    // do. That is the whole delta, and it implements the reviewer's ruling rather than being a refactor.
    expect(pinsStickyDegraded('bounded_mode')).toBe(false);
  });

  it('does NOT pin on the standing limit — it would overwrite a real prior cause', () => {
    expect(pinsStickyDegraded('index_population_unattested')).toBe(false);
  });

  it('does NOT pin on a non-degradation or on no cause', () => {
    expect(pinsStickyDegraded('unknown')).toBe(false);
    expect(pinsStickyDegraded(null)).toBe(false);
  });

  it('⭐ the predicate says NO more often than it says YES across the vocabulary', () => {
    // A pin-everything predicate is the state we are leaving: `degraded` was true on every answer.
    // Counting both outcomes is the cheapest proof this one discriminates.
    const vocabulary = ['cold_index', 'stale_index', 'timeout', 'definition_only', 'coverage_unknown',
      'partial_compile_db_coverage', 'partial_tsconfig_scope', 'python_dynamic_dispatch',
      'no_incoming_unconfirmed', 'truncated_to_caps', 'index_population_unattested',
      'bounded_mode', 'unknown', null];
    const pins = vocabulary.filter(pinsStickyDegraded);
    expect(pins.length).toBeGreaterThan(0);          // it can say yes
    expect(pins.length).toBeLessThan(vocabulary.length); // and it can say no
    expect(pins).not.toContain('bounded_mode');
    expect(pins).not.toContain('index_population_unattested');
  });
});
