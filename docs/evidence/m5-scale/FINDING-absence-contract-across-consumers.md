# All five absence-contract consumers reach the agent — and two cannot be listed

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m5-scale/PREREGISTRATION-absence-contract-across-consumers.md`
**Gate:** `tests/integration/contracts-reach-the-agent.test.js`
**Cost:** zero agent budget.

## Result

Population derived from every caller of `buildAbsenceTrustLine` (`lsp-evidence.js:396`), probed
through a spawned server on a freshly indexed `tests/fixtures/identity-hostile`:

| verb | absence produced | TRANSPORT (clause arrives) | SURFACE (in default `tools/list`) |
|---|---|---|---|
| `graph_callers` | yes | **yes** | yes |
| `graph_callees` | yes | **yes** | **no** |
| `graph_impact` | yes | **yes** | yes |
| `graph_neighbors` | yes | **yes** | **no** |
| `graph_trace` | yes | **yes** | yes |

**Transport: 5 of 5.** M2's "5 consumers" is consumer-side true, not just producer-side. The previous
finding covered only `graph_callers` and said so in its ceiling; the other four are now measured
rather than assumed.

## The control that earned its place

`graph_neighbors` first came back **non-empty** — `CONTAINS` and `DEFINES` edges — so its absence
branch never fired. Without the preregistered "did it actually return an absence?" control I would
have recorded it as unreachable, which would have been a property of **my query**, not of the
product. It needs `edge_types: ['CALLS']` to be asked the question at all.

That is the difference between a verb that failed and a verb that was never asked, and only the
control separates them.

## Transport and surface are different nouns

`tools/call` reaches unlisted verbs — gating is listing-only. But a runtime that defers tools behind a
search step reaches only what is **listed**. `graph_callees` and `graph_neighbors` are absent from the
default 16, so in that runtime their correct contract is **delivered in principle and undelivered in
practice**.

⚠ **THIS WAS ALREADY KNOWN AND WRITTEN DOWN.** `mcp/stdio/query/verbs/callees.js:116-119` states it
outright — "graph_neighbors is not in the default tool profile — and neither is graph_callees" — and
the repo has a remedy-reachability guard built on it ("a LISTED verb must not name an UNLISTED one").
**I did not discover this.** What the probe adds is a *measurement against the live listing* where
before there was a comment asserting it, and the two agree. That distinction matters here because
this project has four recorded cases where correct, prominent, adjacent knowledge failed to catch the
defect it described — a comment is not an instrument. But it is not a finding, and reading the
adjacent source first would have been cheaper.

That is the **second time this session** a probe of mine replicated something already recorded in the
tree; C6's `estimand` field was the first.

The gating itself is deliberate — "agents under-pick from big lists" — so the unlisted set is
recorded here rather than pinned in a test, where it would fight a legitimate future change.

## Mutants

Tree committed at `d19207e` before mutating.

| Mutant | Verdict |
|---|---|
| D-1 `graph_callees` drops the clause (one consumer only) | **KILLED** — `expected [ 'graph_callees' ] to deeply equal []` |

⚠ D-1's first attempt was **NOT APPLIED** — a `sed` that failed on the `'\n'` escaping, reporting
`applied: 0=1`. The suite then passed, and that pass meant nothing: NOT APPLIED is unverified, never
passing. Re-done with the Edit tool and the mutation verified present before the run.

## Ceiling

Reachability of TEXT, on one fixture, for five verbs. It does not show an agent reads the clause,
understands it, or changes a decision because of it — that is the A/B's question and it remains
unrun. Says nothing about prevalence in real C++, nothing about the other 38 tools, and nothing about
whether the two unlisted verbs *should* be listed.
