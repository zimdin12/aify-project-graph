# The readiness API written to stop `references` racing the index is not called by `references`

Surfaced by a full-suite failure I nearly dismissed as a flake. Recorded because the diagnosis is
solid and the fix is **not** made here — it is a product change to the live path and it needs its own
preregistered step with a measured effect, not a bolt-on to turn a red suite green.

## What failed, and why "flake" was the wrong word

`tests/integration/code-intel/live-verbs-real.test.js` — *"references at foo definition surfaces
bar.cpp call site"* — returned `not_found_after_retry` where it asserts `found`.

```
full-suite runs:  a5c2002f PASS   abf66356 FAIL   473143a2 FAIL     (2 of 3)
in isolation:     PASS, 5.7s
```

Two in three is not a flake. It also failed on `abf66356`, a **docs-only** commit, which is what
establishes it as independent of the surrounding work rather than caused by it.

## The mechanism

`code_intel_live.js` issues `references`, and on an empty result retries **once, after 60 ms**:

```js
let refs = (await session.client.references(uri, pos)) || [];
let resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
if (refs.length === 0) {
  await new Promise(r => setTimeout(r, 60));
  refs = (await session.client.references(uri, pos)) || [];
  resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
}
```

Under full-suite parallelism clangd's background index has not drained in 60 ms, so a symbol that
*does* have a caller comes back empty.

## The part that makes it a finding rather than a slow test

`lsp-client.js` already contains an API written for exactly this symptom, and its comment names it:

> **Code-Intel v2 FIX A: wait for clangd's background index to go idle before issuing reference
> queries, so cross-TU callers are visible (otherwise `references` races the index and returns
> `not_found_after_retry`).**

That is `waitForIndexReady({ timeoutMs, settleMs })`. Its callers:

| caller | calls `waitForIndexReady` |
|---|---|
| `providers/cpp-clangd.js:398` — the batch collector | ✅ |
| `verbs/code_intel_hierarchy.js:716` — but only when `mode === 'indexed'` | ✅ |
| **`verbs/code_intel_live.js` — serves `code_intel_references`** | ❌ |

The live path calls the *simpler* `waitForReady(timeoutMs)` instead, which resolves on the ready-waiter
set or times out. That one cannot handle the case `waitForIndexReady` was written for — *"index
already on disk → no `$/progress` ever fires"* — where `indexingState` never flips to `ready`, so
`navigationFreshness()` stays `unknown` and the wait expires without ever observing readiness.

⇒ **The remedy exists, documents the exact symptom, is used by two other paths, and the
highest-stakes path does not call it.** `code_intel_references` is the verb an agent uses to answer
*"who calls this"* before deleting code.

## What is NOT wrong, checked before claiming it

⚠ **The answer does not lie.** `result_state: 'not_found_after_retry'` is carried in the response,
`render.js` prints it, and `evidence.exhaustive` is `false` on this path by construction. The
always-loaded tool description already says *"code_intel_references returns empty when the index
could not answer"*. So this is **disclosed**, not a hidden fail-open — which is why it does not join
the fail-open class in `FINDING-the-fail-open-detector-could-not-see-its-own-class.md`.

⚠ **And bounded mode legitimately does not wait.** The cause table records the ruling: *"bounded mode
is not an incident; it never waits for the index BY DESIGN."* A path that never waits is a choice.

⇒ The defect is narrower and survives both: the caller **asked** to wait — the test passes
`waitForReadyMs: 15000` — and the honoured implementation is the one that cannot detect readiness in
the common case. Disclosure does not make an empty caller set useful to an agent who asked for a
complete one and paid 15 seconds for it.

## Not fixed here, deliberately

The change is "route `waitForReadyMs > 0` through `waitForIndexReady`". Before making it:

- **Preregister the effect.** The claim would be that the integration test becomes deterministic. That
  needs N runs under load, before and after, not one green suite.
- **Check the cost.** `waitForIndexReady` carries a `settleMs` grace window; it must not add latency
  to callers who passed `waitForReadyMs: 0`.
- **Check `codeIntelDefinitions` too** — same signature, same helper, same question.

## ⛔ RETRACTED 2026-09-04: the determinism claim above is wrong

Preregistering the change measured the two APIs against a real `LspClient` and found the opposite of
what this document assumed:

```
waitForReady(1200)        -> "unknown"                                        in 1209 ms
waitForIndexReady({1200}) -> { ready: true, reason: 'no_progress_signalled' } in  248 ms
```

- The current path returns `'unknown'`, and **every strong-evidence branch is gated on
  `freshness === 'fresh'`** — so it already fails CLOSED. The cost is latency and recall, not safety.
- Routing through `waitForIndexReady` would therefore be a **claim-STRENGTHENING** change, unlocking
  seven evidence branches, and its winning path (`no_progress_signalled`) infers readiness from the
  ABSENCE of a signal.
- **And it would not make this test deterministic anyway.** The test needs clangd to resolve the
  reference; returning sooner with the same `'unknown'` freshness does not help.

⇒ See `PREREGISTERED-routing-waitForReadyMs-through-waitForIndexReady.md`. The recommendation is now
to take the latency half and refuse the claim half. The paragraph below still stands.

⛔ **Do not weaken the test to go green.** Its assertion — `result_state` must be exactly `found` —
was deliberately tightened, and it is the assertion that would catch a real regression in caller
discovery. The honest repair strengthens the wait, not the expectation.
