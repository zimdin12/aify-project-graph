# Result: the recall loss I accepted does not occur on the common path

Answers `PREREGISTERED-is-the-readiness-recall-loss-real.md`. The abandon rule and the control were
fixed before this ran, in `808527e8`.

## Measured

Five paired trials. Each pair runs twice against **one** workspace, so clangd's index cache survives
between passes. The cold pass is the positive control and runs in the same pass as the measurement.

```
trial 1: cold=index_drained   warm=index_drained   warm.ready=true
trial 2: cold=index_drained   warm=index_drained   warm.ready=true
trial 3: cold=index_drained   warm=index_drained   warm.ready=true
trial 4: cold=index_drained   warm=index_drained   warm.ready=true
trial 5: cold=index_drained   warm=index_drained   warm.ready=true

usable (cold pass genuinely indexed) : 5 of 5
warm-pass reasons                    : { index_drained: 5 }
```

**5 of 5, cleanly past the 4-of-5 bar.** The positive control held in every trial, so "warm was
silent" was a result the design could have returned and did not.

## ⇒ The follow-up is CLOSED as measured-and-unnecessary

A warm, already-indexed workspace still emits `$/progress` and drains, so `waitForIndexReady` returns
`index_drained`. That is one of the PROVEN reasons, maps to `true`, and the `lsp-verified …
index-ready` attestation survives untouched.

⇒ **The disk-cache discriminator is not worth building.** The case it was designed to rescue —
a complete on-disk index reported as unknown — does not arise here, because clangd announces indexing
work on a fresh session even when its cache is warm.

## What this does to the three-state change

It strengthens it. I accepted a recall cost when `index_ready` became three-state, and the honest
position was that I could not size it. Sized, it is smaller than I feared: `no_progress_signalled`
and `cold_no_warm` are reached only in the narrow cold-start race already measured
(first `$/progress begin` at 1525 and 2125 ms against a 1500 ms window), not on every warm run.

So the fix trades a **rare** false attestation for a **rare** withheld one, rather than trading a
rare false positive for a common false negative. That was the open question and it now has a number.

## ⛔ Claim ceiling, unchanged from the preregistration

One machine, one clangd (`C:/Program Files/LLVM/bin/clangd.exe`), one synthetic 24-file C++ fixture.
This licenses a decision about **my own queue** — whether to spend time on the discriminator — and
nothing about real repositories. In particular it does **not** establish how often
`no_progress_signalled` occurs in the field, and I am not claiming it does.

⚠ It also does not test the case the discriminator was originally imagined for: a workspace where
clangd has genuinely **nothing** to index. That case may still exist; what this shows is that a
normal warm repeat is not it.
