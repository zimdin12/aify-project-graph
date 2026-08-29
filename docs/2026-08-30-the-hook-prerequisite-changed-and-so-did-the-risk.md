# The hook prerequisite changed, and the risk moved with it

2026-08-30. Two entries have sat waiting on Steven:

> ⏳ Placement (a Claude Code hook versus the `aify-wrapper` contract) remains Steven's call.
> ⚠ Whichever surface a hook lands on, there is no content to put in it yet. The prerequisite is
> verified call edges.

Placement was never the blocker, and the thing that *was* the blocker has changed. A number that
gates a decision should be re-read before the decision is called blocked.

## The stated blocker is falsified

Rule B — *"you deleted something that has callers"* — was recorded as **"built, correct, and INERT —
gated to `LSP_VERIFIED`, of which this graph has 19."** That was true on 2026-08-22. Measured today
on the same repository, with the heuristic tier as a positive control so a small verified number
could not be mistaken for an empty graph:

    CALLS edges by provenance: AMBIGUOUS=5925 EXTRACTED=3182 LSP_VERIFIED=981
    POSITIVE CONTROL extracted CALLS present: true (3182)

    distinct targets with >=1 verified caller       : 373
    ... restricted to callable declarations         : 71
    ... with >=2 verified callers (strongest cases) : 38

⇒ **Rule B is no longer inert.** It has a real protectable population of 71 callable declarations, 38
of them with more than one verified caller. The premise the deferral rested on is gone.

## But the risk it was cleared against is the wrong risk

The original analysis worried about false alarms: *"one false alarm gets a hook muted permanently"*,
so Rule B was gated to verified evidence and Rule A was killed at an 85.5% fire rate. That reasoning
is sound and Rule B satisfies it — it cannot cry wolf, because it speaks only from compiler-verified
edges.

The exposure is on the other side. Against the full callable surface:

| | count | share |
|---|---|---|
| callable declarations in the graph | 2,566 | — |
| with any incoming `CALLS` edge at all | 1,637 | 63.8% |
| **with a VERIFIED caller — Rule B's reach** | **71** | **2.77%** |

⇒ **A hook is unbidden, so its silence is read as a verdict.** At 2.77% coverage, "I deleted
something and the hook said nothing" means *nothing* 97.23% of the time — but it will be learned as
"no warning, safe to delete". That is a false absence delivered at the exact moment someone is
deleting code, and false absence is this repository's signature defect: four verbs, six dead
remedies, one shape.

A hook that only ever warns cannot produce a false positive. It can absolutely produce a false
negative that its own reader cannot detect, and unlike a verb, nobody asked it a question they could
sanity-check the answer to.

## And the reach is not stable

Today's other finding bears directly on this: the verified spine **decays with commits since the last
collection**. This repository is 121 commits past its collection, and a single reindex took the spine
from 1,943 to 1,054 edges — 46% in one run, all of it legitimate. So 2.77% is not a floor to build
up from; it is a point on a curve that slopes down between collections.

⇒ **The two open items are one item.** The hook's prerequisite and the spine's decay have the same
remedy: a re-collect trigger policy. Coverage is not merely low, it is unmaintained.

## What this makes the decision

Not "which surface does the hook attach to". That question was answerable either way and never
blocked anything.

1. **Rule B is shippable on its evidence** — 71 real targets, no false-alarm risk.
2. **It must not be shippable as a check.** Its silence has to be unreadable as absence: never framed
   as "no callers found", never as a deletion gate, and carrying its own coverage figure so a reader
   can calibrate what the silence is worth. The repo already has the vocabulary for this — a
   not-found qualified by known coverage, exactly as `staleNotFoundCaveat` does for stale reads.
3. **The real prerequisite is the re-collect policy**, shared with the spine-decay finding, and it
   costs clangd time on whatever trigger is chosen.

⛔ **The lesson worth keeping: a deferral inherits its blocker.** "Rule B is inert" was measured once
and then carried for eight days as a standing fact while the underlying number moved by two orders of
magnitude. A blocker made of a measurement expires when the measurement does.
