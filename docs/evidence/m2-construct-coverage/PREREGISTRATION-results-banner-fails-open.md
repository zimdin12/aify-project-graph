# Preregistration — what does an agent receive when the RESULTS trust banner fails to build?

**Written:** 2026-09-02, before the fault was injected and before any output was observed.

## Why

Last cycle closed the same defect on the **absence** path: `buildAbsenceTrustLine` throwing shipped a
bare `NO CALLERS` with no caveat. That finding named its own gap — *"says nothing about other
`catch {}` blocks, of which there are more."*

Measured now: **7 of 8** `buildTrustLine` call sites swallow into a comment-only catch
(`callees.js:203`, `callers.js:202`, `change_plan.js:318`, `explain_diff.js:322`, `impact.js:214`,
`neighbors.js:70`, `preflight.js:269`; `trace.js:357` was fixed last cycle).

`buildTrustLine` guards a **results** banner rather than an absence claim, and that is a genuinely
weaker case — the agent holds positive evidence either way. But the banner is what carries the
**FLOOR** statement: that a returned caller set is heuristic and not exhaustive. Losing it silently
means a partial caller list reads as complete, which is the same "knows when NOT to trust us" failure
one step over.

⚠ **I have not yet confirmed the banner carries a floor statement in the faulted case** — that is
part of what the measurement establishes, not an assumption I get to carry in.

## Question

With `buildTrustLine` induced to throw, what does an agent receive from a **non-empty** result?

## Population

The seven swallowing call sites above. Exercised through the verb functions on
`tests/fixtures/identity-hostile`, on a query that returns edges (so the results path runs, not the
absence path).

## Identity rule

- **Fails open** = the result still lists edges while containing **no** `TRUST` marker and no
  statement that the set is a floor / not exhaustive.
- **Fails closed** = the results are withheld, or an explicit notice says the trust banner was
  unavailable.

## Finding schema

One row per verb: `{ verb, resultsStillReturned, trustPresent, noticePresent }`.

## Controls, same pass

- **POSITIVE — the un-faulted path carries a banner.** Otherwise "no TRUST" could mean the fixture
  never produced one.
- **POSITIVE — the injected fault actually fires.** A mock that failed to apply would show healthy
  output and be read as "fails closed" — the wrong answer, confidently. Asserted by counting throws.
- **POSITIVE — the query really returned edges**, or the absence path ran instead and the result says
  nothing about this population.

## Claim ceiling

Behaviour under an **induced** fault, on one fixture. It does not estimate how often `buildTrustLine`
throws in production. It does not show an agent would act differently — only what it is told.

## Abandon rule

If a non-empty result cannot be produced, or the fault cannot be made to fire, report the probe as
unable to run and conclude nothing.

## Decided in advance

- **Fails open** → apply the same fix as the absence path: an explicit unavailability notice, not a
  block. Reuse the existing constant if its wording fits a results banner; write a second one only if
  it does not, and say why.
- **Already discloses** → record it and leave the code alone. ⚠ A weaker case than the absence path
  is still allowed to end here: not every swallowed caveat has to be fixed to justify the check.
