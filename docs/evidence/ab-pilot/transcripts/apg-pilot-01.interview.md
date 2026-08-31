# apg-pilot-01 — interview (asked only AFTER the task answer, so it could not steer routing)

## Confidence
"The answer is right and I'll stake it." Two instruments on different substrates agreed,
and grep proved in the same run it could return both PRESENT and ABSENT.

## ⭐ The process was oversized for the target, and it says so
> "src/weights.cpp is 7 lines. The repo is 7 files. One `grep -rn computeWeight src/`
> produces the identical answer in under a second, and every other call I made added zero
> bits to the decision. ... nothing in the loop scales it down to the size of the target."

And it volunteered the confound before we did:
> "this was a corpus repo. Nothing here demonstrates the loop is well-calibrated on a real
> codebase. It demonstrates it is oversized for a small one."

## ⛔ WHAT WAS POINTLESS — measured, not impressionistic

1. **The 25s readiness wait, and OUR SKILL told it to pay.** `waitForReadyMs: 25000` cost
   **26,627 ms** (the tool's own `latencyMs`) and returned `ready:false`, `cause:"unknown"`.
   There is no compile_commands.json in the corpus — **the server emitted exactly that
   warning in the same response**. Readiness was structurally unreachable before the wait
   began. Single biggest waste in the run.

2. **graph_health is pure tax on a non-empty who-calls.** ~120 lines of JSON; it used two
   booleans and one commit comparison. storage, overlayQuality, taskSchemaLint, dirtySeams,
   artifactAges, the whole trustBasis breakdown — none touched the decision. And the two
   booleans it did use "only constrain ABSENCE claims, which is not the branch I ended up on."

3. **The exhaustiveness caveat, stated three times** (tool description, skill, evidence
   object). Its point is the dangerous one:
   > "The real hazard is desensitisation: I read the identical withheld-exhaustive block
   > whether or not it bears on the decision, which trains me to skim it in the one case
   > where it decides everything."

4. Reading manifest.json for one field graph_health already had.

5. **"The graph layer contributed nothing to the answer."** 29 nodes,
   compilerVerifiedEdges 0; the answer came from clangd plus grep.

## What it would change

- **Short-circuit the wait**: no compile DB → return immediately with the warning rather
  than burning waitForReadyMs on readiness that cannot arrive. Cap the parameter at what is
  achievable and say so.
- **Make the evidence block conditional on result shape.** Non-empty → "these locations are
  compiler-resolved, do not re-grep them." Empty → the full exhaustiveness paragraph, where
  it actually decides something. "Same words in both cases is how a critical warning becomes
  wallpaper."
- **Report LINKAGE on the reference result.** The fact that mattered most in its answer —
  that pipeline.cpp forward-declares the symbol, so deletion fails at LINK time — it got by
  catting the file. `code_intel_references` saw the extern declaration and did not mention it.
- **graph_health needs a one-question mode**, or should leave step 1 of the skill.
- **Biggest win: one verb that runs the compiler query and the controlled text search
  together.** "Ceremony that is always identical should be code, not prose I re-execute."

## Cost, with sources named
- `code_intel_references`: **26,627 ms**, warmedFiles 7 — the tool's own telemetry, measured.
- Everything else sub-second "by feel. Not instrumented. Treat as unmeasured."
- Tokens ≈ **68k** total: ~37k session preamble before it ran anything, ~31k investigation
  and reply. Largest single item inside the preamble was the **deferred tool index** —
  "several hundred tool names, mostly Asana/ClickUp/GitLab/Playwright surface with no bearing
  on a C++ delete question." Counter deltas, not a purpose-built instrument.
