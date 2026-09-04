# Preregistered: should `waitForReadyMs` route through `waitForIndexReady`?

**Written before the edit. The measurement changed the recommendation, and the change I set out to
make is now the half I am arguing against.**

## What I expected to find

`FINDING-live-references-does-not-call-the-remedy-written-for-it.md` established that
`code_intel_live.js` calls the simpler `waitForReady`, while `waitForIndexReady` — whose own comment
says it exists so *"`references` [does not] race the index and return `not_found_after_retry`"* — is
called only by the batch collector and by `code_intel_hierarchy` in indexed mode. The obvious repair
was to route `waitForReadyMs > 0` through it and make the flaky integration test deterministic.

## What the two APIs actually do, measured

The `LspClient` constructor spawns nothing, so the real state machine can be driven into the state
under test without clangd. **A hand-written stub would have tested the stub**, and what is in question
is exactly what the real object does.

The state: clangd found an index already on disk, so no `$/progress` ever fires. `indexingState`
stays `'unknown'` while files ARE warmed.

```
navigationFreshness()                  : unknown
waitForReady(1200)        -> "unknown"                                        in 1209 ms
waitForIndexReady({1200}) -> { ready: true, reason: 'no_progress_signalled' } in  248 ms
[LATENCY CONTROL] waitForReady(0) -> "unknown"                                in    0 ms
```

⇒ A caller passing `waitForReadyMs: 15000` — which the integration test does — **waits fifteen
seconds and learns nothing.**

## ⛔ And the finding inverts: the current behaviour fails CLOSED

`freshness` is load-bearing across the whole evidence contract. Every strong branch is gated on
`freshness === 'fresh'` (lines 153, 243, 257, 298, 321, 411, 444), and `'unknown'` is treated as
low-information at 364.

So in the on-disk-index case the live path returns `'unknown'` and **every strong-evidence branch is
already skipped**. The current code is conservative, not fail-open. What it costs is **latency and
recall**, not safety — the opposite direction from every other defect in this arc.

⇒ **Routing through `waitForIndexReady` would be a claim-STRENGTHENING change on the trust surface.**
It would turn `'unknown'` into `'fresh'` and unlock seven evidence branches at once.

## ⛔ And it would rest on absence-as-evidence

`waitForIndexReady`'s winning path is `no_progress_signalled`: it concludes **ready** from the fact
that *no indexing signal arrived* within `settleMs`. That is an inference from an absence, in a
codebase whose entire thesis is that an absence is not evidence — the same shape as
`index_population_unattested`, which this project treats as a permanent epistemic limit.

⚠ It may well be correct in practice. But it is exactly the kind of inference this arc has spent
itself refusing to make silently, and adopting it to unlock the strongest evidence branches is not a
plumbing fix.

## ⇒ Recommendation: split it, take the free half, refuse the other

1. **TAKE — the latency half.** Stop waiting the full budget to learn nothing. If `waitForIndexReady`
   reports `no_progress_signalled`, return early **without upgrading the freshness value**. The
   evidence contract sees the identical `'unknown'` it sees today, and a caller stops paying 15
   seconds for it. Behaviour-preserving on every claim; strictly better on latency.
2. **REFUSE, for now — the claim half.** Do not map `no_progress_signalled` to `'fresh'`. That
   deserves its own argument and its own evidence about whether an on-disk index really is queryable,
   and it should be a named freshness value if it lands at all, not a merge into `'fresh'`.

⚠ **And it does NOT fix the integration test.** The test asserts `result_state === 'found'`, which
needs clangd to actually resolve the reference; returning sooner with the same `'unknown'` freshness
changes nothing there. **The determinism claim in the earlier finding was wrong**, and this note
retracts it rather than leaving it to be discovered.

## Preregistered gates for whichever half is implemented

- **LATENCY CONTROL** — a caller passing `waitForReadyMs: 0` must gain no wait. Measured today at
  **0 ms**; it must stay 0.
- **CONTRACT CONTROL** — the freshness value returned in the on-disk-index state must be unchanged
  (`'unknown'`) unless the claim half is separately argued and accepted.
- **SIBLING** — `codeIntelDefinitions` takes the same `waitForReadyMs` and reaches the same helper.
  Either it changes with `codeIntelReferences` or the note says why not.
- **ABANDON RULE** — if the early return cannot be made without also changing the freshness value,
  stop and bring the claim half up explicitly. Do not let a latency optimisation smuggle in a trust
  upgrade.

⛔ **Claim ceiling.** Everything above is about *when we stop waiting*, not about whether clangd's
answer is right. None of it can make a cold index warm, and none of it addresses the
`not_found_after_retry` failure that started this thread.
