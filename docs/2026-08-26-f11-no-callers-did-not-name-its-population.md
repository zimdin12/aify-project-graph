# F11 — "NO CALLERS" and "CALLERS 1 total", same symbol, same graph

## What was actually wrong — and it was not the thing I set out to check

F11 entered the queue as *"`graph_callers("c_str")` on fmt's most-called symbol returns ZERO
callers"*, with an earlier measurement claiming 50–60% of high-traffic symbols return no callers.

**That claim does not survive contact with the verb.** `graph_callers("c_str")` returns:

    AMBIGUOUS MATCH for "c_str". 6 concrete candidates found:
    - include::fmt::compile::static_format_result::c_str  include/fmt/compile.h:580
    - include::fmt::format::utf8_to_utf16::c_str          include/fmt/format.h:1351
    ...
      ⚠ SHOWING 5 OF 6 — 1 candidate(s) omitted. …
    Retry with a qualified symbol (Class::method / Namespace::Class::method) …

That is a **correct refusal**: it names the ambiguity, lists candidates with locations, discloses
its own cap and the risk that cap carries, and gives a retry path. It never asserts a caller count.

⛔ **The earlier number counted rendered caller lines**, and a refusal renders zero of them — so
refusals were scored as absences. Re-measured with a classifier that separates the three outcomes:

| arm | high-traffic (top 15) | low-traffic (exactly 1 incoming) |
|---|---|---|
| fmt | refused 9, answered 6, zero 0 | answered 13, refused 2, zero 0 |
| click | refused 7, answered 8, zero 0 | **zero 8**, answered 6, refused 1 |
| fast-route | refused 5, answered 9, zero 1 | answered 14, refused 1, zero 0 |
| p-queue | answered 12, zero 3 | **zero 9**, refused 2, answered 4 |

⇒ High-traffic symbols are not silently returning zero; they are **refusing**, which is right. The
empty answers cluster in the *opposite* stratum — and that is where the real defect was.

## The real defect

Four symbols picked from that low-traffic cluster, checked against the store:

    graph_callers("Class2")    ->  NO CALLERS for "Class2"
    graph_preflight("Class2")  ->  CALLERS 1 total

Same graph, same symbol, same word, opposite answers. The store holds
`test_flag_value_not_stringified_for_custom_types --REFERENCES--> Class2`.

Neither verb is wrong about its own question. `graph_callers` walks `EXECUTION_FAMILY`
(CALLS / INVOKES / PASSES_THROUGH); `graph_preflight` counts `CALL_FAMILY`, which adds REFERENCES.
Both are deliberate. **The defect is that neither named its population**, so the reader cannot
reconcile them — and the narrower one phrased its result as the dangerous absence claim.

The existing trust caveat does not cover this. It speaks about **evidence depth** — *"heuristic and
NOT exhaustive, verify with rg"* — never about **relation scope**. A reader learns the list may be
short; they never learn a whole relation was never consulted, or that the graph already holds the
answer.

⇒ This is the LINKS_TO precedent recorded in `taxonomy.js` — *"nothing in the receipt could tell
'the list was cut short' from 'a source was never consulted'"* — committed again in a second verb.

**Population, measured through the verb:** 381 labels across the four arms carry a REFERENCES edge
and no execution edge — click 272, fast-route 68, p-queue 26, fmt 15.

## The fix

- `graph_callers`'s absence branch now appends a SCOPE line naming what it searched, what it did
  not, and the count the graph holds:

      SCOPE: this verb searched the strict call graph (CALLS/INVOKES/PASSES_THROUGH) and did NOT
      search REFERENCES — of which this graph holds 1 REFERENCES pointing at "Class2". So "no
      callers" here does NOT mean "nothing uses it" — graph_impact answers "who touches this"
      across the wider family.

  The skipped set is **derived by subtracting one family from the other**, never listed, so a
  relation joining `CALL_FAMILY` is covered with no edit here.

- `graph_preflight`'s four hand-written relation lists now come from `taxonomy.js` — three were
  `CALL_FAMILY` spelled out, and the fourth was a near-miss of `IMPACT_FAMILY` that omitted
  INVOKES, PASSES_THROUGH and OVERRIDDEN_BY, so the "impact by type" rollup under-reported the
  blast radius it is named for.

⚠ It reports a **count and a pointer**, never the edges. Widening what `graph_callers` returns would
make it a different verb; the defect is the silence, not the scope.

## Evidence

**473 NO-CALLERS answers examined across four arms, both error directions zero:**

| arm | examined | wider edges exist → SCOPE / missing | none exist → silent / false positive |
|---|---|---|---|
| click | 101 | 44 / **0** | 57 / **0** |
| fmt | 253 | 2 / **0** | 251 / **0** |
| fast-route | 72 | 9 / **0** | 63 / **0** |
| p-queue | 47 | 20 / **0** | 27 / **0** |

Both populations are non-empty on every arm, so the instrument can return either answer.

**5 mutants, 5 killed**, each verified to have applied: the note never appended · the note computed
after the await · the unsearched set hardcoded empty · the note fired unconditionally · preflight
narrowed back to the strict call graph.

**Suite: 369 files, 2,985 passed, 4 skipped, 0 failed.**

## ⛔ Four self-inflicted errors, and two were caught only by controls

1. **A fail-silent feature that was completely inert.** The scope note read the database *after* an
   `await`. Callers `return` the async function's promise, so the enclosing `finally { db.close() }`
   had already run — every call threw *"The database connection is not open"* and the `catch`
   returned `''`. **The output was byte-identical to having no feature at all.** Only removing the
   catch revealed it. A test now asserts the line is PRESENT, and a mutant restores the bug.

2. **A negative control that examined ZERO symbols.** I defined it as "labels with no edges at
   all" — but every node has an inbound DEFINES edge, so the population was empty. It printed a
   clean pass over nothing. Redefined as "has edges, none in either family": 29 of 29 correctly
   silent.

3. **Three false positives that were my instrument, not the code.** The control defined its
   population by single node id; `graph_callers` expands a class label to the class *plus its
   methods*, and one method genuinely held 9 REFERENCES edges. The verb was right. Fixed by having
   the control call `expandClassRollupTargets` — the verb's own resolver.

4. **A remedy naming a verb the reader cannot call.** The first draft offered `graph_preflight`,
   which the default tool profile does not list. The repo's own remedy-reachability guard failed the
   suite for it. It now names only `graph_impact`.

⇒ Errors 1 and 2 are the same shape from opposite sides: **a thing that cannot speak and a check
that cannot fail look exactly like success.** Error 3 is the mirror — a check that fails for a
reason that is not the code's.
