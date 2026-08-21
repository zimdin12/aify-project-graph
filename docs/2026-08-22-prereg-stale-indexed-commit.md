# Preregistration — an unresolvable indexed commit must not advance the manifest

**Status: PREREGISTERED, NOT YET IMPLEMENTED.** The defect is REPRODUCED and pinned by
`tests/integration/stale-commit-advances-manifest.test.js`.

## The defect, measured

| arm | indexed commit resolvable | manifest advanced | new symbol in graph |
|---|---|---|---|
| CONTROL | true | yes | **YES** |
| HOSTILE | false | **yes** | ⛔ **NO** |

git printed `fatal: Invalid revision range deadbeef...bf07288e` and the graph advanced its manifest
anyway. It now reports itself indexed at a commit whose code it has never read.

⚠ **The trigger is broader than I first reported.** I claimed it needed a clean working tree. Both
arms ran DIRTY and it reproduced: what matters is that the CHANGED FILE is not in the dirty set,
which is the normal case for anything committed and not since re-edited.

Fires after a rebase, a branch reset, a force-push, a gc that prunes the commit, or across a
shallow-clone boundary.

## The design, and why it is smaller than it looks

`getChangedFilesSync` returns `[]` on any git failure. That is DELIBERATE and documented — *"so
callers can degrade gracefully instead of throwing"* — and it is **correct for one of its two
callers**:

| caller | what `[]` means there | verdict |
|---|---|---|
| `packet-verify.js:18` | a display path; it documents its own degradation | **keep degrading** |
| `orchestrator.js:213` | decides which files get reindexed | **must not degrade** |

⇒ One failure policy serving two callers with opposite needs. The fix is not "make it throw".

**`null` is the typed unknown**, exactly as `safeDirtyCount` now uses. `null` is not an array, so it
cannot be silently spread or iterated — every caller is forced to state its choice rather than
inherit a default. `packet-verify` writes `?? []` and keeps its documented behaviour.

⇒ **AND THE ORCHESTRATOR ALREADY KNOWS WHAT TO DO.** `fullRebuild` is already triggered by
`!manifest.commit` — *no indexed commit, so rebuild*. An **unresolvable** indexed commit is morally
identical: no delta can be computed from it. So the fix folds one term into an existing, tested
decision rather than inventing a new path.

    const fullRebuild = ... || !manifest.commit || deltaUnavailable || schemaMismatch || ...

## Preregistered controls

### C1 — the induction is proven, not assumed
Assert git genuinely cannot resolve the commit. Already asserted in the pinned test; carried
forward. Without it the hostile arm measures nothing and looks identical to a pass.

### C2 — the pinned DEFECT assertions FLIP
`stale-commit-advances-manifest.test.js` currently asserts `betaInGraph === false`. After the fix it
must assert **true**. The flip is the evidence, and the test was written to make it visible.

### C3 — POSITIVE CONTROL: the resolvable path still does an INCREMENTAL update
- **Hostile world:** the fix makes every run a full rebuild, which would be correct-but-ruinous —
  the graph would work and the tool would be unusable on a large repo.
- **Discriminates because:** the control arm must still reindex without `fullRebuild` being set.
- ⛔ This is the assertion that keeps the fix from being a lobotomy, and it is the one I would most
  easily skip because the defect arm going green feels like success.

### C4 — `packet-verify` keeps its documented degradation
A `since:` ref that git cannot resolve must still produce a packet with empty files, not throw and
not rebuild anything. Its comment says so; the fix must not quietly change a second caller's
contract while repairing the first.

### C5 — a genuinely empty delta is NOT treated as unavailable
Two commits with no differences between them return `[]` legitimately. That must remain an
incremental no-op, and must NOT trigger a rebuild.
- **Discriminates because:** `[]` and `null` are different values, and this is the assertion that
  proves the fix distinguishes them rather than treating every empty delta as suspect.

## Falsification, registered before the run

- hostile arm still shows `betaInGraph === false` → **the fix did not work**;
- the control arm triggers `fullRebuild` → **over-applied; every run becomes a rebuild**;
- an identical-commit delta triggers a rebuild → **`[]` and `null` were conflated**;
- `packet-verify` throws or rebuilds on an unresolvable `since:` → **a second contract was broken
  while repairing the first**.

## What this does NOT do

- It does not change `getChangedFilesSync`'s behaviour for any caller that opts into `?? []`.
- It does not attempt to RECOVER the lost history. A full rebuild is the correct answer to "the
  delta cannot be computed"; reconstructing what changed is not possible without the commit.
- ⚠ It does not address the cost of that rebuild on a large repository. The rebuild fires only when
  the indexed commit has vanished, which already implies a significant history change — but this is
  a real cost and it is stated rather than hidden.
