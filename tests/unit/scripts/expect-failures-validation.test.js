// ⛔ `expectFailures` BINDS THE TOTAL NUMBER OF FAILING CASES, so a malformed one silently changes
// what the arm is measuring.
//
// It was used RAW — `const wanted = m.expectFailures ?? 1` compared with `!==` — and listed under
// self-review's own OPEN block as "expectFailures type validation". A string "1" never equals a
// number, so any arm carrying it would be INVALID for a reason invisible in the spec.
//
// ⛔⛔ AND ZERO IS THE DANGEROUS ONE. `expectFailures: 0` asks the apparatus to credit an arm whose
// hostile mutation broke NOTHING — which is the definition of a SURVIVED candidate hole. It would
// convert the tool's strongest negative signal into a pass.
import { describe, it, expect } from 'vitest';
import { validateV3Spec, expectFailuresProblems } from '../../../scripts/lib/spec-schema.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const arm = (over = {}) => ({
  name: 'X1 a witness', file: 'f.js', from: 'a', to: 'b', tests: ['t.test.js'],
  case: 'the case', expect: 'the predicate', ...over,
});

describe('expectFailures must be an integer of at least one', () => {
  it('★★★ POSITIVE CONTROL: a valid arm loads, with or without the field', () => {
    // Every assertion below expects a refusal; without this they are all satisfied by a validator
    // that refuses everything.
    expect(validateV3Spec([arm({ expectFailures: 1 })]).loadable).toBe(true);
    expect(validateV3Spec([arm()]).loadable, 'the field is optional').toBe(true);
    expect(expectFailuresProblems(arm(), 0), 'absent yields no problem').toEqual([]);
    expect(validateV3Spec([arm({ expectFailures: 3 })]).loadable, 'a larger total is fine').toBe(true);
  });

  it('★★★⛔ ZERO IS REFUSED — a mutation that breaks nothing is a SURVIVED hole', () => {
    const r = validateV3Spec([arm({ expectFailures: 0 })]);
    expect(r.loadable).toBe(false);
    expect(r.problems.join(' ')).toMatch(/SURVIVED hole, not a witness/);
  });

  it('★★★ a NEGATIVE total is refused for the same reason', () => {
    expect(validateV3Spec([arm({ expectFailures: -1 })]).loadable).toBe(false);
  });

  it('★★★ a STRING is refused — it can never equal a number under !==', () => {
    const r = validateV3Spec([arm({ expectFailures: '1' })]);
    expect(r.loadable).toBe(false);
    expect(r.problems.join(' ')).toMatch(/non-integer expectFailures/);
  });

  it('★★★ a NON-INTEGER number is refused — an unreachable total', () => {
    expect(validateV3Spec([arm({ expectFailures: 1.5 })]).loadable).toBe(false);
    expect(validateV3Spec([arm({ expectFailures: NaN })]).loadable).toBe(false);
    expect(validateV3Spec([arm({ expectFailures: Infinity })]).loadable).toBe(false);
  });

  it('★★★ the message NAMES the offending arm, so a multi-arm spec is actionable', () => {
    const r = validateV3Spec([arm({ name: 'A1 fine', expectFailures: 1 }), arm({ name: 'B2 broken', expectFailures: 0 })]);
    expect(r.problems.join(' ')).toMatch(/B2 broken/);
    // ⛔ CONTROLLED ABSENCE. Canaries prove the matcher fires on the healthy arm's name and
    // does NOT fire on the broken one's, so its silence about the problem list means something.
    expectAbsentWithLiveMatcher(
      /A1 fine/,
      { forbidden: 'spec[0] "A1 fine" has expectFailures 0', allowed: 'spec[1] "B2 broken" has expectFailures 0' },
      r.problems.join(' '), 'the healthy arm is not blamed');
  });

  it('★★★ the live corpus satisfies it — this gate is not aspirational', () => {
    // If a tracked spec violated the rule, the apparatus would refuse it at load and the ledger
    // would be claiming a runnable state the tool cannot honour.
    expect(expectFailuresProblems({ name: 'live', expectFailures: 1 }, 0)).toEqual([]);
  });
});
