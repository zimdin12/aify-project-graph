# The sweep after F11 — one fix is not a sweep

F11 fixed `graph_callers`: an absence claim that never named the relation family it searched. The
obvious next question is the one this repo keeps having to be forced to ask — **where else?**

## Preregistered, and two of three candidates were abandoned

> **Claim:** other verbs emit absence claims from a narrowed relation family without naming it.
> **Abandon rule:** a verb whose absence message already names its family, or which searches the
> widest family so nothing is unsearched, is not a finding — say so and move on.

Enumerated by relation family across all 20 verb files, then measured through each verb:

| verb | family searched | verdict |
|---|---|---|
| `graph_callees` | `EXECUTION_FAMILY` | ⛔ **DEFECT** — exact mirror of `graph_callers` |
| `graph_impact` | `IMPACT_FAMILY` | ✅ not a defect |
| `graph_neighbors` | `NEIGHBOR_FAMILY` (all relations) | ✅ nothing unsearched — but see the caveat |

**`graph_impact` — abandoned for a real reason.** On click, 28 of 28 `NO IMPACT` symbols did hold
edges outside `IMPACT_FAMILY`. Naming them settles it:

    DEFINES   28      a file defines the symbol
    CONTAINS  12      a module contains it
    IMPORTS    1

Structural containment is not blast radius. Excluding it is correct, and `IMPORTS` at n=1 is noise.
Had I stopped at "28 of 28 have unsearched edges" this would have been filed as a defect.

**`graph_neighbors` — abandoned, but the control is empty and that is stated rather than glossed.**
It searches every relation, so nothing is unsearched by construction. It also produced **zero**
absence claims in the sample, so its population is empty and it cannot be reported as a *passing*
control either. An empty control proves nothing in either direction.

## The one real finding

`graph_callees` is `graph_callers` mirrored onto outgoing edges, with the identical narrowing and
the identical silence. Measured on click before the fix: **71 of 88 `NO CALLEES` answers (81%) had
unsearched outgoing edges.**

## One owner, not a pasted copy

The note now lives in `mcp/stdio/query/unsearched-scope.js` and both verbs call it with a direction.
That is not tidiness: `graph_callees` was only fixed because the sweep went looking for the mirror,
and two copies is exactly how the next relation added to `CALL_FAMILY` reaches one verb and not the
other.

⚠ **The closing clause is direction-specific**, because the two absences license different mistakes:

    incoming (callers)   "…does NOT mean 'nothing uses it'"   → a wrongly-safe DELETE
    outgoing (callees)   "…does NOT mean 'it uses nothing'"   → a wrongly-isolated symbol

A single shared phrasing would be wrong for one of them. A mutant collapsing them to one is killed.

⚠ **The remedy differs too, and for a reachability reason.** `graph_callers` names `graph_impact`
(listed in the default 16-tool profile). `graph_callees` names `graph_neighbors`, which is *not*
listed — permitted only because `graph_callees` is not listed either, and the repo's invariant is
that a **listed** verb must not name an **unlisted** one.

## Evidence

**308 NO-CALLEES answers examined across four pinned arms, both error directions zero:**

| arm | examined | wider edges exist → SCOPE / missing | none → silent / false positive |
|---|---|---|---|
| click | 86 | 56 / **0** | 30 / **0** |
| fmt | 147 | 0 / **0** | 147 / **0** |
| fast-route | 45 | 36 / **0** | 9 / **0** |
| p-queue | 30 | 13 / **0** | 17 / **0** |

fmt's 0 is a genuine zero — its symbols carry no outgoing REFERENCES — and the other three arms are
non-zero, so the instrument demonstrably returns both answers.

⚠ The control resolves symbols the way the verb does (`resolveSymbol` → `selectBestRoot`). Keying on
a raw label instead measures a different node, which produced three phantom false positives during
the F11 work.

**8 mutants, 8 killed**, each verified to have applied: owner inert · direction phrasing collapsed ·
fires unconditionally · direction word collapsed · callees drops the note · callees computes it
after the await · callees queries the wrong direction · callers drops the note.

**Suite: 369 files, 2,989 passed, 4 skipped, 0 failed.**

## ⚠ Notes for the next pass

- `file.js` (2), `module_tree.js` (2) and `report.js` (1) still carry hand-written relation lists
  rather than taxonomy families. None of them makes a *symbol-level absence claim*, so they are not
  this defect — but they are the same drift risk that let `preflight` and `graph_callers` disagree.
- The backslash-through-the-shell trap hit twice more here. A `\n` inside a python heredoc arrives as
  a real newline, so the replacement silently matches nothing and the assertion catches it only if
  one is written. `Edit` is the reliable tool for anything containing a backslash.
