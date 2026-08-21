# D1 — INVALID_EXPECTATION_MISMATCH

Immutable artifacts from the single authorized run. **Do not edit. Not rerun.**

| field | value |
|---|---|
| preregistration | `tests/self-review/preregistrations/D1.json` |
| authorized commit / tree | `85a6552` / `6b9eeb2` |
| referee | graph-senior-dev, approval `1787272365062-9e935e40` |
| run id | `64f11cb2-3c57-4b28-89ae-976c36987cbe` |
| verdict | **INVALID — case carries 2 failure messages; exactly 1 is accountable** |

## What the run actually produced

    baseline exit    0
    mutant exit      1
    anchor offset    3145        (matches the preregistered index)
    target restored  byte-identical
    cases 10 · failedCases 1 · nonCaseErrors 0

    FAILING CASE  ★★ a SECOND same-key call joins the in-flight start, it is not told a lie
      MSG 1  exactly one start may occur per key: expected [ …(2) ] to have a length of 1 but got 2
      MSG 2  EBUSY: resource busy or locked, unlink '…\apg-dashroot-…\.aify-graph\graph.sqlite'

## ✓ What I predicted correctly

- `:231` in-flight-during-shutdown **stayed GREEN** — the generation check at `dashboard.js:78-82`
  does defend that route independently, so the pending marker is not load-bearing there.
- **Exactly one case failed.** `expectFailures: 1` reconciled.
- The mutation landed at the preregistered offset and the target restored byte-identical.

## ⛔ What I got wrong, and why

**The predicate named the wrong assertion.** I predicted
`and it must be the SAME dashboard, not a second one` — the URL-equality assertion. It **passed**.

My model assumed a rival second start would produce a DIFFERENT url. It does not: two starts
occurred (`started` has length 2) and **both callers still received the same url**, because the
fixture's start mock does not vary the url per start. So the URL assertion could not discriminate,
and the failure landed one line later on the start-COUNT assertion.

⇒ **I asserted a discriminator without checking that the fixture makes it discriminate.** The bug
IS present and the case DOES catch it — but not through the door I named.

**And my `downstreamAssertionsUnexecuted` note was void here.** I recorded that
`started.toHaveLength(1)` would be unexecuted because it sits after the predicted throw. There was
no throw before it, so it executed and became the accountable message. The reasoning was sound; its
premise was the thing I had wrong.

## ⚠ A second, independent problem the run exposed

`MSG 2` is an **EBUSY unlink failure during fixture teardown** — a Windows file lock on
`graph.sqlite`. It attaches to the same case and is why the verdict is INVALID rather than a
predicate mismatch alone: even had my predicate matched MSG 1, two messages would still have failed
the one-accountable-message rule.

That is an apparatus/environment defect, not a property of the guarantee, and it will invalidate any
arm on this test file on this platform until it is fixed.

## Ledger

D1 remains **`v3_runnable_unwitnessed`**. No promotion. Not rerun under this preregistration.
