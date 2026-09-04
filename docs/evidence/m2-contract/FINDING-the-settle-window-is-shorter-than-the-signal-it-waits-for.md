# The settle window is shorter than the signal it waits for

`waitForIndexReady` declares an index **ready** when no `$/progress begin` has arrived within
`settleMs` (default **1500 ms**). Measured against a real clangd, clangd's first `begin` arrives
later than that on a substantial fraction of cold starts.

## Measured — five cold starts, real clangd, 24-file C++ fixture

```
first `$/progress begin` after didOpen (ms) : [744, 1041, 937, 1525, 2125]
signalled                                   : 5 of 5
WORST observed                              : 2125 ms   vs a 1500 ms settle window
```

**Two of five exceeded the window.** The channel itself is healthy — 5 of 5 signalled — so this is
not our deafness; it is a window too short to contain a signal that does arrive.

## Why it matters: the flag reaches the banner that licenses deletion

Verified end to end rather than assumed:

| step | site |
|---|---|
| readiness flag taken from the boolean | `providers/cpp-clangd.js:399` — `indexReady = !!r.ready` |
| its own comment states the stakes | `cpp-clangd.js:880` — *"only trustworthy-as-exhaustive when indexReady===true"* |
| persisted onto the collection | `importer.js:1259` — `index_ready: indexReady ? 1 : 0` |
| gates the attestation | `lsp-evidence.js` — `collection.indexReady === true && allVerified` |

⇒ On a cold start where clangd announces late, the collector waits 1500 ms, is told **ready**,
collects references against an index that has not started, stamps `index_ready = 1`, and the graph
later emits `TRUST: lsp-verified (clangd, index-ready, N callers …)` — the wording the
server-instructions say licenses *"safe to delete"* — over a caller set that is a floor.

`code_intel_hierarchy.js:716` consumes the same flag in indexed mode.

## The shape, and it is this arc's own class in a new place

`waitForIndexReady` returns a **boolean** `ready` covering two different facts:

- `index_drained` — indexing was observed to start and finish. **Proven.**
- `no_progress_signalled` — nothing was heard within the window. **Inferred**, and the inference is
  only sound if the window outlasts the signal. It does not.

Same collapse the arc has fixed four times: one value carrying a proven state and an inferred one,
with the caller unable to tell them apart. What is new is the **mechanism** — a timing window, shown
wrong by a latency distribution rather than by a state argument — and it is demonstrated, not latent.

## ⭐ Refusing the claim half protected me from a bug I had not found

The readiness **latency** fix routes `awaitFreshness` through `waitForIndexReady` and then returns
`navigationFreshness()`, discarding `ready` entirely. On a late-announcing cold start that yields
`'cold'` or `'unknown'` — never `'fresh'`.

⇒ **Had I mapped `no_progress_signalled` → `'fresh'`, as I was arguing with myself about, this bug
would have granted the exhaustive banner on a cold index in roughly 40% of cold starts.** The
contract test that pins the value unchanged was written to stop a trust upgrade smuggling in; it also
stopped one I did not know was there.

⚠ That is an argument for the refusal, **not** for refusing on principle. ef-manager's framing was
right: this was a measurement question, and running it is what produced the finding.

## How this was found — the reviewer named the experiment

ef-manager set two conditions for adopting the claim half: **(a)** a positive control that progress
notifications actually arrive through this path, and **(b)** worst observed
request→first-progress delay versus the window. (a) passes, (b) fails, and they predicted that
outcome as *"a real bug in the fast path, which is a better outcome than either."*

⚠ **And I corrected their number while running it.** They wrote *"if it has ever exceeded 248 ms"* —
248 ms was my earlier probe's return time with `settleMs: 200`. Production keeps the 1500 ms default,
so the comparison is against 1500 ms. The finding survives the correction with less margin than their
figure implied.

## ⛔ Claim ceiling

- **Five runs, one machine, one fixture.** Enough to show the window is exceeded — 2 of 5 is not a
  fluke — and **not** enough to choose a replacement constant. Any fix that just raises `settleMs`
  would be tuning a magic number against this sample.
- The delays were measured **unloaded**. This machine demonstrably slows under full-suite
  parallelism, so 2125 ms is a floor on the worst case, not a ceiling.
- The end-to-end chain is verified by reading the four sites above; I have **not** reproduced a false
  `lsp-verified` banner from a genuinely cold collection end to end. The mechanism is demonstrated;
  the whole-pipeline consequence is argued from those four sites.

---

## ✅ RESOLVED — `c25fa7a8` · `05e6464b` · `b9e61d4c` (suite green, `4e5f5f29`)

**The constant was not changed, and the claim ceiling above is why.** Five runs on one machine can
show a 1500 ms window is exceeded; they cannot choose a replacement number. Tuning `settleMs` against
this sample would have been picking a magic constant from n=5 and calling it a fix.

What changed instead is the **state model**, which needed no sample size:

| `waitForIndexReady` reason | before | after |
|---|---|---|
| `index_drained` / `already_ready` / `ready_no_index_needed` | `true` | `true` — observed |
| `ready:false` (timeout, cold, error) | `false` | `false` — established |
| `no_progress_signalled` | **`true`** | **`null`** — unknown |
| any unrecognised reason | `true` | `null` — fails closed |

`mcp/stdio/code-intel/index-readiness.js` owns the mapping; `cpp-clangd.js:403` and
`code_intel_hierarchy.js:723` both call it instead of `!!r.ready`. Nothing downstream needed
changing: `importer.js` already persisted `null` as SQL NULL, and every consumer gate is `=== true`,
so the delete-licensing banner fails closed on the unknown.

### ⭐ The wiring alone would have MOVED the error, not removed it

Routing `null` into the existing fall-through gave it `cause: 'cold_index'`, whose remedy reads
*"raise `APG_CLANGD_INDEX_WAIT_MS` / `waitForReadyMs` and re-run"*. For `no_progress_signalled` the
wait returned **early — on the settle window, nowhere near its timeout**. That remedy cannot work,
ever.

⇒ This is a demonstrated instance of the class ef-manager named: *a remedy that cannot address the
actual fault is worse than no remedy, because it spends the agent's next action on a guaranteed
miss.* So `false` and `null` now carry different causes and different remedies —
`index_readiness_unknown` names the settle window, and the banner stops asserting *"index NOT
ready"*, which is a statement about clangd nobody observed. `false` keeps `cold_index` and the
timeout knob, held by a test in that direction so a real negative is not softened away.

The new cause is classified `NOT_A_DEGRADATION`, matching the `operationallyDegraded: false` it
travels with; the `transient` default would have pinned the session degraded on every cold start.

### ⚠ What this COSTS, stated rather than buried

A genuinely on-disk index also reports `no_progress_signalled`, and now records `null` instead of
`true` — losing an attestation it deserved. The trade was taken deliberately: the flag licenses
deletion, and an unknown must not license deletion.

**Named follow-up, not attempted here:** the discriminator that would recover that recall is whether
clangd's index cache exists on disk for the project. That separates "nothing to do" from "has not
started", which nothing inside the window can. It is a real design question, not a tuning knob, and
it needs its own evidence.

### Still true, still not measured

The 2125 ms worst case was observed **unloaded**, on one machine, one fixture. It is a floor on the
worst case, not a ceiling. The fix above does not depend on that number — which is the point of
fixing the state model rather than the constant.
