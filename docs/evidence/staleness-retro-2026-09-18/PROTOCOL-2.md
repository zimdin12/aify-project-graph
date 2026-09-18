# Test 2: does a note STATUS make the code-change warning precise?

Pre-registered 2026-09-18, after test 1 (`RESULTS.md`) and before any test-2 output. Steven approved it
("then you can do it"), to run once mc-manager reports the CPU is clear.

## Why

In test 1, 30 of the 33 false flags were notes that already said they were history. Steven's design
gives every note a status and a confirmed-at date. This test asks whether the warning, limited to notes
whose status is **current**, reaches the precision bar that test 1 missed.

## What is reused unchanged

The same corpus (aify-comms @ 7678acf3), the same 31 docs and 494 notes, and the same 87 flags from test
1 (`flags.jsonl`). Rules S1, S2, S3a and S4a are the amended variant; its flags are the ones reused. No
detector change: the question is only what a status filter does to the flags that already exist.

## Status labels, assigned blind

A fresh subagent labels EVERY note (all 494, not only flagged ones) from the doc text alone. It is never
shown the flags, the grades, test 1's results or this repository's evidence. Its labels:

- **history**: the note, its section heading or a banner covering it says the content is deleted,
  superseded, resolved, retired, or a record of the past, or it narrates past events in past tense.
- **current**: it describes how things work now, or states an open item.
- **unclear**: it cannot tell.

This stands in for agents maintaining a status layer, which is Steven's design. A labeller that saw the
grades would reproduce them, which is why it is blind.

## Measure

Among the amended variant's flags whose note is labelled **current**:

1. **Precision** on graded flags. Flags already graded in test 1 keep their grades. Any current-labelled
   flag not graded in test 1 is graded fresh, by the same TRUE/FALSE/UNCLEAR definition, before the
   precision is computed.
2. **Recall of known stale content:** of the 14 TRUE flags from test 1, how many survive the filter.
   A filter that drops real stale notes is not free.
3. **Volume:** current notes flagged, as a share of anchored notes.

## Decision

The status-filtered warning is worth building in APG (notes with a status and a confirmed-at date, plus
a commit-time warning over current notes) only if:

- precision among current-labelled flags is at least 50%, and
- at least 10 of the 14 known TRUE flags survive the filter (recall at least 70%), and
- volume stays at most 25% of anchored notes.

Otherwise report and do not build. A pass licenses that thin layer, not a general layer engine.

## Limits recorded before the run

Test 1's grades were mine and are reused. The labeller is one agent run. The TRUE set is the 14 from test
1's sample, so recall is measured only on flags that were sampled. The 38 amended flags outside both
samples are graded only if they land in the current set.
