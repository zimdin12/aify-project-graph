# Four of five caveats on the delete path are unconditional

**Date:** 2026-09-03
**Probe:** `scripts/probe-clause-firing-rate.mjs`
**Status:** MEASURED, both controls passing. **Candidates identified, no cut made.**

## Why this was measurable after all

I declined twice to cut a clause, on the grounds that the choice depends on what an agent READS,
which needs the expensive A/B. That reasoning holds for **usefulness**. It does not hold for
**frequency** — and this repo already carries a rule about frequency, derived from a field report
rather than from my preference:

> A binary flag on an active repository is always on, and an always-on warning is ignored — the route
> by which a guard becomes decoration.

## Result

50 real absence answers from this repository, bucketed by the shape actually returned:

**NO CALLERS (n=21)** — the answer that licenses a deletion

| clause | fired | rate | |
|---|---|---|---|
| INDEXED SCOPE | 21/21 | **100%** | always on |
| NOT MODELLED | 21/21 | **100%** | always on |
| LSP SCOPE | 21/21 | **100%** | always on |
| TRUST | 21/21 | **100%** | always on |
| **RELATIONS** | 5/21 | **24%** | **conditional — carries signal** |

**NO MATCH (n=10):** INDEXED SCOPE 10/10 = 100%.

**AMBIGUOUS (n=19):** none of the six labelled clauses fire. ⚠ That path carries its own
caller-count caveat which is not in this probe's label list, so this row is a limit of the
measurement, not a finding about that path.

⇒ **Four of five clauses on the delete path are unconditional.** By the repo's own rule they are cut
CANDIDATES. `RELATIONS` is the only one that varies with the answer.

## ⛔ The first run said the opposite, and the denominator was mine

Pooled across all 50 answers, `TRUST` read 21/50 = 42% "conditional", and the verdict was **"no
clause is unconditional — the always-on rule identifies no candidate."**

That was an artifact. The two absence shapes carry **different clause sets**: the empty-set path
renders TRUST / LSP SCOPE / NOT MODELLED, and NO MATCH renders none of them. Pooling two populations
with different denominators made every empty-set clause look conditional.

⚠ **And the strata were my intention, not the observation.** I labelled 40 specimens "NO CALLERS"
because I had selected them as callerless; only 21 produced that shape, and 19 came back AMBIGUOUS.
Bucketing by the answer actually returned is what exposed it.

⚠ A sibling wrong-noun error in the same probe was caught minutes earlier by the shape control: the
selection excluded only `CALLS` while `graph_callers` searches `EXECUTION_FAMILY`
(CALLS/INVOKES/PASSES_THROUGH), so three "callerless" symbols had callers. Now imported from the
taxonomy the verb itself reads.

## ⛔ Claim ceiling — this does NOT decide the cut

**Frequency is not usefulness.** An always-on clause can still be the single most important sentence
on the surface; TRUST plausibly is. What this licenses is exactly one inference, through the repo's
recorded rule: *these four are the candidates, and RELATIONS is not.*

One repository, one tree state, one language mix. The uncommitted clauses fired 0% here **because the
tree was clean by construction** — that is the probe working, not evidence they are dead.

⇒ The decision still wants a second reader. It is now a question with data attached rather than a
matter of taste.
