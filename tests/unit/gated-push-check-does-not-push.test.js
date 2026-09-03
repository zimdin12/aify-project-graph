// ⛔ THE HOOK RUNS DURING A PUSH, SO --check MUST NOT PUSH.
//
// `.git/hooks/pre-push` calls `gated-push.mjs --check`. If that path ever falls through to the
// `git push` at the end of main(), the hook re-enters git push from inside a push. This test exists
// because that branch is one deleted line away and the failure is not quiet — it recurses.
//
// ⚠ WHAT THIS DOES AND DOES NOT PROVE. It proves the DECISION is right. It does not prove main()
// consumes the decision — that is the wired-not-consumed gap I have hit repeatedly, and no pure test
// closes it. What closes it is the live control run on 2026-09-03 against this repository: `--check`
// printed the OK line and pushed nothing, and a plain `git push` on an unmeasured commit was refused
// with exit 1. Recorded here so the ceiling of this file is not overread.
import { describe, it, expect } from 'vitest';
import { pushPlan } from '../../scripts/gated-push.mjs';

describe('pushPlan decides exactly one action', () => {
  it('⛔ POSITIVE CONTROL: a passing verdict with no flags PUSHES — or every case below is vacuous', () => {
    // Without this, a pushPlan that never returned 'push' would satisfy the check-only and refuse
    // cases while making the script incapable of pushing at all.
    const plan = pushPlan({ ok: true, argv: [] });
    expect(plan.action).toBe('push');
    expect(plan.args, 'the default target must still be spelled out').toEqual(['origin', 'main']);
  });

  it('★★★ --check returns check-only, so the pre-push hook cannot recurse into git push', () => {
    expect(pushPlan({ ok: true, argv: ['--check'] })).toEqual({ action: 'check-only' });
  });

  it('★★★ a FAILED verdict refuses, and --check does not buy a way past it', () => {
    // The order matters: if --check were tested first, running the hook would turn every refusal
    // into a silent pass — the gate would be loudest exactly where it is never invoked.
    expect(pushPlan({ ok: false, argv: [] }).action).toBe('refuse');
    expect(pushPlan({ ok: false, argv: ['--check'] }).action).toBe('refuse');
  });

  it('an explicit remote and branch are passed through rather than replaced by the default', () => {
    expect(pushPlan({ ok: true, argv: ['origin', 'HEAD:main'] }).args).toEqual(['origin', 'HEAD:main']);
  });
});
