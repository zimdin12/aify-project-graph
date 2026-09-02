# Preregistration — do the M1/M2 contracts survive to an agent through `tools/call`?

**Written:** 2026-09-02, before the probe was run and before any result was seen.

## Why

M1 and M2 are marked DONE in the plan's status table. Every test behind them calls a **verb
function** — `buildAmbiguousMatchMessage` with synthetic rows and a stub db
(`tests/unit/query/ambiguous-refusal-carries-caller-sets.test.js`), or `graphCallers` on a real
fixture repo (`tests/integration/m1b-overloads-do-not-collapse.test.js`).

**Nothing exercises the MCP `tools/call` path an agent actually uses.** Between the verb function and
the agent sit `enforceBudget`, the renderer, and the JSON-RPC content wrapper. A truncation there
would silently remove the exact thing M1b shipped — the qualified candidates *with their caller
sets* — and every existing test would stay green.

This is the defect class that has recurred three times in this project: hardening output that the
consumer cannot reach. The rule from that arc is to check reachability **with no arguments** before
any further quality push.

## Question

For each shipped contract, does its distinctive text arrive in the `tools/call` result an agent
receives, on a real indexed repo, through a spawned server?

## Population

Fixed now:

1. **M1b — ambiguous refusal carries caller sets.** `graph_callers` on an ambiguous bare name in
   `tests/fixtures/identity-hostile`.
2. **M2 — construct coverage on an absence.** A `graph_callers` result with an empty caller set must
   carry the "NOT MODELLED" clause naming what the analysis cannot see.

## Identity rule

**Reachable** = the distinctive marker text appears in the `result.content` of the `tools/call`
response. Markers are taken from the shipped source, not retyped from memory, and each is quoted in
the finding with the file it came from.

## Finding schema

One row per contract: `{ contract, reachable: boolean, marker, note }`.

## Controls, same pass

- **POSITIVE — the call worked at all.** The response must be a `tools/call` result with non-empty
  content and no JSON-RPC error. A crashed or empty call would otherwise report every contract
  unreachable for a reason that has nothing to do with the contracts.
- **POSITIVE — the matcher can find something known present.** A control string that the response
  must contain regardless of contract (verified in the same response).
- **NEGATIVE — the matcher can say ABSENT.** A string known not to be there, asserted via
  `expectAbsentWithLiveMatcher`, so a matcher that returns true for everything is excluded.
- **THE FIXTURE REALLY IS AMBIGUOUS.** If the symbol resolves unambiguously, the refusal contract is
  never triggered and a "not reachable" result would be meaningless.

## Claim ceiling

This measures **reachability of text**, nothing more. It does not show an agent reads the clause,
understands it, or acts on it — that is the A/B's question. It covers one fixture and the verbs named
above; it says nothing about the other 41 tools.

## Abandon rule

If the fixture cannot be made to produce an ambiguous match through the server, **report that the
probe could not be constructed** and conclude nothing about reachability. Do not weaken the identity
rule to whatever text happens to come back.

## Decided in advance

- **Reachable** → record it, add a gate so it stays reachable, and note that M1/M2's DONE status now
  rests on consumer-side evidence rather than producer-side only.
- **NOT reachable** → that is a P0 finding: a shipped contract no agent can receive, and the DONE
  status in the plan's table is wrong and must be corrected the same day.
