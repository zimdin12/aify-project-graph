# Preregistered: does a mid-rebase repo look fresh?

**Written before the measurement.** Everything below is fixed while the answer is unknown.

## The premise, verified with its control

```
references to sequencer / MERGE_HEAD / CHERRY_PICK_HEAD / REBASE_HEAD /
  rebase-merge / rebase-apply, anywhere under mcp/          : 0
[POSITIVE CONTROL] "porcelain" in the same freshness files  : 2
```

The control establishes the search works, so the zero is a fact about the code rather than about the
grep. **Nothing in this product knows what an in-progress git operation is.**

## The hazard, stated precisely

`git status --porcelain` reports conflicted files, so **file-level conflict is already visible** and
the dirty-count path sees it. What is invisible is that the repository is **MID-OPERATION**.

During a rebase, cherry-pick or merge, `HEAD` is a transient commit — a synthetic state that may
never exist again once the operation finishes or is aborted. The failure that matters is not "we
index the wrong commit"; if the operation completes, `indexedCommit !== head` and `graphCurrency`
correctly reports `stale`.

⇒ **The failure is a query DURING the operation.** Then `indexedCommit === head` — both are the
transient commit — and every currency surface reports **current** over a working tree that is
half-way through an edit nobody committed.

## What is being measured

**CLAIM (to be falsified):** with a rebase in progress, no surface this product emits mentions that
the repository is mid-operation.

**POPULATION.** The fields and prose a caller actually receives: `graph_health`'s response and
verdicts, `graphCurrency`'s state and cause, and the snapshot warnings prefixed onto verb output.
Not internal variables — what an agent can read.

**METHOD.** Build a repo, start a rebase that stops (conflict or `--exec false`), index, then read
those surfaces and search them for any mid-operation signal.

**CONTROLS, in the same pass:**
- **POSITIVE** — the same surfaces must report an ordinary dirty file on the same repo, or the
  instrument is not reading anything and the zero is about the harness.
- **NEGATIVE** — on a clean, non-rebasing repo, no mid-operation signal may appear, or any signal
  added later is unconditional and therefore worthless.

**ABANDON RULE — this is the one most likely to fire.** If the emitted output already makes the
mid-operation state evident by other means (a conflicted path in the dirty list, a detached-HEAD
notice, a `graphCurrency` cause that happens to name it), then it is **disclosed** and there is no
defect. Record that and stop. ⛔ Do not add a signal whose information is already present — this
project has torn out a warning wall once.

**FINDING SHAPE.** `{ surface, mentionsMidOperation, whatItSaidInstead }`.

## ⛔ Claim ceiling, written now

- This measures **our disclosure**, not whether an index taken mid-rebase is actually *wrong*. The
  content on disk during a stopped rebase is real content; it is simply a state no commit describes.
- One platform. Git's rebase machinery differs between `rebase-merge` and `rebase-apply` backends,
  and a test that constructs one has not exercised the other.
- A zero here would mean *no surface I looked at mentioned it*. The population is named above, and
  anything outside it is unmeasured rather than clean.

## What I will NOT do

⛔ **Not fix it in the same commit as the measurement.** If a defect is found, the repair is a
separate step with its own test — and on this arc's evidence the right shape is almost certainly a
CAUSE carried alongside the existing currency state, not a new boolean.

⛔ **Not treat `graphCurrency` as the place to put it without checking.** Mid-operation is a fact
about the *repository*, not about the graph's currency relative to HEAD. Those are different
questions and this arc has spent itself on the cost of conflating two facts in one value.
