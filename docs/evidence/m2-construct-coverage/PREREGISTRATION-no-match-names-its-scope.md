# Preregistration — does a bare "NO MATCH" name the population it searched?

**Written:** 2026-09-02, before the four verbs were driven and before any output was read.

## Why

M2's stop condition is *"every absence-shaped answer carries a scope statement an agent can act on."*
Five consumers of `buildAbsenceTrustLine` now satisfy it, verified under fault. **`NO MATCH` does not
route through that builder at all.**

The repo has already recognised this exact class and fixed it for **one** verb.
`tests/unit/query/whereis-miss-scope.test.js` states it outright:

> "`graph_whereis("SEARCH_TYPES")` … answers `NO MATCH … Try graph_search`. That sentence is shaped
> like a fact about the repository. The true fact is about this verb's DECLARATION TABLE."

Measured wiring: `missScopeNote` is imported by **3** verbs (`lookup`, `preflight`, `whereis`);
`noMatchMessage` is called by **5** (`callees`, `callers`, `change_plan`, `impact`, `whereis`).
**`whereis` is the only overlap** — it passes the scope note in. The other four call the bare form.

## Question

For `graph_callers`, `graph_callees`, `graph_impact` and `graph_change_plan`, does the `NO MATCH`
answer name the population searched, or does it read as a fact about the repository?

## Population

Those four verbs, driven on the existing fixture with a symbol that is genuinely absent from the
graph. The fifth caller (`whereis`) is excluded because it is already fixed — its inclusion would
dilute the measurement with a known pass.

## Identity rule

- **Names its scope** = the text states that the answer is about this INDEX / this verb's search
  population, distinguishably from a claim that the symbol does not exist.
- **Bare** = it asserts `NO MATCH` and offers a retry, with no such statement.

## Finding schema

One row per verb: `{ verb, text, namesScope: boolean }`.

## Controls, same pass

- **POSITIVE — the symbol really is absent.** If it resolves, the verb never takes this path and the
  row says nothing. Asserted by the answer containing `NO MATCH`.
- **POSITIVE — the graph is populated.** A `NO MATCH` from an EMPTY graph is a different (and
  correct) answer; the fixture must have nodes, or every row is an artefact.
- **POSITIVE — the already-fixed verb is distinguishable.** `graph_whereis` on the same input should
  show the scope note, proving the identity rule can tell fixed from unfixed rather than reporting
  everything bare.

## Claim ceiling

One fixture, four verbs, one absent symbol. It measures **what the text says**, not whether an agent
misreads it — that is a decision-utility question the A/B would answer, and it is unrun.

## ⚠ Constraint on any fix, taken from the existing work

`whereis-miss-scope.test.js`: *"SCOPE THE DOUBT TO ITS CAUSE. A generic 'results may be incomplete'
costs the reader as much as a false claim — they go and check either way. So the disclosure must be
MEASURED: name the types searched, and name which of them are EMPTY IN THIS GRAPH."*

⇒ A generic hedge is **not** an acceptable fix here. If I cannot state a measured, actionable fact for
these four verbs, the honest outcome is to report that and leave them alone.

## Decided in advance

- **All four bare** → a real gap in M2's stop condition; fix with a MEASURED scope statement, or
  report that no measured statement is available and leave them.
- **Any already naming scope** → record which, and narrow the claim to the rest.
