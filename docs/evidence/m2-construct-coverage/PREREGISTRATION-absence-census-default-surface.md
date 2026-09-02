# Preregistration — does EVERY listed verb's absence carry a scope statement?

**Written:** 2026-09-02, before any verb was driven.

## Why

M2's stop condition is a **population claim**: *"every absence-shaped answer carries a scope statement
an agent can act on."* Three cycles have fixed absence disclosure **verb by verb** — the five
`buildAbsenceTrustLine` consumers, the eight `buildTrustLine` sites, then four `NO MATCH` callers.
Each time the population was "the verbs I happened to be looking at", and each time a verb I had not
looked at turned out to be missing the fix.

That is not evidence the sweep is done. It is evidence that my population has been chosen by
availability. This measures the **whole default surface** instead.

⚠ **Behavioural, not a source scan.** The suite-composition ratchet refused a source-text gate this
week with evidence: such checks "cannot fail when the behaviour breaks, and CAN fail when a line is
reflowed". Every row here comes from calling the verb.

## Population — derived from the registry

The **default `tools/list`** surface, read from a live `initialize` + `tools/list` (16 verbs at last
measure, but taken from the response, not that number). These are what an agent in a deferred-tool
runtime can actually reach; the 27 unlisted verbs are out of scope and that limit is stated in the
finding.

Each verb is driven with arguments satisfying its registry-declared `required` fields, using an
absent symbol / nonexistent target so the absence path runs.

## Identity rule

Applied to the `tools/call` result text:

- **absence-shaped** = matches `NO [A-Z]+|NO MATCH|not found|no results|0 (callers|callees|results)`.
- **carries scope** = states the population searched or the index's condition — one of: `this index`,
  `indexed graph`, `in this graph`, `SEARCHED`, `behind HEAD`, `staleness could NOT be determined`,
  `SCOPE:`, `declaration types`, `NOT exhaustive`.
- A verb whose answer is **not** absence-shaped is `n/a` — recorded, not counted as a pass.

## Finding schema

One row per verb: `{ verb, args, absenceShaped, carriesScope, excerpt }`.

## Controls, same pass

- **POSITIVE — at least one verb IS absence-shaped.** If none is, the census measured nothing and the
  identity rule is broken, not the product.
- **POSITIVE — a known-fixed verb reports `carriesScope: true`** (`graph_callers` on an absent
  symbol, now carrying the staleness caveat on a stale index). If it reports false, the matcher is
  wrong rather than the verb.
- **POSITIVE — a known-unfixed shape reports false.** The bare `NO MATCH for "x". Try graph_search…`
  string must classify as absence-shaped WITHOUT scope, or the matcher cannot detect the defect it
  exists to find.
- **The listing is non-empty**, or every row is an artefact.

## Claim ceiling

One fixture, one absent target per verb, the **default profile only**. It measures **what the text
says**, not whether an agent reads or acts on it. A verb may have other absence paths this single
input never reaches — so a `carriesScope: true` row means *that path* discloses, not that the verb
always does.

## Abandon rule

If a verb cannot be driven to any answer (bad args, crash), record it as `not driven` with the error
and conclude nothing about it. Do not infer disclosure from a verb that never ran.

## Decided in advance

- **Every absence-shaped row carries scope** → M2's stop condition is met on the default surface;
  say so, with the ceiling, and stop sweeping.
- **Any row bare** → name it, fix it, and record that three verb-by-verb cycles still left it —
  which would be the fourth consecutive time an availability-chosen population missed something.
