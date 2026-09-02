# The M1/M2 contracts do reach an agent — measured consumer-side, then gated

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m5-scale/PREREGISTRATION-contract-reachability.md` (before the probe ran)
**Gate:** `tests/integration/contracts-reach-the-agent.test.js`
**Cost:** zero agent budget.

## Result: REACHABLE, both contracts

Through a spawned `mcp/stdio/server.js`, real `initialize` + `tools/call`, on a freshly indexed copy
of `tests/fixtures/identity-hostile`:

**M1b — the ambiguous refusal, with caller sets.** What an agent receives:

```
AMBIGUOUS MATCH for "render". 2 concrete candidates found:
- alpha::Widget::render src/shapes.cpp:6
    -> 0 callers in the indexed graph
- beta::Widget::render src/shapes.cpp:24
    -> 0 callers in the indexed graph
⚠ Caller counts come from the heuristic graph and are a FLOOR, not an exhaustive set. …
Retry with a qualified symbol …
```

The dead end M1 set out to fix is closed **consumer-side**: candidates *and* their caller sets *and*
the floor caveat all survive `enforceBudget`, the renderer and the JSON-RPC wrapper.

**M2 — an absence carrying what was not modelled.** For `alpha::Widget::render`, the response opens
`NO CALLERS`, then carries `TRUST:` (heuristic, not exhaustive), `SCOPE:` (no code-intel collection
exists for this repo, so nothing is compiler-verified), and the full `NOT MODELLED: a macro-generated
call is invisible to BOTH tiers…` clause, intact.

## Why this needed checking at all

Every other test behind M1b and M2 calls a **verb function** — `buildAmbiguousMatchMessage` with
synthetic rows and a stub db, or `graphCallers` on a fixture repo. **Nothing crossed the MCP
boundary.** A budget truncation between the verb and the agent would have silently deleted the exact
thing M1b shipped, and the whole suite would have stayed green.

This project has produced that defect three times: hardening output the consumer cannot reach. The
rule from that arc — check reachability with no arguments before any further quality push — is what
prompted this, and this time the answer was good news.

**M1's and M2's DONE status now rests on consumer-side evidence, not producer-side only.**

## Mutants — the gate catches the failure it exists for

Tree committed at `2d4a54d` before mutating.

| Mutant | Verdict |
|---|---|
| C-1 caller-set enrichment never runs | **KILLED** — "candidates arrived without their caller sets — M1b would be unreachable: expected 0 to be >= 2" |
| C-2 the `NOT MODELLED` clause returns empty | **KILLED** — absence text no longer contains it |

Controls in the same pass: no JSON-RPC error and non-empty content on both calls; the fixture is
proven genuinely ambiguous (both `alpha::` and `beta::` candidates present, or the refusal never
fires and its absence would mean nothing); and a live matcher asserting an empty caller set never
contains "safe to delete".

## Two instrument errors of mine, both caught here

1. **I retyped a marker from memory.** My probe looked for `'callers:'` and reported the caller-set
   enrichment **ABSENT** when it was present as `0 callers in the indexed graph`. My own
   preregistration says markers must be taken from shipped source, not memory — I wrote that rule and
   then broke it in the same hour. Had I stopped at the first probe I would have filed a false P0
   against working code.
2. **My first negative control was a placeholder canary.** `expectAbsentWithLiveMatcher` refused it:
   its signature demands a live matcher proved against a forbidden canary it must match and an
   allowed canary it must not. The helper was built to reject exactly the decorative control I
   reached for. Replaced with a real claim.

## Ceiling

Measures that the **text arrives**. It does not show an agent reads it, understands it, or acts on
it — that is what the A/B exists to answer, and it remains unrun. One fixture, one verb; says nothing
about the other 41 tools, and nothing about prevalence in real C++.
