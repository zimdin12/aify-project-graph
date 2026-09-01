# M3a input — what the post-commit reindex actually costs

Found while investigating why the collision-node population changed under me mid-session. Recorded
now because it is real data on a real repo, and M3a will need it.

---

## ⛔ READ THIS FIRST — ONLY ONE STATEMENT IN THIS FILE IS THE FINDING

**The current finding is the block quote under "What this now says about M3a", and nothing else.**

This document deliberately preserves **three superseded formulations** of the same claim, because
the sequence of my errors is more instructive than the destination:

1. "they share a goal, not a code path" — **too weak**, hid a real risk
2. "the dataset transfers to watcher cost" — **too strong**, invented a measurement never taken
3. "the same expensive-capable core" — a **noun** re-importing (2) through connotation

⚠ **None of the three may be quoted as the finding.** They are lineage. A reader — or an agent
grepping this file — who lifts a superseded line will be quoting a claim this document exists to
retract, which would be a nastier version of the very defect being recorded.

M3a status: **HOLD.**

---

## ⚠ Two corrections I had to make to my own first reading

**1. It does not block.** I first reported this as "43–88 seconds per commit", which reads as
latency a developer pays. `.git/hooks/post-commit` ends the invocation with `&` — best-effort,
**backgrounded**. Nobody waits. The seconds are background CPU/IO, not blocking cost.

**2. It is not `APG_AUTO_SYNC`** — but ⛔ **MY ORIGINAL WORDING HERE WAS WRONG AND UNDERSTATED THE
TRANSFER.**

> ⛔ **RETRACTED — NOT CURRENT — DO NOT QUOTE.** *"they share a goal, not a code path, and these
> numbers do not transfer to the watcher."* Too weak: it hid a real risk. Read again: `scripts/reindex.mjs:14` imports `ensureFresh` from the orchestrator, and
`startAutoSync` calls `ensureFresh({ repoRoot })` on each debounced burst. **They share the core
code path.** What differs is the TRIGGER — HEAD movement versus a 750 ms-debounced file-change
burst — and the hook's extra brief/categorization pass.

⇒ ⚠ **AND THEN I OVER-CORRECTED.**

> ⛔ **RETRACTED — NOT CURRENT — DO NOT QUOTE.** *"the cost does transfer to the watcher's
> `ensureFresh` call, and only FREQUENCY does not."* Too strong in the opposite direction: it
> invented a measurement never taken.

Review caught it: **the trigger changes the INPUT STATE, not merely how often it fires.**

| | HEAD | working tree |
|---|---|---|
| post-commit hook | just moved | normally clean |
| watcher burst | unchanged | **dirty / in-flight mid-edit** |

`ensureFresh` can select different rebuild, dirty-file, fingerprint and cosmetic-skip paths under
those states. So the measurement below establishes **post-commit `ensureFresh` cost on this repo**
and makes watcher cost a **credible risk** — it does not establish that a watcher invocation has
the same distribution, nor that the watcher's incremental path is a minority.

Both of my formulations were overclaims in opposite directions: "no shared code path" hid a real
risk, "the dataset transfers" invented a measurement I never took.

**3. My first parse conflated two fields.** Grepping `in Nms` returned n=964 from 482 lines, because
every line carries *two* such fields (reindex, then briefs+categorization), and I read a median off
the mixed set before noticing. The figures below come from the anchored pattern `NN/NE in Nms`,
one per line.

## The dataset

`.aify-graph/hook.log`, 482 events, **2026-08-12 → 2026-09-01** (20 days). Line shapes enumerated:
471 `post-commit`, 5 `post-rewrite`, 6 one-offs. Graph grew **4,223N/14,325E → 6,103N/20,243E**.

Reindex duration:

| bucket | n | share |
|---|---|---|
| <1s | 38 | 7.9% |
| 1–5s | 1 | 0.2% |
| 5–15s | 5 | 1.0% |
| 15–30s | 147 | 30.5% |
| 30–60s | 252 | 52.3% |
| >60s | 39 | 8.1% |

median **35.2s**, p90 **54.1s**, max **158.0s**.

## The finding worth carrying into M3a

The distribution is **bimodal**: a small ~8% fast path under one second, and **91% at 15 seconds or
more**. Whatever the incremental and cosmetic-skip machinery saves, it is **not engaging on the
typical commit here** — the full-rebuild path is the common outcome, not the exception.

