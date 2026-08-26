# The graph is briefly empty, and a verb will say so

2026-08-26. The roadmap carried this as an open, unchased note:

> ⛔ **STILL OPEN from 6b's ⚠ clause:** a raw sqlite reader still gets **no** read-consistency
> signal. Two reads minutes apart returned 0 and 2,369 edges.

It was filed as a *missing signal*. It is not. There is a window during a full rebuild in which the
database genuinely contains a wrong answer, and a first-party verb will report that answer as fact.

Both findings below were executed, not read. Controls ran in the same pass.

## 1. A concurrent raw reader observes an empty graph — PROVEN

Subject: an isolated 194-file repository, indexed to a settled 2,230 nodes / 8,306 edges. A forced
rebuild ran in one process while a raw `better-sqlite3` reader polled `SELECT COUNT(*) FROM edges`
every 20ms in another.

    POSITIVE CONTROL  settled raw edge count : 8306   (the probe can see rows)
    NEGATIVE CONTROL  empty-table raw count  : 0      (the probe can say ABSENT)
    samples taken while the rebuild ran      : 195
    distinct values observed                 : [8306, 0, 30, 1594]
    samples reading ZERO edges               : 12

⇒ Not merely a read-consistency gap. The reader sees a **torn** graph at any count between empty and
complete. `orchestrator.js:426` runs `DELETE FROM edges; DELETE FROM nodes;` in autocommit, outside
the write transaction that opens at line 450, so the wipe is durable and visible long before the
repopulation lands.

⚠ **The obvious repair is wrong.** Moving the wipe inside `batchInsert` only converts "reader sees 0"
into "reader sees 30" — that transaction inserts special nodes only; the bulk of the graph lands in
later transactions. That moves the error instead of removing it, so it was not shipped.

## 2. A first-party verb leaks a confident EMPTY answer — PROVEN, reproducible

`read_freshness.js:166` returns a blocker when the manifest says `indexing`, and the orchestrator
writes that status *before* it mutates the database. The ordering is right, so this looked safe on
inspection. Racing a real `graph_callers` against a real rebuild says otherwise:

    run 1  EDGESx2 -> EMPTYx1 -> REFx3365 -> EDGESx2    empty at i=2, manifest 'indexing'
    run 2  EDGESx3 ->            REFx3333 -> EDGESx2    (no leak this run)
    run 3  EDGESx3 -> EMPTYx1 -> REFx3251 -> EDGESx1    empty at i=3, manifest 'indexing'

Controls, same pass: the settled answer rendered edges, and a nonsense symbol returned an empty
answer — so the probe could report both PRESENT and ABSENT.

⇒ 2 of 3 runs, always in the same position: the **leading edge** of the rebuild. The shape is a
check-then-act race. `inspectReadFreshness` reads the manifest and finds it clean; the rebuild then
writes `indexing` and wipes the tables; the verb, already past its guard, reads the empty database
and renders a caller set of zero. No warning, because the guard already ran.

**This is a false absence in the answer class the project exists to make trustworthy.** Rare — one
call in roughly three thousand, and only against a concurrent rebuild — but "nothing calls this
symbol" is the one answer whose cost does not scale with its frequency.

## Why this cannot be fixed verb-by-verb

`inspectReadFreshness` has 59 call sites across 25 files, and `openExistingDb` has 118 across the
repository. A remedy applied at the call sites is an enumeration I would get wrong, and the standing
rule is to derive rather than list. The seam is that every reader opens through the one
`openExistingDb`, while the rebuild writes through `openDb` — so a fail-closed check on the reader
seam cannot deadlock the writer that sets it.

The design question that remains is whether the check can be made airtight rather than merely narrow,
and that is recorded in the next section rather than assumed.

## Open, and deliberately not yet built

A marker written into the database inside the same transaction as the wipe, checked when a reader
opens, narrows the race from `[manifest check -> read]` (milliseconds, and it includes git calls) to
`[open -> first read]` (microseconds). **It narrows; it does not eliminate.** A reader that opens
before the wipe and selects after it still sees the empty table.

Eliminating it needs the marker and the data to come from one snapshot — under WAL, pinning a read
transaction at open would do it, at the cost of holding a snapshot for the life of the handle. That
is a real trade on a seam with 118 call sites, so it goes to review before it goes in.

Nothing here is claimed as fixed. What is claimed is that the window is real, that it is reachable
from a first-party verb, and that the measurement is reproducible.

---

## Review ruling, and what was built

An outside review answered the three asks. Two of its claims were checked rather than accepted:

- **Option B is dead, on concrete grounds.** `collect_code_intel.js:333` opens the reader seam with
  `readonly: false` — verified, and it is the only such site. Pinning a WAL read snapshot on every
  handle would make that write-capable path fail with `SQLITE_BUSY_SNAPSHOT`. B was rejected for a
  reason stronger than the WAL-growth worry I raised.
- **The preferred closure is C, not A:** one outer `BEGIN IMMEDIATE` across the whole full rebuild,
  with `SAVEPOINT`s preserving per-chunk failure isolation, so a raw reader sees the complete old
  graph until COMMIT and the complete new one after. That closes both findings without depending on
  marker timing, manifest timing, or caller discipline.

**What is committed here is A, and A NARROWS THE WINDOW WITHOUT CLOSING IT.** A handle opened before
the wipe that selects after it still reads the empty tables. That is the honest label, and it is not
a closure of either finding above.

Built: a marker written into the database inside the same transaction as the wipe; a fail-closed
refusal at `openExistingDb`; a graceful blocker in `inspectReadFreshness` so the normal path gets a
message rather than an exception. The refusal names cause, age, holding process and remedy, because a
bare closed door teaches people to route around the guard.

Evidence: 7 unit tests, all four mutants killed (guard disabled, marker always null, remedy line
removed, clear made a no-op). Full suite green at this tree — 388 files, 3,148 passed, 4 skipped,
exit 0, 476s.

⚠ **The suite's green says nothing about the marker path.** No pre-existing test sets the marker, so
the run proves only that the marker-absent path is unbroken.

## Open, and honestly unfinished

1. **C is not built.** It is the preferred fix and it is the one that would let either finding be
   called closed.
2. **The reviewer's swallowed-throw warning is UNTESTED.** The concern is that helpers which catch
   DB-open errors and substitute zeros could convert this refusal into a second false absence. A
   hostile sweep across every derived verb entry point was written and **timed out at ten minutes
   without returning** — so the answer is unknown, not clean. It must be re-run before A is trusted.
3. **The residual race is unproven.** The reviewer rightly demands a negative control: open a handle
   before the wipe, cross it, then select. If that test comes back green, the "narrows only" claim is
   wrong in one direction or the test is void.
4. `allowDuringRebuild` is a broad boolean, which is the shape that becomes a permanently-set flag.
   The review asks for a named diagnostic capability with zero callers if possible; currently only
   `read_freshness` uses it, and `graph_health` was measured still answering without it.
