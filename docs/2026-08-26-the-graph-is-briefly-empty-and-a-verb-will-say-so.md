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

---

## The reviewer's warning, tested — and the shape it actually took

The review warned that a central throw could be swallowed by helpers that catch DB-open errors and
substitute defaults, manufacturing a second false absence. Tested with a hostile sweep over verb
entry points **derived from exports**, marker set and cleared with the row count asserted in the same
pass: **25 of 40 verbs refuse, naming the rebuild. Zero convert the refusal into "no results."**

The warning was right, but not in the form either of us predicted. Three findings:

**1. My own coverage claim was false.** I wrote that every reader opens through `openExistingDb`.
`census.js:128` opened through `openDb` — the *writer* seam — and so never met the guard at all. It
answered 2,922 bytes of counts under a set marker while 24 other verbs refused. A census is a claim
about what exists, so it is the worst possible verb to answer from a half-built graph. It only ever
called `db.all()`, so the writable handle was wrong on its own terms. Switched, and the population
moved 24 → 25 by measurement, not assumption.

**2. Three blanket `catch {}` sites absorbed the refusal** — `packet.js:606`, `packet.js:895`,
`packet-symbol.js:111`. Each was written for a real reason ("never block the packet on evidence
lookup", "never make orientation fail"), and each was right about the case it was written for. None
of them distinguished a slow lookup from a graph that had just been emptied.

**3. The one that matters: an honest producer, a laundering consumer.**
`graph_consequences` refuses correctly and returns the refusal *as prose*. `graph_packet` reached
`else if (typeof raw === 'string')`, filed that prose as its consequences payload, and its renderer
printed **`STATUS: known to graph`** — an existence claim assembled out of a refusal.

⇒ The guard fired. The producer was honest. The consumer inverted it into the opposite claim. Nothing
was caught or dropped; a refusal was simply indistinguishable from data because both are strings.
**A refusal that a consumer can read as data is not a refusal.** Closed by exporting the banner from
the producer so the consumer matches the producer's own literal rather than a copy that drifts.

⚠ **My first "0 swallowed" reading was too narrow and I am correcting it here.** The sweep asked only
whether the refusal became a literal "no results", so it scored packet as fine. It also counted
argument-validation errors as substantive answers, which meant `graphExplore`, `graphPacket` and
`graphPull` were never exercised at all — they were listed as benign while never having run. Given
valid arguments, two refused and one did not. **A verb that rejects my arguments has told me nothing
about the question I asked.**

Evidence: 11 tests, 8 mutants killed across both rounds. Full suite green — 388 files, 3,152 passed,
4 skipped, exit 0, 510s. The remaining 15 non-refusers are the 7 LSP-backed `codeIntel*` verbs, which
do not read the graph tables, plus `graph_index` and `graph_collect_code_intel`, which must run
during a rebuild by definition.

---

## Closed: one transaction for the whole rebuild

Both findings at the top of this document are now closed, and the interim marker guard has been
**deleted** rather than kept.

### What changed

`RebuildTransaction` (`mcp/stdio/storage/rebuild-transaction.js`) owns one `BEGIN IMMEDIATE` around
the entire rebuild. The wipe, every extraction chunk, resolution, virtual overrides, doc links and
doc refs all land inside it, and a single `COMMIT` publishes them together. The extraction loop's
per-chunk failure isolation is preserved by savepoints: `ROLLBACK TO` discards one chunk without
discarding the rebuild, which is what the old `COMMIT`/`BEGIN` pair bought — minus the publishing.

`db.transaction(fn)` could not do this: better-sqlite3 transaction functions are synchronous and a
rebuild awaits filesystem, extraction and LSP work throughout. A transaction is a property of the
connection, not of a callback, so the boundary is issued directly and one object owns its lifecycle.
The nested `db.transaction()` calls inside the span keep working unchanged — better-sqlite3 converts
them to savepoints automatically once a transaction is open.

The doc-link miss sidecar was moved past the commit. Written where it was, it would have described
doc links that a rollback discards: a durable file asserting a state the database never reached.

### Measured

Same subject, same probe, controls in the same pass. The control that matters is that the rebuild
**changed** something — with an identical before and after count, a constant reading would have
proven nothing:

| | before this change | after |
|---|---|---|
| distinct edge counts seen by a concurrent reader | `[8306, 0, 30, 1594]` | `[8317, 8324]` |
| samples reading ZERO | 12 of 195 | **0 of 204** |
| values that were neither complete state | 3 | **0** |
| `graph_callers` empty-answer leaks | 2 of 3 runs | **0 of 2 valid runs** |

Cost, measured rather than argued: peak `-wal` **5.5 MB against a 5.5 MB database** — proportional to
the rebuild and released at commit — and 6.0s wall time. Crash safety: a `SIGKILL` delivered **with
5.5 MB of uncommitted WAL in flight** left the previous graph intact at exactly 8,324 edges.

### The marker was removed, not kept

Once the rebuild is atomic, a marker written inside that transaction can never be seen by another
connection. Measured: **364 samples of a real rebuild, the marker never once observable**, while the
positive control confirmed the probe could see one set by hand.

⇒ The guard shipped in `cee5ac6` could no longer fire. An unreachable guard that looks like
protection is worse than none — this repository has been bitten by that exact shape three times — so
the marker, its table, the `openExistingDb` refusal, the `read_freshness` branch and the packet
laundering plumbing were all deleted. What replaced it is a test of the real mechanism: every
assertion in `rebuild-transaction.test.js` observes from a **second connection**, because what the
writer's own handle sees was never the question.

`census.js` keeps its move from `openDb` to `openExistingDb`. That was correct on its own terms — a
verb that only calls `db.all()` should not hold a writable handle — independent of any guard.

### Two probe failures worth keeping

⛔ **A kill test that proved nothing.** The first crash-safety run killed the rebuild after a fixed
4 seconds and reported the graph intact. Peak WAL for that run was **0.0 MB** — nothing had been
written yet, so the graph survived because there was nothing to survive. The fix was a precondition:
kill only once more than 1 MB of WAL is in flight, and print whether that precondition held.

⛔ **A verb race against a rebuild that never ran.** Three runs reported `EDGESx2112` with no
refusals, which read like a product improvement. The rebuilds had exited **1** — an earlier `SIGKILL`
left a stale write lock, and every run failed on it after burning the retry budget. The probe now
prints the child's exit code and marks a non-zero run VOID. With real rebuilds the sequence is
`EDGESx4 -> REFx2416 -> EDGESx2` and no empties. **An exit code I did not look at is an experiment I
did not run.**

### Mutants that survive, stated rather than implied

Four of six killed. `commitChunk` doing a real `COMMIT` initially **survived**, because the assertion
counted rows and the count is 1 in both worlds; it was rewritten to assert *which* node an outside
reader sees, and now kills it. Still surviving: omitting `RELEASE` after `ROLLBACK TO` (a savepoint
stack leak — a resource cost, not a behaviour change) and using deferred `BEGIN` instead of
`BEGIN IMMEDIATE` (a two-writer collision property a single-connection test cannot observe).

---

## The refusal outlived its reason

`read_freshness` deferred every verb for the whole rebuild on manifest status `indexing`. That was
correct while a rebuild published in pieces — a reader past its guard could land on an emptied table.
Once the rebuild became one transaction, the justification went with it, and the refusal was left
standing on a premise that was no longer true.

**The refusal was triggered by an event that changes nothing about the data being read.** One second
before a rebuild starts, that same snapshot is served without complaint; a rebuild beginning in
another process does not retroactively make the previous graph less true. And it is now a *complete*
graph, not a torn one.

Staleness still does its job underneath: the manifest carries the OLD commit until the rebuild
commits, so a graph genuinely behind HEAD is still reported behind, and `staleNotFoundCaveat` still
qualifies every "not found" built on it. Nothing about absence claims got weaker — the same caveat
machinery runs on the same inputs.

⛔ **One case still refuses, and it is the case this whole arc was about.** A first-ever index has
nothing committed, so the snapshot a reader would receive is EMPTY, and answering "no callers" out of
an empty graph is exactly the false absence being eliminated. That branch fails closed:
`alreadyIndexedFiles` is `null` when the count could not be taken at all, and `null` does not pass a
`> 0` test.

Measured against a real rebuild (child exit 0 asserted, so the race is not against a rebuild that
never ran):

| | before | after |
|---|---|---|
| verb behaviour during a rebuild | `REFx2416` — refused every call | `EDGESx82` — answered every call |
| empty-answer leaks | 0 | 0 |

The call count falls because each call now does real work instead of returning a cheap blocker.

Four tests, three mutants killed (blanket refusal restored; an unknown file count treated as
servable; the warning dropped). Full suite green: 389 files, 3,152 passed, 4 skipped, exit 0.

⚠ **The repo's own guard caught me on the way in.** My positive control used a bare `not.toMatch`,
and `negative-assertions-are-controlled` failed the suite for it — baseline 154, mine made 155. It
was right: a silent matcher proves nothing until it has been shown it can fire and that it does not
fire on neighbouring text. Converted to `expectAbsentWithLiveMatcher`.
