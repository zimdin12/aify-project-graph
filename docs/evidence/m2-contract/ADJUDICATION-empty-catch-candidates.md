# Adjudication ledger — the trust-bearing empty-catch candidates

`node scripts/hazard-inventory.mjs` prints **36 of 69** empty-catch candidates whose enclosing
function emits a trust-bearing output. This is the ledger of what each one turned out to be. It is
the sweep's actual deliverable: a count is not a finding, and neither is a fix list.

## The grading rule, and why a count alone is not one

Two axes, because reachability alone systematically under-weights the worst instances — they sit on
hard-to-reach paths *precisely because* they are unusual.

| axis | values |
|---|---|
| **reachability** | `demonstrated` (one input that throws) · `latent` (no route found) · `unreachable` (a PATH ARGUMENT, never a probe count) |
| **grant** | what the fallback value licenses if the catch fires |

⛔ **A probe count never promotes anything.** Nine failed attempts to construct a throw is evidence
about the attempts. Demonstrating reachability is cheap and conclusive; demonstrating
*un*reachability needs an argument from the code path, of the shape *"`parseDb` swallows a malformed
DB to `null` internally, therefore nothing propagates."*

⚠ **And a verdict does not transfer between functions.** I nearly carried a `computeCoverage` result
onto `computeCompileDbCoverage` — a different function with different reachability. Re-probed the
right one directly.

## Verdicts

| site | keeps | reachability | grant | verdict |
|---|---|---|---|---|
| `lsp-evidence.js:655` `stale` | currency | **demonstrated** | the `lsp-verified` delete banner | ⛔ **FIXED** `2e62618f` → tri-state |
| `lsp-evidence.js` compile-DB cause | `stale` | **demonstrated** | a FALSE sentence: *"HEAD has moved"* when it had not | ⛔ **FIXED** `473143a2` → cause carried |
| `server.js:722` staleness warning | `stalenessWarning` | **demonstrated** | silence about drift on **every** string-returning verb | ⛔ **FIXED** `93c4283a` → `graphCurrency()` |
| `preflight.js:176` | `coverageComplete` | latent (0 of 12 threw) | would assert coverage complete, feeds `absenceAuthority` | **not a defect** — and separately *argued* |
| `change_plan.js:279` | `coverageComplete` | latent (same function, same call shape) | same | **not a defect** |
| `lsp-evidence.js:607` | `coverageIncomplete` | latent (0 of 9 threw) | would assert coverage complete | **not a defect** |
| `health.js:543` | `authority`, … | — | `null` is unknown, **fails closed** | ✅ **correct as written** |
| `lsp-evidence.js:223` | `cpp` | — | `null`, unknown stays unknown | ✅ correct |
| `lsp-evidence.js:558` | `collection` | — | `null`, falls back to a weaker generic line | ✅ correct |
| `code_intel_live.js:842` | `defLocations` | **demonstrated** | overcounts callers — the SAFE direction | ⚠ see below |

### The two `coverageComplete` sites are argued, not accidental

`let coverageComplete = true` looks exactly like the defects above, and is not one. Its comment
argues the default: *"a DB absent at query time must not flip SAFE→REVIEW (the edges were ground
truth at collection time)."* That reasoning is **correct for an absent DB** and silent about a
**thrown** one — the catch conflates them, which is the collapsed-state shape again. But with no
demonstrated route into the catch, there is a hazard with a name and no defect to report.

⇒ Recorded, not patched. Fixing a latent hazard adds a branch nothing can exercise, and *"a test
nobody has watched fail is a rumour."*

### `code_intel_live.js:842` — reachable, and it does not matter

The first candidate where **reachability is high and the grant is low**, which is the case two-axis
grading exists for.

- **Route demonstrated:** `lsp-client.js:595` rejects with *"LSP request '…' timed out"*. Not
  hypothetical — clangd demonstrably goes slow under load on this machine (2 of 4 full-suite runs).
- **What the fallback grants:** `defLocations = []` → `split.definitionLocations` is empty by
  construction (references are requested with `includeDeclaration=false`) → `definitionLocations: []`
  and `definitionSource: 'none'`. The declaration then cannot be split out of the reference set, so
  the caller count errs **high**.

An overcount is the safe direction for the decision this verb feeds: an agent sees more callers than
exist and does *not* delete. So a reachable fail-open here is not a safety defect.

⚠ **One honest gap worth an eventual line, not a fix:** `definitionSource: 'none'` is emitted both
when no definition exists and when the request **failed**. Those are different facts wearing one
label — the same conflation this ledger keeps finding, at low stakes.

## What this sweep did NOT close

⛔ **26 of the 36 are not yet adjudicated.** The stopping rule is *adjudicate every trust-bearing
candidate; stop when that set is empty*, and that set is not empty. This ledger is partial and says
so rather than implying the class is closed.

⛔ **The recall audit still scores 4 of 5, and the miss is a shape.** The gitignore-negation defect
is a wrong **filter**, not a swallowed error, so no catch-shaped detector can see it. **That hole is
the exact shape a clean sweep will keep missing**, and a clean run by someone who does not know it
reads as coverage.
