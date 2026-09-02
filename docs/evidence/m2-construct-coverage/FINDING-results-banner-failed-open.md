# The RESULTS trust banner failed open too — 7 sites, now disclosed

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m2-construct-coverage/PREREGISTRATION-results-banner-fails-open.md`
**Fix:** `RESULTS_TRUST_UNAVAILABLE` in `mcp/stdio/query/lsp-evidence.js`
**Gate:** `tests/unit/query/results-banner-failure-is-disclosed.test.js`
**Cost:** zero agent budget.

## Result

With `buildTrustLine` induced to throw, `graph_callers` returned:

```
EDGE use_helper→src::shapes::helper CALLS src/shapes.cpp:31 conf=0.90
```

…and no trust statement of any kind. The banner is what carries the **FLOOR** — that the set is
heuristic and not exhaustive — so losing it silently lets a **partial caller list read as complete**.

7 of 8 `buildTrustLine` call sites swallowed into a comment-only catch: `callers`, `callees`,
`impact`, `neighbors`, `change_plan`, `preflight`, `explain_diff`. (`trace` was fixed last cycle.)

## ⚠ Weaker than the absence case, and worth saying so

The agent holds positive evidence either way. This is about a set reading as **complete**, not about a
bare absence licensing a deletion. The preregistration explicitly allowed "no change" as an outcome —
a weaker case does not have to be fixed to justify the check. I fixed it because the floor caveat is
precisely the "know when NOT to trust us" contract M2 exists for, and the cost is one constant.

## A second constant, with the reason stated

`ABSENCE_TRUST_UNAVAILABLE` says *"do not read this as evidence of no callers"* — wrong wording on a
result that **did** return edges. The preregistration permitted a second constant provided the reason
was given; this is it. `RESULTS_TRUST_UNAVAILABLE` says the provenance and completeness are unknown
and to treat the set as a floor.

Neither blocks the answer. A banner bug must not take the verb down.

## Controls — three ways this probe could have been vacuous, all excluded

- The real banner is confirmed to carry a `TRUST` marker at all (else its absence means nothing).
- The induced fault is asserted to **fire** (a mock that failed to apply would show healthy output
  and read as "fails closed").
- The query is asserted **not** to have taken the absence path (otherwise it says nothing about the
  results banner). This one mattered: the fixture's obvious symbols all resolve to ambiguity or
  absence, and `src::shapes::helper` had to be found before the results path could run at all.

## Mutant

Tree committed at `8e0eb4e` before mutating. **B-1** — `callers.js` reverted to swallowing:
**KILLED**, `'EDGE use_helper→src::shapes::helper C…' to match /TRUST: UNAVAILABLE/`.

## ⛔ I corrupted three source files doing this, with a hazard I have written down twice

Applying the fix to the four sites whose replacement contained `'\n'`, I used a **python heredoc**.
The escape was eaten and the string literal was split across a real newline:

```js
} catch { trustLine = '
' + RESULTS_TRUST_UNAVAILABLE; }
```

`callers.js`, `impact.js` and `neighbors.js` were left syntactically invalid. My own standing rule
says: **do not use python heredocs for strings containing backslashes — use Write/Edit.** The site
done via Edit in the same batch was correct.

Caught by running `node --check` on each file rather than assuming the write succeeded, and repaired
with Edit. A separate check — "does every file that USES the constant also IMPORT it" — caught
`explain_diff.js` missing its import, which `node --check` cannot see because a missing import is a
runtime `ReferenceError`, not a syntax error.

## Ceiling

Behaviour under an **induced** fault on one fixture. It does not estimate how often `buildTrustLine`
throws in production, and does not show an agent would act differently — only what it is told.
