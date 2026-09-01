# PREREGISTRATION — M1's C++ caller-set arm, written before the compile DB exists

M1's stop condition is *"a same-name-different-symbol fixture proves the sets do not merge"*. That
was met for **JS/TS** (`alpha.Widget.render → ["alphaCaller"]`, `beta → ["betaCaller"]`, disjoint).

**The C++ arm has never run.** `tests/fixtures/identity-callers` has no `compile_commands.json`, so
clangd has no index, method calls land on `External` stubs, and the caller sets are empty. Every C++
statement in this arc therefore rests on identity (decl/def collapse) and not on caller sets.

## Population

The existing C++ fixture, unchanged: `callers.cpp`, `widgets.cpp`, `widgets.h` — two namespaces
(`alpha`, `beta`), each with a `Widget::render`, each called from its own caller. Plus a generated
`compile_commands.json` so clangd can index it. clangd 22.1.6, Windows.

## Preregistered dispositions — fixed BEFORE the run

- **A — sets DISJOINT and correct.** `alpha::Widget::render → {alphaCaller}` and
  `beta::Widget::render → {betaCaller}`, neither containing the other's caller. ⇒ M1's C++ arm
  closes, matching JS.
- **B — sets NON-EMPTY but MERGED.** Either query returns both callers. ⇒ name-keyed fanout in C++;
  M1's C++ arm FAILS and the defect is named, not explained away.
- **C — sets still EMPTY with clangd indexing.** ⇒ a REACHABILITY defect between the C++ spine and
  `graph_callers`, **not** evidence about identity.

⛔ **C MUST NOT BE REPORTED AS "the sets do not merge".** Two empty sets trivially do not merge.
That is the vacuous pass this project has produced before, and the whole reason the positive control
below exists.

## Controls, required in the same pass

- **POSITIVE (on the zero):** the collection must import **> 0 records** and create **> 0 CALLS
  edges**. If it does not, clangd did not index and every downstream absence is about the
  collection, not the graph. Disposition C is only assignable once this passes.
- **NEGATIVE:** `alphaCaller` must be ABSENT from beta's set and vice versa. Without it, "disjoint"
  could pass on a matcher that finds nothing.
- **IDENTITY:** the qualified query must resolve to ONE candidate (the decl/def fix, shipped at
  `6372aae`). If it returns `REFUSED_AMBIGUOUS`, the run never reached the caller-set question.

## Claim ceiling

One fixture, one compiler, one platform, three files. This can show the mechanism works or does not
work for C++. It says **nothing** about prevalence in real C++, nothing about virtual dispatch,
templates, macros or conditional compilation, and nothing about scale — that is M5's question.

## Abandon rule

If clangd cannot index the fixture (positive control fails) after one honest attempt at the compile
DB, the arm is reported as **STILL UNTESTED** with the reason. Fabricating a pass by loosening the
fixture until something green appears would be worse than leaving the gap open.
