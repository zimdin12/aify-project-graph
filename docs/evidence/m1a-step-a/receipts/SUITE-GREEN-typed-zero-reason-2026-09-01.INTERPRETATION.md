# How to read `SUITE-GREEN-typed-zero-reason-2026-09-01.txt`

⚠ **This file is POST-RUN INTERPRETATION, not process output.** Nothing here was produced by the
run. It exists so the receipt beside it can stay byte-identical to what the process emitted.

**Binds to:** `SUITE-GREEN-typed-zero-reason-2026-09-01.txt`
**SHA-256:** `ead5c9d9947379e236c98b51e1ba996ee7cc94a37efbe1edd2af03618f9803b1`

If that hash does not match the receipt, this interpretation is describing a different artifact and
should be distrusted rather than reconciled.

## What the receipt establishes

```
VITEST_EXIT=0
Test Files  417 passed (417)
Tests       3500 passed | 4 skipped (3504)
```

**Zero failed tests.** `VITEST_EXIT` and the summary line are the authority.

## ⚠ One way to misread it, which I did

The receipt contains **2 lines carrying the token `FAIL`, both inside PASSING test names**:

```
✓ the hook log survives an early failure > a failing refresh still writes its FAILED line…
✓ the fragment-external count can say that it failed > ⛔ a read that FAILS says NOT MEASURED…
```

**Counting lines that contain `FAIL` is not a failure count.** I first described this run as having
"zero FAIL lines", which is a looser claim than the evidence supports — the anchored count
(`^ FAIL `) is 0, and *that* was what I actually measured. The claim and the measurement had drifted
apart, which is the same wrong-noun failure recorded throughout this evidence directory.

## Why this is a sidecar and not an appended note

I originally appended this text to the receipt itself. That **changed the captured carrier after
execution** and broke its byte identity, even though the addition was clearly labelled as
annotation. A receipt whose bytes can move is not a receipt. Review caught it; the file was restored
to its exact `07343ef` bytes, verified by hash, and the interpretation moved here.