That is the claim: *the incremental path is a minority outcome on real commits in this repo.* It is
**not** a cost-per-commit claim, and it is **not** a recommendation about the auto-sync default.

## What this now says about M3a

The watcher bounds its **queue depth** to one pending rerun: an in-flight sync sets `pendingSync`
rather than enqueueing. ⚠ That is narrower than what I first wrote:

> ⛔ **RETRACTED — NOT CURRENT — DO NOT QUOTE.** *"bursts cannot pile up."* Reads as a duty-cycle
> guarantee; the code bounds queue depth only.
 **Continuous editing can keep setting `pendingSync` during each rerun and sustain repeated
back-to-back `ensureFresh` calls — coalescing bounds the queue, not the duty cycle or the total
number of invocations.**

⇒ What M3a can state **now**, and no more than this:

> ✅ **CURRENT FINDING — this block quote, and nothing else in this file.**
>
> The watcher and the post-commit hook use a **shared implementation with demonstrated expensive
> behaviour under post-commit input** (median 35.2 s, 91% ≥ 15 s over 482 events). The watcher's
> **trigger frequency**, its **dirty-state cost**, the **`ensureFresh` paths it selects**, and its
> **sustained-rerun behaviour** are all unmeasured. Default-on remains **HELD**, pending matched
> dirty-edit-burst measurements.

⚠ The phrasing is deliberate.

> ⛔ **RETRACTED — NOT CURRENT — DO NOT QUOTE.** *"the same expensive-capable core."* A noun that
> re-imports the over-correction through connotation.

That draft can be read as an observation about the WATCHER's cost. Nothing here observed the watcher at all — the
expense is demonstrated under post-commit input only, and the sentence has to carry that or it
becomes the third overclaim in this document.

⛔ It is specifically **not** gated on a claimed watcher incremental-rate result. I do not have one,
and asserting the incremental path is a minority *for the watcher* would be transferring a
post-commit figure to a state it was never measured in — the same move I have just made twice.

## Addendum — a bounded observed duration ratio under suite overlap (2026-09-01)

Six consecutive idle post-commit reindexes, then two that overlapped a running test suite:

```
idle        43144  43159  43038  43102  44376  42953 ms     ≈ 43 s, ±1 s
under load  83387  83791 ms                                  ≈ 83.6 s
```

**Observed ratio ≈1.94×.** ⛔ This is an **association under one carrier, not a contention factor
and not a causal penalty** — an earlier draft called it both, and neither is licensed.

⚠ **The groups differ by more than load.** They are different commits against a growing graph:
6230N/19977E idle versus 6241N/20021E and 6241N/20025E overlapped. Graph size, commit content and
load all move together, so tight within-group spread (1.4 s and 0.4 s) narrows the *measurement*
error and removes **none** of that correlated confounding. Two loaded points cannot separate them.

What it bears on for M3a: a watcher fires during active work, so a duration observed under
concurrent load is *closer to the watcher's operating conditions* than an idle one. That is a
reason to keep the HOLD, not a figure to plan against.

⚠ **It does NOT close the HOLD, and it is not the missing measurement.**
- The competing load was a test suite plus a reindex, **not editing**.
- The input state is still **post-commit** — clean tree, HEAD moved — not the dirty mid-edit burst
  the watcher actually sees. That is the same transfer gap retracted twice above; this addendum
  narrows the cost question, not the state question.
- n=2 under load. The tight spread is suggestive, not a distribution.

⇒ It shows post-commit `ensureFresh` duration is **associated** with concurrent load on this
carrier. It does not establish causation, does not measure the watcher, and leaves all four
unmeasured quantities in the CURRENT FINDING exactly as they were.

## Limits

One repo, one machine. Duration is wall-clock on a machine that was also running full test suites
for part of the span, so the tail is contaminated by my own load.

⚠ Nothing here measures the watcher's trigger frequency, its dirty-state cost, the `ensureFresh`
paths it selects, or its sustained-rerun behaviour. (This sentence previously read "nothing here
measures the watcher path", which contradicted the correction above once `ensureFresh` was found to
be shared. ⛔ It then read "the cost per invocation transfers; how often it fires does not" — which
**restored the retracted overclaim inside the note explaining the retraction**. Retracted again;
see the CURRENT FINDING for what is actually established.)
