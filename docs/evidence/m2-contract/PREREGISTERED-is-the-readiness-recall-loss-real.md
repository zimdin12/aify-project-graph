# Preregistered: is the readiness recall loss real enough to build a discriminator for?

**Written before the result exists.** 2026-09-04, at `59462c6a`.

## Why this is being measured instead of built

Making `index_ready` three-state (`05e6464b`, `4cddd5d4`) accepted a stated cost: a collection whose
index is genuinely complete **on disk** also reports `no_progress_signalled` or `cold_no_warm`, and
now records `null` instead of `true`, losing an attestation it deserved.

I named a follow-up — check whether clangd's index cache exists on disk, to separate *"nothing to
do"* from *"has not started"* — and deferred it as needing its own evidence.

⇒ **Building that discriminator before measuring how often the case occurs would be fixing a cost I
never sized.** This repo has a standing rule that a blocker expires with its measurement, and the
matching error is spending on a remedy whose problem was never quantified.

## The question, stated so it can come back either way

> On a repeat run against a workspace clangd has **already indexed**, does the server emit
> `$/progress` inside the settle window?

- **If it does**, the wait returns `index_drained` or `already_ready`. Those are PROVEN, map to
  `true`, and the attestation survives. The recall loss would then be confined to the narrow
  cold-start race already measured, and the discriminator is **not worth building**.
- **If it does not**, a warm, fully-indexed workspace lands on `no_progress_signalled` every time.
  The attestation would be lost on the common path, and the discriminator is **worth building**.

## ⛔ Abandon rule, fixed now

- **5 warm trials.** If the reason is not the same in at least 4 of 5, I report the distribution and
  conclude **nothing**. An inconsistent result is a third answer, not a weak version of either.
- ⛔ **A trial that fails to produce a working index at all is DISCARDED, not counted as silence.**
  A crashed clangd, a rejected compile DB, or a fixture with nothing to index all yield "no progress"
  for reasons that have nothing to do with the question. Each trial must show, independently, that
  the first (cold) pass really did index: it must report `index_drained` on the cold run before its
  warm run counts.
- **The cold run of each pair is the positive control**, and it runs in the same pass. Without it,
  "no progress on the warm run" cannot be distinguished from "this fixture never indexes".

## What each outcome CHANGES

| outcome | what I do |
|---|---|
| warm run signals progress (>= 4 of 5) | close the follow-up as measured-and-unnecessary; the recall loss is the cold-start race only |
| warm run is silent (>= 4 of 5) | the follow-up is justified; write it up as a real design task with this evidence |
| neither reaches 4 of 5 | report the distribution, conclude nothing, and leave the follow-up open |

## ⚠ Claim ceiling, before any number exists

One machine, one clangd, one synthetic C++ fixture. This can show what the server does **here**. It
cannot establish a rate for real repositories, and I will not report it as one. The decision it
licenses is only *"is the deferred follow-up worth my time"*, which is a decision about my own queue,
not a claim about the product.
