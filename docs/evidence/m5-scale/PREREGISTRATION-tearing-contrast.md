# Preregistration — does a torn graph actually change what a verb says?

**Written:** 2026-09-02, **before** the probe exists and before any result.

## Why this exists

`scripts/lib/ab-rubric.mjs:47` declares three gate-carrying verbs:

```js
export const GATE_CARRYING_VERBS = Object.freeze(['graph_health', 'graph_status', 'graph_preflight']);
```

and `tests/unit/ab/rubric-cannot-fail-open.test.js:134` pins that list, explaining it as verbs whose
route **"does not actually change under tearing"** if wrongly added.

My route census (`FINDING-route-census-publication-state.md`) measured a different property —
**which verbs consume publication state** — and found 29, including `graph_callers`. I was one step
from calling the rubric a false-negative generator on that basis.

**That would have been a noun-slide.** "Consumes publication state" and "changes under tearing" are
different claims, and the plan's own rule forbids sliding from one to the other in prose. Reading
`callers.js:35` (`if (freshness.blocker) return freshness.blocker`) makes the change look certain,
but reading source is not measuring behaviour — that exact substitution has falsified two of my
predictions in this project already. So: measure it.

## Question

For the same query on the same graph, does a verb's **rendered output differ** between an attested
publication state and a torn one?

## Population

Fixed here, before any result:

- The three the rubric credits: `graph_health`, `graph_status`, `graph_preflight`.
- Three consumers the rubric excludes: `graph_callers`, `graph_search`, `graph_impact`.
- One non-consumer as a negative control: `graph_packet`.

## Identity rule

**Torn** = `manifest.json`'s `generation` differs from the database's `graph_generation.generation`,
which `classifyAttestation` (`publication-schema.js:224`) maps to `GENERATION_MISMATCH`.

**Changed under tearing** = the rendered text output is not byte-identical between the attested and
torn runs of the *same* call. Volatile fields (timestamps, durations, absolute temp paths) are
normalised before comparison, and the normaliser is shown to still detect a real difference.

## Finding schema

One row per verb: `{ verb, changed: boolean, shape: 'blocker' | 'warning' | 'none' }`.

## Controls, in the same pass

- **POSITIVE — the tearing was actually applied.** `classifyAttestation` on the fixture must return
  `GENERATION_MISMATCH`. A probe that silently failed to tear anything would report "nothing changes"
  for every verb, and that clean zero is exactly the answer I would be tempted to accept for the
  three-name list.
- **POSITIVE — the instrument can see a change.** `graph_health` must change. It is *the* trust verb;
  if tearing does not move it, the probe is broken, not the product.
- **NEGATIVE — the instrument can say "no change".** `graph_packet` consumes no publication state and
  must NOT change. Without this, a normaliser that made everything unequal would "prove" every verb
  gate-carrying.
- **NEGATIVE — the comparison is not vacuous.** Two attested runs of the same verb must compare
  EQUAL, or the outputs are simply non-deterministic and no difference means anything.

## Claim ceiling

This measures **one tearing mode** (generation mismatch) on a **small JavaScript fixture**, through
the verb functions directly. It does not speak for C++, for the other attestation classes
(`LEGACY_UNATTESTED`, `NEVER_COMPLETED`, `MANIFEST_UNUSABLE`), or for the live `code_intel_*` path.
And a change in output is **not** evidence that the change is useful to an agent — that is a
decision-utility question the A/B exists to answer, not this probe.

## Abandon rule

If the fixture cannot be torn such that `graph_health` changes, **stop and report the probe as
broken**. Do not conclude anything about `graph_callers`, and do not adjust the rubric.

## What I will do with each outcome, decided now

- **`graph_callers` changes** → `GATE_CARRYING_VERBS` under-counts, and `gateReached` is a false
  negative for agents who routed to it. Fix the rubric by deriving the list, and record that the
  pinned three-name test encoded an assumption that measurement did not support.
- **`graph_callers` does not change** → the rubric is right and my census measured a property that
  does not imply the one the rubric needs. Record the census's ceiling more sharply and leave the
  rubric alone.
- **Mixed across the three excluded verbs** → report per verb. No averaging, no headline.
