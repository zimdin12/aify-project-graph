# Preregistration — the deletion guard, field test

**Written before the hook has been enabled anywhere and before a single field decision exists.**
Everything below — thresholds, abandon rule, what counts as success — is fixed now, so that a number
that arrives later cannot quietly become the number we wanted.

Every previous adoption claim on this project has been wrong by a wide margin, always in the
optimistic direction. A threshold chosen after seeing the data is a threshold chosen to fit it.

## What is being tested

A `PostToolUse` hook that fires when an edit deleted an exported declaration which still has
compiler-verified callers. It is the only mechanism this project has that attacks **mid-task reach**
— the measured bottleneck: entry-point reach works, mid-task reach does not.

⚠ **Status today: PASSES IN TESTS, never run in the field.** It is in no settings file, has never
fired in a live session, and its efficacy is entirely unmeasured. The 4.8% figure is a fire-RATE
upper bound from historical commits. It says nothing about whether an agent that receives the
message does anything different.

## What is needed to run it — the checklist

1. **Operator enables it.** One entry in `settings.json`; `mergeDeletionGuardHook` writes it.
   ⚠ This is the only step that is not mine. Placement is recorded as the operator's decision.
2. **The decision log.** ✅ Done — every decision, including the silent ones, appends one line to
   `.aify-graph/hook-decisions.jsonl`. Without the silent rows there is no denominator and no rate.
3. **A working population.** Real editing sessions in APG-indexed repos. Not a scripted corpus:
   the thing being measured is what agents actually do.
4. **A minimum sample.** See below — a rate from four edits is not a rate.
5. **This document.** Fixed before the data exists.

## Preregistered thresholds

**Minimum sample before ANY conclusion: 200 logged decisions** in repos the hook serves. At the
predicted rate that is ~10 firings. Below 200, the only honest report is "not enough data" — and
that report must be made rather than quietly waiting for a friendlier number.

| measure | prediction | fails if |
|---|---|---|
| **fire rate** — `fired / all logged decisions` | ≤ 4.8% (historical upper bound) | **> 10%.** The bound was wrong and the rule is noisier than measured. |
| **true positive** — the named symbol genuinely had callers | ≥ 90% | **< 80%.** The graph's edges cannot support the claim, and the message is misleading agents. |
| **usefulness** — the agent restored the symbol, updated the callers, or explicitly reasoned about the finding | no prediction | see below |

⚠ **No prediction is offered for usefulness, deliberately.** Nothing measured so far licenses one,
and inventing a number I could later claim to have hit is the failure this document exists to
prevent.

## ⛔ The abandon rule, fixed in advance

**Disable the hook and report it as a negative result if any of these hold at ≥ 200 decisions:**

- fire rate **> 10%** — it is slop by the roadmap's own exit criterion, however clever
- true-positive rate **< 80%** — it is confidently wrong, which is worse than silent
- **zero** firings across **500** decisions — too rare to be worth its latency and its surface
- any evidence it caused a **wrong** edit (an agent restored something that genuinely should have
  gone, because the hook asserted callers that were stale)

⇒ A negative result here is a real result and gets published the same way a positive one does. The
hook is not the goal; mid-task reach is, and this is one candidate answer to it.

## Controls

- **Positive control, already standing.** `tests/integration/deletion-guard-hook-fires.test.js`
  drives the real script over a real repo, database and deletion and asserts it SPEAKS. A field run
  of all-silence is only interpretable because this proves the speaking path works.
- **The log must GROW.** A silent logging failure would make every rate unmeasurable while looking
  exactly like a quiet period. Check the file's line count increases before reading any rate from it.
- **The denominator is edits, not deletions.** Silent decisions are logged for exactly this reason.
  Reporting fires-per-deletion as if it were fires-per-edit would inflate the rate by roughly the
  factor that separates them.

## ⚠ What this test CANNOT establish

- **Anything about other operators.** One machine, one person's editing habits.
- **Efficacy at scale.** A rare signal's value depends on the cost of the mistake it prevents, and a
  sample of ~10 firings cannot estimate that.
- **That mid-task reach is fixed.** This is one rule, on one contradiction, in one language's
  extractor. It is a probe of the hypothesis, not a solution to it.
- **Causation.** If an agent behaves better while the hook is on, nothing here separates the hook
  from everything else that changed today.
