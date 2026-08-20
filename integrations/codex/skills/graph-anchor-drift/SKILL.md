---
name: graph-anchor-drift
description: Use when feature anchors may be stale after renames, moves, or deletes. Compares the current diff (or chosen git range) against `.aify-graph/functionality.json`, proposes targeted anchor fixes, and never writes without confirmation.
---

# When the feature map starts lying by omission

Code moved. The feature map did not. Nothing errored.

That is the whole problem, and it does not announce itself. A feature whose `anchors.files`
point at paths that no longer exist does not report an error — **it reports nothing**, and
nothing is exactly what a genuinely unowned file reports. The reader cannot tell the two apart,
so a stale anchor turns into "no feature governs this", which turns into a change nobody
reviewed.

That is why this is worth doing, and it is not tidiness. It is the mechanism by which the
overlay starts producing FALSE ABSENCES.

## When

- a feature or contract list came back emptier than you expected — **suspect this first**
- files or symbols were renamed, moved or deleted
- the brief's trust line mentions stale anchors

## What to read

`.aify-graph/functionality.json` · the trust/features block of `.aify-graph/brief.json` · the
current diff, or a git range the user names.

## What to fix

Renamed symbols in `anchors.symbols`. Moved or deleted files in `anchors.files`. New files that
clearly join an existing glob family.

⛔ **Do not invent features here.** A missing feature is a different job with a different
authority; inventing one silently converts your guess into curated data that later reads as
someone's decision.

⛔ **Do not remove a user-added anchor on weak evidence.** Someone put it there on purpose, and
you cannot see their reason from the diff.

## Evidence standard — every proposed change cites a diff fact

A deleted file. A rename pair. A removed or renamed symbol. A new file matching an existing
family.

**If you cannot cite one, do not propose the change.** An anchor edit with no diff behind it is
a guess written into the layer whose entire value is that it was curated rather than inferred.

## How to act

Show the proposed diff **first**, and wait. Then regenerate the briefs, so the trust line is
re-evaluated against what you actually changed rather than against what you meant to.

⚠ **Preserve feature identity** — `id`, `label`, `description`, `tags`, `source`. An anchor
repair that changes identity is a rewrite wearing a repair's name, and every reference to that
feature elsewhere silently stops matching.

## When this is not the job

- **The feature genuinely does not exist yet.** Then this skill has nothing to repair, and
  saying so is the answer.
- **The overlay was never maintained here.** Repairing anchors on an abandoned map produces a
  precise description of nothing. `graph_health` tells you whether the overlay is alive before
  you spend an hour on it.
- **You only need to know what a file belongs to right now.** That is one `graph_pull`, not a
  repair session.
