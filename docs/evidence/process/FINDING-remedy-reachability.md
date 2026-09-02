# No remedy sends an agent to a verb it cannot call — measured, then made mechanical

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/process/PREREGISTRATION-remedy-reachability.md`
**Gate:** `tests/unit/query/remedy-reachability.test.js`
**Cost:** zero agent budget.

## Why this is product work, not tidiness

The purpose statement has two halves, and every milestone so far has been the graph half. The other
is *"the skills that teach an agent when to reach for which."* The measured bottleneck there is
**mid-task reach**: agents do not invoke skills mid-task, and the one surface they reliably read is
**verb output** — which is where remedies like *"use code_intel_references"* live.

A remedy in that output naming a verb the agent **cannot call** is a dead end at the moment of
decision: the same defect class M1 exists to kill, in the routing half.

## Result: zero violations, on both substrates

**Runtime** — 6 outputs through `tools/call` on a real indexed fixture (the ambiguity refusal plus
all five absence consumers): **16 verb mentions, 0 unreachable.** Every one of
`code_intel_references`, `graph_whereis`, `graph_collect_code_intel`, `graph_health`, `graph_search`
is in the default listing.

**Source** — all **8** `remedy:` literals in the query layer: `callers`→`graph_impact` (listed),
`health`→`graph_index` ×2 (listed), `lsp-evidence`→`graph_collect_code_intel` ×2 (listed),
`callees`→`graph_neighbors` (unlisted, permitted — see below), and two naming no verb at all
(a cmake flag, and the slash command `/graph-build-functionality`).

Controls: the outputs demonstrably **do** name verbs (16 occurrences), so the zero is not vacuous;
the listed set is non-empty and strictly smaller than the 43-tool registry; the matcher rejects an
invented token and a slash command; and registry membership is required, so the regex cannot invent
verbs out of prose.

## The invariant was real and held by hand

Three places name it — *"a LISTED verb must not name an UNLISTED one"* (`callees.js:117`,
`callers.js:102`, `absence-names-its-population.test.js:147`) — and `callers.js` even documents
choosing `graph_impact` **"NOT graph_preflight"** for exactly this reason. But it was enforced
**attentionally**: correct because someone remembered at each call site.

A rule maintained by remembering is not a remedy. It is now mechanical.

## ⚠ The gap that made the source gate necessary

The runtime scan **could not trigger `unsearchedRelationNote`** — the code path where the risky
remedy actually lives. So the runtime zero, while real, excludes the one case most likely to fail.
That is why the gate reads the literals rather than relying on the outputs I happened to be able to
produce. A clean zero from a population that excludes the risky case is the trap this project keeps
finding.

## Mutants — tree committed at `daf1240` first

| Mutant | Verdict |
|---|---|
| **R-1** `callers.js` remedy changed to name `graph_preflight` (unlisted) — the exact case its comment warns against | **KILLED** — `callers.js (graph_callers) -> graph_preflight` |
| **R-2** the unlisted-producer exception removed | **KILLED** — `callees.js (graph_callees) -> graph_neighbors` |

R-2 matters twice over: it proves the exception is load-bearing rather than decoration, **and** that
a real unlisted→unlisted case exists in the population, so the exception is not hypothetical.

## Ceiling

Checks remedy **literals** in the query layer, plus outputs from one fixture. It does not prove an
agent follows a remedy, that the advice is good, or that prose elsewhere in an output never names an
unlisted verb. It makes the pointer reachable; it does not make it useful.
