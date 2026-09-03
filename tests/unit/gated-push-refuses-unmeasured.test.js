// ⛔ THE ONE RULE WITH NO INSTRUMENT WAS THE ONE I BROKE.
//
// "Full suite green before push", no docs-only exemption. On 2026-09-03 I pushed a plan edit on the
// fast doc gates alone. It was green, so nothing broke — luck, not process.
//
// ⭐ Every OTHER rule that caught me that night was MECHANICAL: run-suite refusing on a dirty tree,
// the commit stamp exposing a suite that never ran, the negative-assertions ratchet, the citation
// gate. This one relied on memory and had nothing to fire. That asymmetry is the whole argument for
// this file.
//
// ⚠ The verdict is a PURE function so it can be tested without a repo, a remote, or a push. Testing
// it by actually pushing would be a control that costs something to fail.
import { describe, it, expect } from 'vitest';
import { readStamp, verdict } from '../../scripts/gated-push.mjs';

const HEAD = 'a'.repeat(40);
const MEASURED = 'b'.repeat(40);
const base = { stamp: { sha: MEASURED, exit: 0 }, headSha: HEAD, commitsAfterStamp: [], stampIsAncestor: true };

describe('gated-push refuses to push what the suite has not measured', () => {
  it('⛔ POSITIVE CONTROL: HEAD == the measured commit passes — or every refusal below is vacuous', () => {
    // Without this, a verdict that refused everything would satisfy each refusal case while making
    // pushing impossible.
    const v = verdict({ ...base, stamp: { sha: HEAD, exit: 0 } });
    expect(v.ok, 'a measured HEAD must be pushable').toBe(true);
  });

  it('★★★ an UNMEASURED commit after the stamp is REFUSED, and named', () => {
    // The exact failure this exists to prevent: a docs edit committed after the suite ran.
    const v = verdict({
      ...base,
      commitsAfterStamp: [{ sha: 'c'.repeat(40), files: ['docs/PLAN-agent-knowledge-system.md'] }],
    });
    expect(v.ok).toBe(false);
    expect(v.why, 'the reader must see WHICH commit and WHICH file').toMatch(/PLAN-agent-knowledge-system/);
  });

  it('★★★ an EVIDENCE-ONLY commit after the stamp is allowed — it is written BY the measured run', () => {
    // The suite log is produced by the run being trusted, so a commit touching only it cannot
    // contain unmeasured content. Without this the gate would refuse the normal workflow and get
    // bypassed, which is worse than not having it.
    const v = verdict({
      ...base,
      commitsAfterStamp: [{ sha: 'd'.repeat(40), files: ['docs/evidence/suite/latest.log'] }],
    });
    expect(v.ok, 'the evidence commit must not block its own push').toBe(true);
  });

  it('⛔ a MIXED commit is refused — evidence plus anything else is still unmeasured', () => {
    // The tempting hole: bundling a "small" change into the evidence commit.
    const v = verdict({
      ...base,
      commitsAfterStamp: [{ sha: 'e'.repeat(40), files: ['docs/evidence/suite/latest.log', 'mcp/stdio/query/verbs/callers.js'] }],
    });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/callers\.js/);
  });

  it('★★★ a RED suite is refused even when HEAD is exactly the measured commit', () => {
    // Coverage is not the only question. A green stamp for the wrong commit and a red stamp for the
    // right one are both unpushable, and they fail for different reasons.
    const v = verdict({ ...base, stamp: { sha: HEAD, exit: 1 } });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/RED \(VITEST_EXIT=1\)/);
  });

  it('⛔ a stamp from ANOTHER line of history is refused', () => {
    const v = verdict({ ...base, stampIsAncestor: false });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/NOT an ancestor/);
  });

  it('⛔ a log with no stamp or no VITEST_EXIT is refused, not treated as green', () => {
    // A truncated or half-written log must fail closed. "Could not tell" is never "fine".
    expect(verdict({ ...base, stamp: { sha: null, exit: 0 } }).ok).toBe(false);
    expect(verdict({ ...base, stamp: { sha: MEASURED, exit: null } }).ok).toBe(false);
  });

  it('the parser reads a real run-suite footer, including a RED one', () => {
    // Anchored on the actual format run-suite writes, not an invented one.
    const green = readStamp('...dots...\n\nSUITE FOR COMMIT 0ca63f86ab200d01985b7be61f3bbe7494568c65\nFINISHED 2026-09-03T04:09:36.970Z\nVITEST_EXIT=0\n');
    expect(green.sha).toBe('0ca63f86ab200d01985b7be61f3bbe7494568c65');
    expect(green.exit).toBe(0);

    // ⛔ AND IT MUST READ A RED ONE AS RED. A parser that only ever finds 0 would pass every test
    // above while certifying every failed run as green.
    expect(readStamp('SUITE FOR COMMIT abc1234\nVITEST_EXIT=1\n').exit).toBe(1);
  });
});
