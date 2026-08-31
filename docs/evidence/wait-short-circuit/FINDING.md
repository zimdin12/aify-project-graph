# The `waitForReadyMs` "waste" is not waste — measured, then reverted

**Status: proposal REJECTED by its own experiment. No code change shipped.**

## What was proposed

A field agent paid **26,627 ms** on `waitForReadyMs: 25000` in a repo with no
`compile_commands.json`, and got back `ready:false, cause:"unknown"` — while the SAME response
already carried "no compile_commands.json — clangd has no index". It called this the single
biggest waste in its run, and it was right that the readiness FLAG could not arrive. I
proposed short-circuiting the wait when no compile DB is present. Review ranked it first: a
measured adverse cost, a known prerequisite, narrow and falsifiable.

## Measurement 1 — the premise looked confirmed

Same corpus bytes, same 8s budget, only the compile DB differing:

| compile DB | ready | elapsed | refs |
|---|---|---|---|
| absent  | false | 9,811 ms | 1 |
| present | true  | 6,089 ms | 1 |

Readiness genuinely cannot arrive without a DB, and the wait does real work when one exists.
I wrote in the implementation comment: *"the wait never affected the result, only the
attestation."*

## ⛔ Measurement 2 — that sentence was false, and only `refs` caught it

With the short-circuit in place:

| run | elapsed | refs |
|---|---|---|
| 1 | 4,020 ms | **0** |
| 2 | 2,826 ms | **0** |
| 3 | 2,143 ms | **1** |

The wait was not buying an attestation. It was buying **determinism**. Removing it makes the
reference resolution a race: the same query on the same bytes returns a caller sometimes and
no caller other times.

For a tool whose value is trustworthy answers, ~6 seconds for a non-deterministic caller set
is a catastrophic trade — and the failure direction is the dangerous one, because an
intermittent `refs=0` is exactly the false absence this product exists to prevent.

## Why measurement 1 did not catch it

Both arms in measurement 1 **had waited**. Comparing "DB vs no DB" holds the wait constant, so
it can say whether readiness arrives — and says nothing about what the wait does for the
answer. The comparison that mattered was "wait vs no wait", which I only ran after
implementing, and only noticed because I compared `refs` rather than the timing I was
optimising.

## What is actually true

- the readiness FLAG is unreachable without a compile DB — confirmed
- the WAIT is still load-bearing without one — clangd needs the time to resolve, even though
  it never declares itself ready
- the agent's report was accurate about the flag and its cost, and its conclusion that the
  wait was therefore waste does not follow

## What would be a real fix

Not this. Possibly: keep waiting, but report the honest cause (`no_compile_db`) instead of
`unknown`, so the 26 s at least buys an accurate explanation. Possibly: a lower cap when no DB
exists — but that needs a measured floor for determinism, and this experiment shows the floor
is not zero. Neither is shippable without that measurement.
