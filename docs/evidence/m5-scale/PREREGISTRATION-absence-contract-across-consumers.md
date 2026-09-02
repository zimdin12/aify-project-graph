# Preregistration — does the M2 absence contract reach an agent from ALL FIVE consumers?

**Written:** 2026-09-02, before any of the five was probed and before the default listing was read
for this purpose.

## Why

`FINDING-contract-reachability.md` proved the M2 contract reaches an agent — **from `graph_callers`,
the one verb I happened to pick.** Its own ceiling says "one fixture, one verb". M2 is recorded DONE
with **5 consumers**, so four of them are unmeasured, and "one consumer works" has been mistaken for
"the contract is delivered" in this project before.

## Population — derived, not listed

Every verb that calls `buildAbsenceTrustLine` (`mcp/stdio/query/lsp-evidence.js:396`). Measured by
name across `mcp/stdio/`, excluding the defining file and comment-only mentions:

| verb | call site | noun |
|---|---|---|
| `graph_callees` | `callees.js:122` | callees |
| `graph_callers` | `callers.js:108` | callers |
| `graph_impact` | `impact.js:101` | impact |
| `graph_neighbors` | `neighbors.js:46` | neighbors |
| `graph_trace` | `trace.js:358` | path |

`consequences.js:1150` mentions it in a comment only and is **not** a consumer — recorded so the
exclusion is visible rather than silent.

## Two questions, deliberately separated

They are different nouns and must not be collapsed:

1. **TRANSPORT reachability** — given an empty result, does the clause arrive in the `tools/call`
   response?
2. **SURFACE reachability** — is the verb in the `tools/list` an agent actually sees? `tools/call`
   works for unlisted verbs (gating is listing-only, proven in `tests/integration/server-toolset.test.js`),
   but a runtime that defers tools behind a search step can only reach what is listed. **A contract
   carried only by verbs an agent cannot list is delivered in principle and undelivered in practice.**

## Identity rule

- **Transport-reachable** = the response text for an empty result contains
  `NOT MODELLED: a macro-generated call is invisible to BOTH tiers`, taken verbatim from
  `lsp-evidence.js:388`. ⚠ Markers come from shipped source, never retyped from memory — I broke this
  rule last cycle and briefly read working code as a missing contract.
- **Surface-reachable** = the verb name appears in the `default` profile `tools/list`.

## Finding schema

One row per verb: `{ verb, emptyResultProduced, transportReachable, surfaceReachable, note }`.

## Controls, same pass

- **POSITIVE — the result really was EMPTY.** The contract fires only on an absence. A verb that
  returned edges was never asked the question, and its "unreachable" would be an artefact. Each row
  records whether an empty result was actually produced; a verb where I cannot produce one is
  reported as `emptyResultProduced: false`, not as a failure.
- **POSITIVE — the probe can see the clause.** `graph_callers` is already proven transport-reachable;
  it must come back reachable here too, or the harness is broken rather than the other four.
- **NEGATIVE — the matcher can say ABSENT**, via a live matcher proved on both canaries.
- **POSITIVE — the listing is non-empty**, or every verb would score surface-unreachable for a reason
  unrelated to the surface.

## Claim ceiling

Reachability of TEXT on ONE fixture. Not that an agent reads it, understands it, or acts on it. Says
nothing about prevalence in real C++ and nothing about the 38 verbs outside this population.

## Abandon rule

If an empty result cannot be produced for a verb, report `emptyResultProduced: false` and **conclude
nothing** about that verb. Do not weaken the identity rule to whatever text comes back, and do not
count a verb as reachable because a *non-empty* response happened to mention something similar.

## Decided in advance

- **All five transport-reachable** → record it; M2's "5 consumers" is consumer-side true.
- **Any consumer NOT transport-reachable** → a shipped contract that does not arrive; P0, and M2's
  DONE status is wrong.
- **Any consumer not surface-reachable** → record it as a *practical* delivery gap, distinct from a
  transport defect, and do NOT report it as the contract being broken.
