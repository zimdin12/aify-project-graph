# Self-review worktree isolation — design, before implementation

**Status: DESIGN v2. APPROVED IN DIRECTION, three rulings applied.** No implementation yet.
Rulings from `1787285498398-d615bd22`.

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

### C. ⛔ Orphans REFUSE. They are never swept.

**My v1 proposed automatic cleanup, and the referee overruled it. They are right, for two reasons I
had not weighed:**

1. **An orphan contains mutant bytes — it IS the evidence** that a run was interrupted, and where.
   Sweeping it destroys the only record of what was in flight.
2. **A "stale" worktree may be a peer's ACTIVE one.** Name-pattern matching cannot tell an abandoned
   directory from a concurrent run, and deleting the latter corrupts someone else's experiment.

⇒ On discovery, the tool **refuses new mutation runs** and reports: path, run ID, target, source
commit/tree, creation time, and registration/lock state. Cleanup is an explicit, nominated operation:

```
--cleanup-orphan <run-id>
```

which removes **only** the nominated orphan, and only when every one of these holds:

- it lives under the dedicated self-review root, **and** carries a matching tool-authored manifest;
- it is not the current or an active run;
- its target's mutant bytes and manifest are preserved or hashed **before** removal.

⛔ **Never sweep by name pattern alone.** Registration, directory, junction and prune are each
removed and each result reported.

### C2. Per-arm, not per-spec — the referee's ruling

A shared per-spec worktree lets a killed arm contaminate the next one and reintroduces cross-arm
custody. The 200–500 ms is acceptable beside two test executions per arm.

### C3. Carrier semantics

Commit and tree remain **source identity**. The worktree path is **mandatory environment
disclosure**, not identity — *unless* a predicate or output depends on that path, in which case it
becomes part of that arm's evidence carrier.

Each arm's receipt additionally binds: platform, Node and dependency transport, spec hash, target
pre/mutant/restored hashes, and the exact test argv.

⚠ **An explicit commit argument, or a clean-main default.** Otherwise an author can believe their
uncommitted main-tree work was reviewed while the detached arm actually tested HEAD — a silent
wrong-population error of exactly the kind this project keeps paying for.

### D. What this does NOT fix, stated up front

- **Not** a kill between `worktree add` and the first write — harmless, but the directory lingers
  and, under the refuse-don't-sweep rule, will block the next run until explicitly cleaned. That is
  the intended cost of never destroying evidence automatically.
- **Not** the shared mutable `node_modules`. The dependency carrier remains a junction to the main
  tree's, exactly as the gate transport already discloses. A mutation cannot reach it, but this
  design does not make dependencies immutable and must not be described as if it did.
- **Not** the `.aify-graph` materialisation observed in fresh worktrees. Recorded separately; no
  arm's route currently reads it.

## Cost, stated honestly

Each arm gains a worktree creation and disposal — measured elsewhere at roughly 200–500 ms plus disk.
With two vitest runs per arm already dominating (baseline + mutant, tens of seconds), the overhead is
small in proportion. But it is **not free**, and for a 30-arm sweep it is thirty checkouts.

⇒ The cheaper alternative — one worktree per spec — was named in v1 and **ruled out**: a killed arm
would contaminate the next one and reintroduce cross-arm custody. Per-arm is the decision.

## Additional implementation requirements, from the ruling

- Write a run manifest **outside and inside** the worktree before any mutation.
- Capture baseline/mutant artifacts **outside** the disposable tree as they are produced.
- Restore and verify the worktree target before normal disposal, **even though disposal is itself
  the safety boundary** — removing a check because a redesign made it redundant is how the
  redesign's own bug ships.
- Dispose only after receipt and artifact hashes are durable.
- The main checkout must **never** be written to.
- Hostile kill simulation must leave main bytes unchanged and produce an attributable orphan that
  **blocks the next run**.
- Explicit cleanup must remove only the nominated orphan and leave a sibling sentinel untouched.

## Answered, no longer open

The three questions v1 put to the referee are ruled: **per-arm**; **path is disclosure, not
identity, unless a predicate depends on it**; **orphans refuse and are never auto-swept**.
