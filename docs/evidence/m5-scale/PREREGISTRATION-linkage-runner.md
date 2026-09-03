# PREREGISTRATION — the linkage-scope runner. Written before the runner exists.

⚠ **BUILDING costs no agent budget. RUNNING costs 72 agent runs and is Steven's call.** This file
covers the wiring only; nothing here authorises a run.

## What already exists, and is NOT being redesigned

`tests/fixtures/linkage-scope/` is a FROZEN, preregistered experiment:
`ground-truth.json` (6 classes: symbol, files, question, truth, `cheapestAuthoritativeRoute`,
`graphShouldWin`, `unsafeAnswer`, tier), `prompts.json` (exact agent-facing text + a leak rule),
`corpus/` (7 C++ files), and `scripts/lib/ab-rubric.mjs` (blind, three-valued endpoint).

⛔ Its own `freezeRule` forbids redesigning toward the test. **The runner reads these files and
changes none of them.** Any change to the key or prompts is a NEW version with a new preregistration.

## What the runner must do

1. **PREFLIGHT the fixture before spending anything** — see controls below. A leaked prompt or a
   drifted key invalidates a 72-run experiment, and that must be caught before run 1, not after.
2. Materialise `corpus/` into a scratch repo per class; index it for the graph arm only.
3. Ask the class's EXACT prompt text — never a paraphrase, never an added hint.
4. Capture transcript + tool calls per run.
5. Score with `scoreTranscript({ groundTruthClass, transcript, toolCalls })` — the existing rubric,
   unmodified.
6. Report **per tier, per class, per runtime**, and NEVER average tier A with tier B, per the key's
   own `analysisRule`.

## Preregistered controls, required before any arm runs

- **LEAK CONTROL:** no prompt may contain any of the 19 `forbiddenInPrompts` words. Measured
  2026-09-02: **0 violations**, with a positive control (the matcher finds `call`, which IS present)
  and a negative control (`clangd` is genuinely absent). If this fails, the routing measurement is
  destroyed and the run must not start.
- **KEY INTEGRITY:** the 6 class ids and their `tier`/`graphShouldWin` values must match what this
  file records. A silently edited key turns a frozen experiment into a fitted one.
- **CORPUS PRESENCE:** every path in every class's `files` must exist. A missing corpus file makes
  its class unrunnable, and an unrunnable class must be REPORTED, never skipped quietly.
- **RUBRIC LIVENESS:** a known-unsafe transcript must score `unsafeAuthoritativeConclusion === true`
  and a known-refusal must not. A rubric that cannot fire is the vacuous pass this project has
  produced before.

## Claim ceiling — what a green runner does NOT mean

Wiring proves the harness can carry the experiment. It proves **nothing about the product**. No
number this runner emits before a real run means anything, and a mock-transcript pass is a test of
the plumbing only. That distinction is exactly the one `tiers.A` already insists on: *"Success here
is NOT evidence of field value and must never be reported as such."*

## Abandon rule

If the wiring cannot drive the frozen rubric without modifying the key, prompts, or rubric, **stop
and report that** rather than adjusting the fixture to fit the runner. The fixture is the
experiment; the runner is disposable.

---

## AMENDMENT 1 — 2026-09-03, before any real run

⛔ **APPENDED, NOT EDITED.** Everything above is what was written before the runner existed, including
the "72 agent runs" figure, now superseded. A preregistration whose text is revised to match later
choices proves nothing; the value is that the original is still legible beside the change.

Both changes below are fixed **before any real executor has run**, so no result exists that could
have shaped them.

### A. Repeats dropped — 72 runs → 24 (Steven's call)

`4 repos × 3 tasks × 2 arms × 1 = 24`. Free in code (`--repeats` already defaulted to 1) but NOT free
in what may be claimed:

- Repeats existed to separate a real difference from run-to-run variance. Agents are
  non-deterministic. **At one run per cell, no per-cell delta is signal**, and no report may present
  one as a result.
- The analysis unit becomes the **paired repo×task cell**. The reportable form is
  "the graph arm avoided harm in N of M cells", within a tier and a runtime.

### B. The arms are `graph` and `nograph`, not `graph` and `grep` (Steven's correction)

Both arms are the same agent with the same tools on the same sources — **grep included in both**. The
single treatment is whether the graph is present. The old name framed the result as
graph-versus-grep, a claim the project's purpose statement explicitly disclaims. The implementation
was always correct; the name was not.

### C. The paired analysis, preregistered here because it did not exist above

`buildPairedReport` was added on 2026-09-03, after this document was first written. Its rules are
fixed now, before results:

1. **Per tier AND per runtime, never pooled.** A single "N of 12" would average synthetic with real
   AND pool Hermes with Claude Code — both forbidden by the key's own `analysisRule`. It is also the
   number a reader most wants to quote, which is why the split is asserted by test.
2. **Both directions counted.** `nographAvoidedHarm` is reported alongside `graphAvoidedHarm`. A
   one-directional counter can only find good news.
3. **Unpairable cells are counted and NAMED**, never dropped. A missing arm shrinks the denominator
   invisibly, in the direction that flatters the remaining pairs.
4. **TWO AXES, NEVER ADDED.**
   - **HARM** — an unsafe authoritative conclusion. The expensive failure.
   - **DECISIVENESS** — a clean refusal (`false`) versus `ambiguous`, which the rubric calls "a
     routing decision to a human, never a pass".
   Turning an ambiguous answer into a refusal is a real improvement and **is not a safety
   improvement**. The first version of this code collapsed the two and named the result "safer";
   that flattened the rubric's deliberately three-valued endpoint and claimed more than it measured.

### What is still NOT authorised by this amendment

A run. Nothing here changes the fact that no real executor ships, and that pointing `--executor` at
an agent adapter is a separate deliberate act requiring Steven's budget decision.
