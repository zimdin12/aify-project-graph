# A check whose result nothing consumes is not a gate

**Date:** 2026-09-02
**Artifact:** `scripts/gated-commit.mjs`
**Cost:** zero agent budget.

## The defect, which happened twice

| when | the check | what landed anyway | mechanism |
|---|---|---|---|
| earlier in this arc | full suite, `VITEST_EXIT=1` | a **push** | `git push` chained unconditionally |
| 2026-09-02 | plan citation gate, RED | a **commit** (`585f579`) | chained with `;` instead of `&&` |

Both checks worked perfectly. Both correctly went red. Neither result was consumed, and in both cases
I only noticed afterwards by reading the output myself.

The instance fix each time was "use `&&`". That is a rule I have to remember, and this project's own
recurring lesson is that **a rule is not a remedy** — only a fail-closed default or a forced door is.

## The remedy

`scripts/gated-commit.mjs` owns the sequence: it runs the fast doc/evidence gates and commits *only*
on green, from one command. **There is no separator left to get wrong**, because there is no
separator.

The message arrives on **stdin** and reaches git via `commit -F -`, never interpolated into a shell
command, so backslashes, quotes and newlines survive intact — a failure mode that has corrupted
content in this project repeatedly.

⚠ **Scope, so it is not mistaken for the push gate.** It runs the sub-second doc/evidence gates only
(891 ms for 8 tests). It does **not** run the full suite, and passing it is **not** permission to
push. The full suite must still be green for the commit being pushed, read from `VITEST_EXIT` in the
log rather than from any harness summary.

## Mutants — both run, tree committed at `85ab7dc` first

| Mutant | Result |
|---|---|
| **G-1** a bogus citation added to the plan (gate genuinely RED) | **REFUSED** — exit 1, and `HEAD` **unchanged**. The decisive check is not that it printed a refusal but that **no commit was created**. |
| **G-2** the gate's status check replaced with `if (false)` | **Commit created despite a RED gate** — so the status check is load-bearing, not decoration. Reset to anchor; tree verified clean. |

G-2 is the one that matters. Without it, a script that printed "REFUSED" and committed anyway would
have looked identical to a working gate in G-1's output.

## What I deliberately did not build

A unit test that drives this script would have to spawn vitest inside vitest and mutate the plan from
within a test run — slow, fragile, and testing my tooling rather than the product. The two mutants
above are the evidence, recorded here rather than turned into a meta-test whose own failure modes
would need their own gate.

## Ceiling

This closes the *mechanism* — a wrong separator can no longer let work land past a red gate on the
paths that use it. It does not stop me calling `git commit` directly, and it says nothing about
whether the gates themselves cover the right things.
