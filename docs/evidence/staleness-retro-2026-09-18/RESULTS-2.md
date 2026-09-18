# Results, test 2: a note status makes the warning much better, but not clearly good enough

Graded 2026-09-18 against `PROTOCOL-2.md` (5a64471c, before any test-2 output).

## Numbers

| Bar | Result |
|---|---|
| Recall: at least 10 of the 14 known-true flags survive the filter | **pass**: 13 of 14 (93%). The one lost (#58) sits under a "Superseded" heading whose own supersession note was stale. |
| Volume: at most 25% of anchored notes flagged | **pass**: 27 of 323 (8%) |
| Precision: at least 50% true among flags on current notes | **my grades: 24/43 = 56%, pass. Independent blind regrade: 19/43 = 44%, fail.** Both graders call 18 true (42%). |

The status filter dropped 43 of 86 flags. A blind labeller marked the notes they sit in as history, from the
doc text alone.

## Why I do not call it a pass

The protocol registered my grades as the grades. After grading, I ran an independent regrade because the
margin was two flags and I had graded 24 of the 43 after knowing test 1's result. The regrader works
blind: it never saw my grades or the expected answer, and it read the code itself. It disagrees on 10
flags, and the result falls on opposite sides of the bar. A pass that depends on who grades is not a pass,
so the honest reading is **borderline**.

Most of the disagreement is one kind of case: **a note names a function that no longer exists, but the
same mechanism survives under a new name** (#53, #54, #56: `createPiController` became `PiController`).
I graded those TRUE, because an agent grepping the name finds nothing. The regrader graded them FALSE,
because the substance still holds. The docs' owner, comms-tech-lead, treated this kind of item as worth
fixing: of the test-1 items it corrected in ca612584, several were exactly this. That is one data point
on policy, not a grade.

## What the evidence does support

- **A status on each note is the single biggest lever.** Test 1 with no status: 27% precision, 0 of 3
  known cases. Test 2 with a status: 42-56% precision, depending on the grader, and 93% of known stale
  content kept, at 8% volume.
- **Five false flags are detector misses, not design limits:** import aliases (`from x import f as _f`),
  an object property, and a generic word. Both graders agree on these.
- **The warning needs two classes, not one:**
  - "this note describes something that is gone", clearly stale;
  - "this note uses a name that no longer exists", a dead pointer where the substance may hold.

  Both graders agree on the first. The disagreement is entirely about the second.

## Decision

Not built on this evidence. The next step, if Steven agrees, is one more pre-registered run:
- fix the detector misses;
- split the two warning classes;
- run on a different repository;
- have an independent blind grader grade it from the start, with the rename policy fixed in advance.

## Files

- `labels-1.json`, `labels-2.json`: the blind status labels, 494 notes.
- `grades-2.json`: my grades.
- `regrades.json`: the independent grades.
- `test2-rows.json`
