# Results, test 3: the bar passes formally on one flag, which is no evidence at all

Graded 2026-09-18 against `PROTOCOL-3.md` (daf8a58b, before any test-3 output). The grades below are the
independent blind grader's, not mine.

## Numbers

| | Result |
|---|---|
| Population | 36 docs, 537 notes, 145 notes with an anchor, 340 anchors |
| Status labels (two blind labellers, split by doc) | 474 current, 63 history, 0 unclear |
| Flags | 12 in total; 8 on current notes (1 GONE, 7 DEAD_NAME). All 8 graded. |
| Volume | 7 current notes flagged of 145 anchored = 5% (bar: at most 25%) |
| GONE precision (Q1 TRUE) | **1 of 1** (bar: at least 50%) |
| DEAD_NAME pointer really dead (Q2 NO) | **2 of 7 = 29%** (bar: at least 90%) |
| DEAD_NAME substance (Q1 TRUE, reported only) | 0 of 7 |

## Decision

- **GONE warnings: the registered bar passes, and I do not build on it.** One graded flag cannot tell 100%
  from 20%. The protocol set no minimum sample, which is a gap in how I wrote it, not a licence. The honest
  reading is: **no result on GONE**.
- **DEAD_NAME hints: fail.** 5 of 7 pointed at names that are live. Not built.

## What the run did show

1. **The one GONE flag was real.** AGENTS.md:98 said `deprecation-probe.js` maps `graph_report` to the brief.
   That file was deleted in 1b9784fd. The advice around it still held. Fixed in the commit after these results.
2. **Two of the v2 detector fixes combine badly.** Counting an object key as a definition (`name: ...`),
   plus scoping anchors to the defining file, made a lookup-table entry in `deprecation-probe.js` and a
   JSON-schema key in `server.js` count as the "home" of `code_intel_replay`, `code_intel_analyze` and
   `waitForReadyMs`. When those files changed, the names read as dead while they are live in `schema.js`
   and the verb files. Three of the five false DEAD_NAME flags are this.
3. **`HEAD` is a git ref, not a symbol.** Two false flags matched it to a constant named `HEAD`. A
   name-matcher cannot tell prose words that happen to be uppercase from code names.
4. **The zeros are real.** S1r, S3a and S4a fired nothing on this repo. Controls, same session:
   - v3 run against the aify-comms corpus fires S3a/S4a on all six known cases;
   - a made-up name returns nothing (`control-orphan-4.txt`);
   - across 14 production-file deletions in APG's history, every symbol they used still had another
     user (`control-orphan-2.txt`, `-3.txt`).

## The limit that matters most

**The detector cannot see most of what these docs talk about.** Of 2,956 backticked tokens, 340 are
anchors. The docs are mostly about the tool verbs (`graph_packet`, `code_intel_references`: 404 tokens,
45 distinct names), and only 11 of the 45 match a definition pattern, because a verb is a string in a
schema, not a function (`coverage.txt`). A quiet result on this repo is mostly blindness, not freshness.

A name-and-grep detector is the wrong instrument for the thing Steven asked for. The connection a warning
needs, "this note is about that verb, which is implemented by that file", is a graph edge. Whether APG's
current graph links a verb name to its handler I have not checked. If this is pursued, the next step is to attach notes to graph nodes
and let the edge carry the warning, not a fourth grep variant.

## Across the three tests

| Test | Repo | Status filter | Precision (independent) | Volume |
|---|---|---|---|---|
| 1 | aify-comms | no | 27% | 13% |
| 2 | aify-comms | yes | 44% (mine 56%) | 8% |
| 3 | APG | yes | GONE 1/1; DEAD_NAME 0/7 | 5% |

The one finding that has held in all three: **a note status (current or history) is required**, and
without it most warnings land on notes that already say they are history.

## Files

- `detect_v3.py`, `build_packet.py`: the detector and the filter/sampling step.
- `flags.jsonl`, `stats.json`, `filter-summary.json`: detector output and the filter.
- `labels-1.json`, `labels-2.json`: blind status labels.
- `packet.json`, `grades.json`: what the grader saw, and its grades.
- `controls.txt`, `control_orphan.py`, `ctl2-4.py`, `control-orphan*.txt`: the instrument controls.
- `coverage.py`, `coverage.txt`: how much of the docs the detector can see.
