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

## Second batch — and a third kind of grant

| site | keeps | reachability | grant | verdict |
|---|---|---|---|---|
| `read_freshness.js:424` | `alreadyIndexedFiles`, `attestation` | — | defaults to `LEGACY_UNATTESTED`, the **weakest** attestation | ✅ **correct** — fails closed |
| `callers.js:155` | `confidenceFooter` | latent (`loadManifest` 0 of 3) | the confidence footer would go missing | not a defect |
| `callees.js:225` | `boundaryBlock` | latent (`readSymbolBody` 0 of 4) | the dynamic-boundary disclosure would go missing | not a defect |
| `callees.js:183` | `overloadCount` | latent (0 of 5000 nodes have unparseable `extra`) | would suppress the merged-overload NOTE | not a defect — but see the tell |
| `consequences.js:398` | `tasksRaw` | — | task enrichment only, no claim | not a defect |

### A third grant: losing a DISCLOSURE is not asserting a falsehood

Three of this batch share a shape the first batch did not. Their fallback does not claim anything —
it removes a *caveat*. `confidenceFooter = ''`, `boundaryBlock = ''`, and `overloadCount = 1` all
leave the answer **less qualified** rather than more confident.

⇒ That is still the fail-open direction, and it is a **weaker** grant than a false banner. Ranking it
level with "earned the delete banner" would flatten exactly the distinction two-axis grading exists
to preserve.

### ⚠ `callees.js:183` is the tell again, at low stakes

Its catch reads `/* extra unparseable — claim nothing */`. The value claims something: `1`. And the
NOTE it gates on exists because — the code's own words — *"'This function is recursive' changes how
an agent reasons about it, so a self-edge on a merged node must not be presented as recursion."*
With `overloadCount = 1` the NOTE is suppressed, so an unknown reads as *"exactly one overload"* and
a merged-overload self-edge is presented as recursion.

**The comment defends what it intends; the value grants something else.** Latent, so recorded rather
than fixed — but it is the fourth appearance of the same tell, in a file none of the others touched.

⚠ Also observed while checking it: **0 of 5000 sampled nodes carry an `overloads` key at all**, so on
this graph the NOTE cannot fire regardless. Expected — it is a C++ construct and this repo is JS —
and noted so a later reader does not mistake its silence for evidence.

### ⭐ The refinement the data gave, and it should drive the remaining 19

Every candidate adjudicated as **reachable** so far had a try block crossing a **process boundary** —
`git rev-parse` via `getHeadCommit`, an LSP request via `session.client`. Every candidate that came
back **latent** was calling one of our own helpers, which already fail closed internally:
`loadManifest` returns a manifest for a malformed file *and* for a directory; `readSymbolBody`
returns `''` rather than throwing; `parseDb` swallows to `null`; `computeCompileDbCoverage` returned
on all 12 hostile inputs.

⇒ **Rank the remaining candidates by whether the try block leaves the process.** That is where the
throws are, because our own helpers were hardened years of incidents ago and the external ones cannot
be. It costs nothing to apply and it is derived from the adjudications rather than assumed.

## Third batch — the ranking's first prediction, paid

The process-boundary ranking put `health.js:826` at the top of the unworked queue. It was a defect.

| site | keeps | reachability | grant | verdict |
|---|---|---|---|---|
| `health.js:826` | `briefStaleVsManifest` | **demonstrated** — `JSON.parse` on a truncated file | silence: a brief that cannot be read looks perfectly current | ⛔ **FIXED** → `briefUnreadable` |
| `consequences.js:968` | `lastTouched` | **demonstrated** — `execFileSync('git', …)` | git-history enrichment only | reachable, low grant — not a defect |

### `health.js:826` — the fifth collapsed state, and the repair is NOT to flip the flag

A `brief.json` that will not parse produced output **identical** to one that is perfectly current:
no verdict, no next action, nothing. All four consumers went quiet at once.

⚠ **Not a hypothetical corruption.** A truncated write is exactly what a full disk leaves behind, and
this machine reached 0 bytes free earlier the same day.

⚠ **And the existing test that pins `briefStaleVsManifest === false` on malformed input is RIGHT.**
The brief is not *known* to be stale; flipping that flag would fabricate a fact — the same trap
`lsp-evidence.js` records as *"a probe failure must not fabricate staleness"*, which was correct
about truth. ⇒ The repair is not to overload one boolean but to report the **separate** fact that the
check could not run. That test stays green, untouched, which is the evidence this adds rather than
breaks.

⚠ **The catch's comment said "missing or malformed" and only one of those reaches it.** `existsSync`
gates the try, so the catch only ever sees a file that exists and will not parse — the one case where
the default is wrong. The comment argues the case where `false` is correct while the value also
covers the case where it is not. **Fifth appearance of the tell.**

### ⭐ The ranking made a prediction and it paid — once

Its first unworked boundary-crosser was a real defect. That is **one** confirmation, not a
validation: the ranking is still a heuristic derived from earlier adjudications, and one hit is what
a coin does half the time. What would falsify it is an in-process candidate turning out reachable,
and that has not happened yet either.

## What this sweep did NOT close

⛔ **19 of the 36 are not yet adjudicated.** The stopping rule is *adjudicate every trust-bearing
candidate; stop when that set is empty*, and that set is not empty. This ledger is partial and says
so rather than implying the class is closed.

⛔ **The recall audit still scores 4 of 5, and the miss is a shape.** The gitignore-negation defect
is a wrong **filter**, not a swallowed error, so no catch-shaped detector can see it. **That hole is
the exact shape a clean sweep will keep missing**, and a clean run by someone who does not know it
reads as coverage.
