# A non-empty caller set is silently incomplete — and the obvious fix is the one the repo already rejected

**Date:** 2026-09-03
**Probe:** `scripts/probe-nonempty-uncommitted.mjs`
**Status:** defect PROVEN with three controls; the remedy is a design decision, recorded below.

## The defect

M2 is "contract in EVERY result". The disclosure work earlier today covered **absence**: a NO MATCH
or an empty caller set now names the uncommitted files that could explain it. A **non-empty** result
does not.

Measured on a real graph, one committed caller and one uncommitted caller of the same symbol:

| arm | result |
|---|---|
| C1 the COMMITTED caller is listed | PASS — instrument works |
| C2 the UNCOMMITTED caller is genuinely MISSING | PASS — there is a real gap to disclose |
| C3 a CLEAN tree says nothing about uncommitted files | PASS — so a clause would be signal, not decoration |
| **Q the non-empty result discloses it** | **FAIL** |

What the agent actually receives:

```
EDGE committedCaller→target CALLS src/base.js:2 conf=0.90
LOCATIONS: each file:line is the CALLER FUNCTION's declaration, not a call site ...
TRUST: heuristic only (tree-sitter) — resolves calls BY NAME, so a common name ... OVERCOUNTS ...
```

⛔ **A list reads as authoritative in a way an absence does not.** An agent asking "who calls
`target`" before changing it gets one caller, updates it, and breaks a second that lives in a file it
wrote five minutes ago. An incomplete answer that looks complete is worse than a refusal — and this
is a case where grep would have found the caller, which is the one comparison this project is not
allowed to lose.

## ⚠ The obvious fix is explicitly forbidden by this codebase, for a good reason

`uncommittedSourceClause`'s own docstring says:

> **ONLY ON AN ABSENCE.** This is not a staleness warning and must not become one: the 592-untracked
> field report is what taught this repo that a warning on every read is noise. It is silent unless a
> not-found is being returned AND uncommitted SOURCE files exist to explain it.

That is a field-derived rule and it holds. On an actively-edited repository there are ALWAYS
uncommitted source files, so appending the existing clause to every non-empty result would fire on
every result forever. **A binary flag on an active repository is always on, and an always-on warning
is read as decoration** — the exact route by which a guard stops being a guard.

⇒ Appending the absence clause here would trade a silent defect for a loud one.

## The decision: gate on RELEVANCE, not on existence

Fire only when an uncommitted source file **textually contains the queried symbol name**. Then:

- the 592-untracked case stays silent, because none of those files mention the symbol;
- the case that actually hurts — the agent's own just-written caller — is named;
- and the signal means something, because its absence is informative.

⚠ **It is a TEXTUAL claim and must be worded as one.** Finding the name in an unindexed file does not
establish that a call exists there — it could be a comment, a string, or an unrelated identifier. The
clause may say the file mentions the symbol and is not indexed; it may NOT say the file calls it.

⚠ **Cost is bounded deliberately.** Scanning uncommitted files on every non-empty query is work that
scales with how dirty the tree is, which is exactly the population the field report was about. A cap
is required, and exceeding it must degrade to silence rather than to a partial claim.

⚠ **Reversible, and chosen without a reviewer.** Comms to graph-senior-dev has been HTTP 401 all
session. This is the most fitting reversible default: it is one predicate, and reverting it is one
commit. The alternative designs — always-on (rejected above) and structured-field-only (invisible to
the agent reading prose, which is how the doc layer went unreachable) — are both worse on the
evidence this repo already holds.
