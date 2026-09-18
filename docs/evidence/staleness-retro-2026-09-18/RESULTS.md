# Results: a code-change staleness rule, run as registered, is too noisy to build

Graded 2026-09-18 against `PROTOCOL.md` (pre-registered in ba873b14, amendment A in 76c37b95, both
before any population output). Corpus: aify-comms @ 7678acf3, 31 trusted docs, 494 notes, 323 of them
with at least one anchor, 1,745 anchors.

## The decision, as registered

**Do not build it.** Both variants fail.

| | Registered (S1-S4) | Amended (S1, S2, S3a, S4a) |
|---|---|---|
| 1. Flags K1 and one of K2/K3 | **fail**: none of K1-K3 | K1 only, discounted (the amendment was made knowing K1 fails without it) |
| 2. Precision at least 50% (random 30, seed 20260918) | **fail**: 8/30 = 27% | **fail**: 8/30 = 27% |
| 3. Notes flagged at most 25% of anchored notes | pass: 41/323 = 13% | pass: 43/323 = 13% |

The registered rule cannot see the case that motivated it. Plain grep counts comments as references,
and `terminalChildEnv` and `terminal-env.js` are still named in comments. The amended rule sees K1 but
still misses K2 and K3, because `install.sh` embeds JavaScript whose `//` comment names `terminal-env.js`.

## What the grading found (49 distinct flags across both samples, self-graded)

- **14 true.** Real stale content in docs agents are told to trust, beyond K1:
  - DECISIONS.md names `claude_managed_channel_only` (default false). The setting was renamed with
    inverted polarity (`service/api_core/settings.py:135`).
  - DECISIONS.md says resident pi keeps a `createPiControllerLegacy` path, which is gone.
  - A supersession note says hermes delivery finds the session through `pickSessionForKey`, which has
    no production caller.
  - The roadmap says delegation "is still OFF".
  - Two KNOWN_ISSUES open items concern deleted code: `terminal-runtime.js` keepalive and
    `workspaceWithinRoots`.
- **2 unclear.** Both count against precision.
- **33 false.** The main finding:
  - **30 of the 33 come from notes a human had already marked as history.** 24 of those are in
    `docs/PHASE8_STATUS.md`, whose opening banner reads "THE CODE BELOW WAS DELETED ON 2026-09-04 …
    Read them as history". The rest sit in sections headed "Superseded" or "Resolved", or are written
    in past tense.
  - 2 are detector misses: an import alias (`from x import f as _f`) was not recognised as a definition.
  - 1 names a function as the thing a wrapper mirrors, not as a caller.

## What this suggests (post hoc, NOT a result of the registered test)

The rule was not wrong about the code: almost every false flag named code that really had changed. It
was wrong about the note, which already said it was history. Excluding notes marked historical, 14 of
the remaining 19 flags were true (74%). That number was computed after grading, so it licenses nothing.
It points at the piece Steven's design has and this test did not: **a note needs a status (current /
superseded / history) and a confirmed-at date before a code-change warning can be precise.** Testing
that is a separate, new pre-registration.

## Not done

Pings per commit (reported, not deciding) were not computed. It needs the commit where each predicate
flipped, which is a per-anchor history walk. The build decision is already negative without it.

## Limits

One repository, 31 docs. The recall set was three cases I already knew. Grading was mine, against the
registered TRUE/FALSE definition. "Definition" and "reference" are regexes, not a resolver; the two
import-alias misses show one gap.

## Files

- `detect.py`: the detector.
- `flags.jsonl`: all 87 flags.
- `stats.json`
- `sample.json`
- `grades.json`: every graded flag with its one-line reason.
- `controls-registered.txt`, `controls-amended.txt`: the instrument controls run before the population.
