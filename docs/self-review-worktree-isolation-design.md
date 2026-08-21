# Self-review worktree isolation — design, before implementation

**Status: DESIGN ONLY.** No implementation. Sent for referee ruling.

## The OPEN item, as the tool states it

> *per-arm worktree isolation: mutations run in THIS checkout, so a hard kill between mutate and
> restore leaves mutant bytes on disk*

It is the largest remaining OPEN item, and the only one whose failure mode **corrupts the
repository** rather than producing a wrong verdict.

## Why it matters more with 30 arms ahead

Every remaining legacy spec will eventually be run. Each run today does:

```
read original bytes → write mutant bytes → run vitest → restore → verify hash
```

A hard kill anywhere between the write and the restore leaves mutant source in the working tree. The
`finally` restore covers thrown errors; it does not cover `SIGKILL`, a power loss, or a terminal
closed mid-run. **Thirty arms is thirty windows.**

⚠ AND THE DAMAGE IS QUIET. The mutant is a plausible edit to a real file — not a syntax error. A
kill at the wrong moment leaves a repo that builds, passes most things, and is wrong in one place
nobody chose.

## Design

### A. Each arm runs in a detached disposable worktree

```
per arm:
  git worktree add --detach <tmp> <exact HEAD commit>
  link the dependency carrier, and RECORD the transport
  mutate INSIDE the worktree
  run the arm's tests INSIDE the worktree
  capture artifacts OUT of the worktree
  dispose the worktree
```

⇒ A hard kill now leaves mutant bytes in a **throwaway directory**, never in the checkout the team
is working in. The blast radius changes from "the repo" to "a directory named after the run".

### B. The main checkout is never written to

⛔ Today's restore-and-verify becomes unnecessary rather than merely safer: **nothing writes to the
main tree at all**, so there is nothing to restore. The strongest version of a repair is one that
removes the failure mode instead of covering it.

⚠ The existing byte-exact restore verification is KEPT anyway, applied to the worktree. Removing a
check because a redesign made it redundant is how a redesign's own bug ships unnoticed.

### C. Orphan sweep at startup

A kill also leaves the worktree itself behind. Before any arm runs, the tool lists worktrees matching
its own naming convention and removes stale ones, **reporting what it removed** rather than cleaning
silently. A run that had to clean up after a previous crash should say so.

### D. What this does NOT fix, stated up front

- **Not** a kill between `worktree add` and the first write — harmless, but the directory lingers
  until the next sweep.
- **Not** the shared mutable `node_modules`. The dependency carrier remains a junction to the main
  tree's, exactly as the gate transport already discloses. A mutation cannot reach it, but this
  design does not make dependencies immutable and must not be described as if it did.
- **Not** the `.aify-graph` materialisation observed in fresh worktrees. Recorded separately; no
  arm's route currently reads it.

## Cost, stated honestly

Each arm gains a worktree creation and disposal — measured elsewhere at roughly 200–500 ms plus disk.
With two vitest runs per arm already dominating (baseline + mutant, tens of seconds), the overhead is
small in proportion. But it is **not free**, and for a 30-arm sweep it is thirty checkouts.

⇒ If the referee prefers, an alternative is ONE worktree reused across all arms in a spec, with
restore-and-verify between arms. That halves the isolation benefit — a kill mid-arm still leaves a
dirty worktree that the next arm would inherit — so I am proposing per-arm and naming the cheaper
option rather than choosing it silently.

## What I am asking the referee to rule

1. **Per-arm worktree, or one per spec run?** I propose per-arm; the cheaper option is named above.
2. **Does this change the carrier semantics of existing receipts?** Arms would run at the same HEAD
   commit, but in a different directory. I believe the manifest's `commit`/`tree` remain the honest
   carrier and the worktree path is disclosure, not identity — but that is a claim about what a
   receipt means, which is yours to settle.
3. **Should the orphan sweep be automatic, or refuse and report?** Automatic cleanup is convenient
   and silently erases evidence of a prior crash. I lean toward sweeping but reporting loudly.
