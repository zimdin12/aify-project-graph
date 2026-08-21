// ⛔ D2's PROMOTION IS ONLY AS GOOD AS THE ARTIFACTS IT RESTS ON.
//
// A ledger row saying `v3_failure_observed_unattributed` is a claim about an experiment. This binds
// that row to the exact bytes the experiment produced, so the state cannot drift away from its
// evidence — and so a later edit to the spec, the preregistration, or the artifacts breaks the gate
// rather than silently invalidating the promotion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../../helpers/self-review-specs.js';

const SR = join(REPO, 'tests', 'self-review');
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

const manifest = () => json(join(SR, 'receipts', 'D2', 'manifest.json'));
const mutant = () => json(join(SR, 'receipts', 'D2', 'arm-0-mutant.json'));
const baseline = () => json(join(SR, 'receipts', 'D2', 'arm-0-baseline.json'));
const prereg = () => json(join(SR, 'preregistrations', 'D2.json'));
const ledger = () => json(join(SR, 'migration-ledger.json'));

const D2 = 'D2 a pending start is reported as already_running';

describe('the D2 promotion is bound to the artifacts that earned it', () => {
  it('★★★ the ledger row records the promoted state and its bounded claim', () => {
    // ⛔ POSITIVE CONTROL: without this, every assertion below could pass against a ledger that had
    // silently reverted the promotion.
    const row = ledger().entries[D2];
    expect(row.state).toBe('v3_failure_observed_unattributed');
    expect(row.reason, 'the bounded claim travels with the state').toMatch(/same-key JOIN route/);
    expect(row.reason, 'and what it does NOT establish').toMatch(/NOT v3_witnessed/);
  });

  it('★★★ the manifest binds the AUTHORIZED carrier, not some later commit', () => {
    // The run happened at 6d9fd5a/647c92e. Later commits do not retroactively move that carrier,
    // and a receipt naming a different one would be evidence about a different experiment.
    const m = manifest();
    expect(m.commit).toBe('6d9fd5a2cbca183883e1afa75616c458bb81d42a');
    expect(m.tree).toBe('647c92e668412ae1e6791b65d368ca193cc166da');
    expect(m.specPath, 'and it consumed the TRACKED spec, not a constructed one')
      .toMatch(/dashboard-ownership-D2\.spec\.json$/);
  });

  it('★★★ the mutation landed at the PREREGISTERED anchor offset', () => {
    // 1767 was written down before the run and independently confirmed by the referee. A different
    // offset would mean the mutation hit a site nobody approved.
    expect(manifest().arms[0].mutation.anchorOffset).toBe(prereg().carrier.anchorResolution.index);
    expect(prereg().carrier.anchorResolution.index).toBe(1767);
  });

  it('★★★ the observed failure IS the preregistered predicate, not a lookalike', () => {
    // ⛔ THE HEART OF IT. D1 failed here: its predicate named an assertion whose value was identical
    // in both worlds. This asserts the exact registered string appears in the one accountable message.
    const failing = mutant().cases.filter((c) => c.status !== 'pass');
    expect(failing.length, 'exactly one failing case').toBe(1);
    expect(failing[0].messages.length, 'exactly one accountable message').toBe(1);
    expect(failing[0].messages[0]).toContain(prereg().expect);
  });

  it('★★★ the baseline was clean — a red baseline would make the mutant meaningless', () => {
    const b = baseline();
    expect(b.counts.failedCases).toBe(0);
    expect(b.counts.nonCaseErrors).toBe(0);
    expect(b.cases.length, 'the whole file ran').toBe(10);
  });

  it('★★★ the falsifiable no-EBUSY prediction is recorded AND was observed', () => {
    // ⚠ It held ONCE, on this Windows carrier, against this mutation. The ledger says so; this gate
    // proves the artifact agrees with the prediction rather than the prose agreeing with itself.
    expect(prereg().leakPrediction).toMatch(/NO EBUSY/);
    const everyMessage = mutant().cases.flatMap((c) => c.messages ?? []).join(' ');
    expect(everyMessage, 'no EBUSY in any message of the mutant run').not.toContain('EBUSY');
  });

  it('★★★ the different-key cases stayed green, as the population argument predicted', () => {
    const passing = mutant().cases.filter((c) => c.status === 'pass').map((c) => c.name);
    expect(passing.some((n) => n.includes('does not ERASE')), ':256 green').toBe(true);
    expect(passing.some((n) => n.includes('COMPLETING while teardown')), ':332 green').toBe(true);
  });

  it('★★★ the verdict recorded is the CEILING, never above it', () => {
    // Body attribution is open, so FAILURE_OBSERVED_UNATTRIBUTED is the most this run can earn.
    expect(manifest().arms[0].verdict).toBe('FAILURE_OBSERVED_UNATTRIBUTED');
    expect(prereg().claimCeiling).toBe('v3_failure_observed_unattributed');
  });
});
