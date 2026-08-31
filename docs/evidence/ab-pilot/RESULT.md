# Routing/utility pilot — RESULT

**`engineering pilot, n=1/cell`. It can falsify the apparatus and the gross mechanism
premise. It CANNOT support a rate. Any percentage quoted from this is a misreading.**

Control arm `a48554c`. 10 cells, 2 tasks x (2 implementations x 2 graph states + 1 no-graph).

## Outcome: 10/10 correct, zero adverse, in every arm

| task | current-healthy | current-torn | gate-disabled-healthy | gate-disabled-torn | no graph |
|---|---|---|---|---|---|
| C2 delete-safety      | ✓ 01 | ✓ 02 | ✓ 03 | ✓ 04 | ✓ 09 |
| C6 does-anything-call | ✓ 05 | ✓ 06 | ✓ 07 | ✓ 08 | ✓ 10 |

No cell asserted "safe to delete" or "no callers". `primary_adverse` = 0/10.

## ⛔ The preregistered stop rule FIRES

> both arms independently source-verify and avoid the unsafe conclusion —
> **incremental unit value unsupported on that task**

It fires on BOTH tasks. And the reason is uniform: **every answer rested on a POSITIVE
finding, never on an absence.** The publication gate constrains absence claims, so it could
not matter. Cells 02, 06 and 08 saw `attestation=generation_mismatch` in the torn arms,
reported it, and correctly judged it irrelevant to a found caller.

Cell 04 stated the governing rule: *"If you had asked me to certify computeWeight has NO
callers, I could not have, and neither could that tool."*

## Where the graph WAS load-bearing — one place, reported by 4 cells

`graph_callers` refused the bare name `normalizeInput` as AMBIGUOUS and forced qualification
into `src::entry::normalizeInput` and `src::normalize::normalizeInput`. Cell 07 is explicit:
*"That is what put me onto the two-symbol split."*

The no-graph arms found the same collision — by reading all 8 files. Both routes worked here;
only one survives a repo too large to read.

## Where it was not

Cell 01, full graph available: *"The graph layer contributed nothing to the answer."*
29 nodes, `compilerVerifiedEdges` 0; the answer came from clangd plus grep.

Cell 10 named the gap precisely: its conclusion that the two symbols were unrelated was an
**INFERENCE about language semantics, not an observed binding**. A compiler-backed resolver
would have made it an observation. That is the honest answer to "what would the graph give
you that reading did not."

## THE defect, in cell 09's words

> "'No callers found' and 'I could not see the caller' currently render as the same string.
> Any tool that answers deletion questions has to make those two different, or it is not
> answering the question."

### Its fix, which is the best idea in the run
**Put a positive control IN THE OUTPUT.** Report a known-called symbol beside the target.
*"If it tells me computeWeight has 0 callers and normalizeInput also has 0 callers, the index
is broken, not the codebase clean. Without that, a broken index and a genuinely dead symbol
produce identical output, and the failure is silent in the direction I already want to
believe."*

### Two detectors, grep-level not parser-level, that catch both traps here
1. flag an `extern` in a `.cpp` that pairs with a definition elsewhere and has NO header
2. flag `#include "*.cpp"` — a unity build means per-file compile checks lie

## Cost findings — three independent cells, same conclusion

- **Our tool surface costs more than the work.** A failed lookup for `comms_send` (real name
  `mcp__aify-comms__comms_send`) dumped ~600 tool names. Cell 10: *"The schema search and tool
  listing plausibly cost more than reading the entire repository did."* Cell 09: investigation
  ≈2k tokens inside a ≈59k session.
- **Our own skill caused the single biggest measured waste.** `waitForReadyMs: 25000` cost
  **26,627 ms** waiting for readiness that was structurally unreachable — and the server
  emitted the missing-compile_commands warning in the SAME response.
- **`graph_health` is tax on a non-empty query.** ~120 lines consumed for two booleans and one
  commit comparison — and both booleans only constrain ABSENCE claims.
- **Desensitisation risk**, cell 01: the exhaustiveness caveat is restated three times
  regardless of result shape, *"which trains me to skim it in the one case where it decides
  everything."*

Measured wall clock where an instrument existed: cell 10, **92,829 ms**, from epoch-ms in the
run_ids. Cell 09 declined to estimate wall clock rather than invent one.

## What this pilot CANNOT tell you

- **Nothing about scale.** 8 files. Cell 10: *"this repo is a corpus ... here the index is the
  thing UNDER TEST, not the instrument."* Exhaustive reading dominates any resolver at this
  size, so the no-graph arm's success is expected, not a product verdict.
- **Nothing about a rate.** n=1/cell.
- **Nothing about the torn-graph mechanism**, because no answer depended on an absence. The
  route census already predicted this: the gate does not reach `graph_callers`.

## ⚠ A defect in MY OWN ground truth, found by cell 06

I added `src/entry.js` as filler so the graph would have resolvable JS edges, and gave it a
function with the same name and body as the C++ one — an accidental cross-language homonym I
did not notice when writing the answer key. The sealed key said C6 truth was "stage.cpp calls
it", which is true and incomplete. The verdict is unaffected; the KEY was the defective
artifact, not the answers.

## Also: the first run of this pilot was INVALID

10/10 failed on Claude Code's folder-trust prompt for brand-new directories. My first
diagnosis — a startup race against the 180s backstop — was WRONG, and `comms_console_tail` on
the dead worker refuted it. Serialising, my proposed fix, would have failed all ten
identically. Recorded in `run-01-INVALID.md` rather than retried silently.
