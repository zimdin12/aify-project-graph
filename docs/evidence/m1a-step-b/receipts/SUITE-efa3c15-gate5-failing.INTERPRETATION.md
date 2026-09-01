# Interpretation — `SUITE-efa3c15-gate5-failing.txt`

⚠ **POST-RUN INTERPRETATION, not process output.** Nothing here was produced by the run. It exists
so the raw capture beside it stays byte-identical to what the process emitted.

| binding | value |
|---|---|
| receipt | `SUITE-efa3c15-gate5-failing.txt` |
| SHA-256 | `fd0b453a4d3dca0e4984967d3d40f3975c3417f2396db316db6d080fb4e088c1` |
| subject commit | `efa3c15` |
| subject tree | `070c1d39ba10ae6dd903f04c3c838b2167213d1d` |
| disposition | **certifies a KNOWN-GATE-5-FAILING subject. NOT step-B acceptance.** |

If the hash does not match, this interpretation describes a different artifact and should be
distrusted rather than reconciled.

## What the run says

```
VITEST_EXIT=0
Test Files  418 passed (418)
Tests       3509 passed | 4 skipped (3513)
```

Zero failed tests. `VITEST_EXIT` and the summary line are the authority — **not** a count of lines
containing the token `FAIL`, which appears in passing test names.

## ⛔ What it does NOT say

**Step B is not accepted, and this receipt is not evidence that it should be.** At the moment this
suite ran, **gate 5 was failing in the product**:

```
LEXICAL  definition   qname alpha.Widget.render     label render
EXPLICIT definition   qname alpha.Widget::render    label Widget::render
```

The gate requires the two forms to yield the **same** qname. They do not. The suite was green
because the gate-5 *test* asserted "contains alpha" on one side and "at most one alpha" on the
other — it never compared them for equality. **A green suite over a test that cannot see the
defect certifies the subject, not the property.**

Three further predicates were also open at this commit: gate 7 had no test at all, gate 1 was two
qname examples rather than a population differential, and the preregistered sibling scope carrier
was unimplemented.

⇒ Correct status for this subject: **9 tests green; gate 5 FAILED.** Any product change after this
receipt requires fresh integration authority; this run cannot be cited for it.

## Why a sidecar

The raw capture is immutable. I had previously appended interpretation directly to a suite receipt,
which broke its byte identity even though the annotation was labelled — and then proposed doing it
again on this one, an hour later. The fix that stuck is mechanical, not remembered: raw capture
untouched, interpretation bound by hash.
