# The delete-decision route cannot see publication state at all

**Date:** 2026-09-02
**Instrument:** `scripts/m5-route-census.mjs` (all controls pass)
**Why now:** the linkage-scope key names a route census as PREREQUISITE EVIDENCE, not analysis —
"prove the mutant moves the CONSUMED route before treating any null as evidence."
**Cost:** zero agent budget. This is exactly the cheap mechanical experiment the plan asks for at
every milestone.

## Result

Over the 43 tools in the real registry (`mcp/stdio/tools/schema.js`), **29 consume publication state
and 14 do not**. The 14 include **every one of the 8 `code_intel_*` verbs**.

Publication state reaches a verb through one of two doors, and both were measured:

- **shared** — `inspectReadFreshness` reads the publication record, classifies attestation, and
  returns `blocker`/`warnings` that the caller renders via `prefixReadWarnings`
  (`mcp/stdio/query/verbs/read_freshness.js:309,384,404`). The caller names itself in `verbName:`,
  which is what binds a file to a registered tool.
- **direct** — `health.js` and `status.js` import `publication-schema` themselves and never call
  `inspectReadFreshness` at all.

## The finding the experiment turns on

The product's own text routes a delete decision to `code_intel_references`:

- `mcp/stdio/server.js:304` — "the only verb whose answer can support a delete or rename decision …
  exhaustive is WITHHELD (cause index_population_unattested)".
- `mcp/stdio/tools/schema.js:103` — "For a delete decision read evidence.exhaustive on
  code_intel_references, not this summary."
- `mcp/stdio/server-instructions.js:51` — "evidence.exhaustive is CURRENTLY NEVER TRUE on the live
  reference path … For absence, rg is the only sound method today."

Both verbs it names — `code_intel_references` (implemented by `codeIntelReferences`, exported from
`mcp/stdio/query/verbs/code_intel_live.js:785`) and `code_intel_hierarchy` — are in the
**non-consuming** set. A transitive import walk agrees: 26 and 23 modules reached, zero publication
carriers. An independent grep for `read_freshness|publication-schema|health.js` agrees, and the same
probe fires on `callers.js`, so it discriminates rather than being blind.

**So a publication-state treatment cannot move the delete-decision route.** A null measured there
would be a fact about the wiring, not about the product — precisely the trap `knownRouteGap` warned
about, now proven from code instead of assumed.

## What this means for M5, stated plainly

On a delete decision the graph arm **cannot** produce an authoritative "no callers", by design and by
its own documentation. Its contribution on that question is bounding and refusing, not answering.
That does not settle the milestone, but it narrows what an expensive A/B could honestly ask: any arm
comparison on absence is measuring whether a *floor plus a refusal* beats grep, not whether the graph
answers better than grep.

## Two defects in my own instrument, both found by controls

1. **Single-door blindness.** The first version defined consumption as "calls `inspectReadFreshness`"
   and therefore reported **`graph_health` — the trust verb — as a non-consumer**. It had one
   positive control, on the door it had already implemented, so it certified the instrument on the
   only inputs it handled correctly. Fixed by measuring both doors and adding a positive control
   **per door**.
2. **A silently dropped verb.** Binding a direct-door file to a tool name is a guess from the
   filename; an unconfirmed guess is now reported as `unbound` rather than dropped, because a dropped
   verb is invisible in exactly the column that would matter. The door module itself is excluded by
   the derived property that it *defines* `inspectReadFreshness`, not by name.

Defect 1 is the same shape as the evidence gate found in the same hour, whose positive control used
`node_modules` — the one population its broken probe still served. **A control drawn from where the
instrument already works certifies nothing.**

## Ceiling

- ⭐ **SHARPENED 2026-09-02 by measurement** (`FINDING-tearing-contrast.md`): a verb that opens the
  publication door does **not** thereby change what it says when the graph is torn. `graph_callers`
  consumes publication state and is byte-identical under tearing. This census bounds which verbs
  *could* be moved by a publication-state treatment; only a contrast shows which actually **are**.
  The negative column keeps its full force — a verb with no door cannot change under tearing — so the
  `knownRouteGap` conclusion below is unaffected.
- This is a **consumption census by door**, not a dataflow proof. It shows a consuming verb *opens*
  the door; it does not show that every code path inside that verb renders what comes through it.
- The **negative column is the sound claim**: a verb with no door cannot render the state, so a
  treatment to that state cannot move it. The positive column is a ceiling.
- It says nothing about whether publication state *should* reach `code_intel_*`. That is a product
  question, and the key's `freezeRule` explicitly defers the wiring question until after tier B
  closes, as a new slice with its own preregistration.
