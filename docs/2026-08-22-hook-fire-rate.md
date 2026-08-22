# Phase 3b — the fire rate, measured before the hook was written

The roadmap sets the exit criterion and it is a number, not a judgement:

> **Exit criterion: a measured fire rate.** Fire on more than a small fraction of edits and it is
> slop by definition, however clever.

So this was measured first. Population: the last 120 commits on `main`, of which **83 touched at
least one JavaScript source file** — that 83 is what a `PostToolUse` hook would actually see.

## The verdict

| candidate rule | fires on | verdict |
|---|---|---|
| **A** — "callers in files you have not opened", approximated as *callers outside this edit* | **71 / 83 = 85.5%**, mean **14.8** outside caller files | ⛔ **DEAD.** Slop by the criterion. |
| **B** — *deleted an exported declaration* (upper bound on "deleting a symbol that has callers") | **4 / 83 = 4.8%** | ✅ **VIABLE** |

⇒ Rule A is not a tuning problem. Nearly every edit to a connected codebase has callers elsewhere,
so "here are the callers" is the definition of a signal that adds data without contradicting
anything — and our own measured finding is that **behaviour changes only when a field CONTRADICTS
the agent's confidence**. At 85.5% and ~15 files a time it is a per-edit token cost agents would
learn to ignore, and a frequent signal later disproved teaches them to ignore it permanently.

⇒ Rule B is what a contradiction looks like: you removed something, and something still needs it.

## ⛔ THE INSTRUMENT WAS WRONG FIRST, AND IT MATTERED BY A FACTOR OF THREE

The first version counted every `-const X` / `-function X` line as a deletion. That is wrong: a
**modified** declaration is a `-`/`+` pair on the same name. Changing `EXTRACTOR_VERSION` from
`'0.3.0'` to `'0.4.0'` — a version bump, deleting nothing — was being counted as removing a symbol
that has callers.

    removed an EXPORTED declaration    13 / 83 = 15.7%    ← before the correction
    genuinely removed one               4 / 83 =  4.8%    ← after

⇒ **15.7% reads as "marginal, probably too noisy"; 4.8% reads as "viable".** The instrument would
have killed a viable rule. A name counts as deleted only if it does not come back as an added
declaration in the same commit.

## What these numbers are NOT

⚠ **Rule B's figure is an UPPER BOUND, not its fire rate.** The real rule also requires the deleted
symbol to *have callers*. That cannot be measured now: a symbol deleted at commit X does not exist
in the HEAD graph, so its callers cannot be looked up, and measuring it properly needs a graph
rebuilt at each historical commit. The bound is what the exit criterion needs — a rule cannot fire
more often than its precondition — but nobody should quote 4.8% as the rate.

⚠ **Rule A's figure is inflated, deliberately in the safe direction.** The graph reflects HEAD, so a
file that gained callers since a commit looks like it had them then. For a "does this fire too
often" question, an upward bias is the safe one: 85.5% is an over-estimate of an already
disqualifying number, so the conclusion holds regardless.

⚠ **One repository, 120 commits, one language.** APG is densely connected JavaScript. A repo of
loosely-coupled modules would give Rule A a lower rate. The 85.5% is about *this* codebase, and the
argument that generalises is structural rather than numeric: **"X has callers" is true of almost
every edit anywhere, so it cannot be a contradiction signal.**

## The two candidates not measured, and why

- **"a signature change with callers in TUs the compile DB does not cover"** — needs a per-commit
  compile database. Not measurable from git history alone.
- **"editing a file an open task marks as another lane's"** — needs the task overlay's state *at
  each commit*, which is not versioned alongside the code.

Both are named rather than silently dropped: a table with two rows in it reads as "we evaluated the
candidates", and we evaluated two of four.

## Recommendation

**Build Rule B only.** Do not ship Rule A in any form — not down-ranked, not summarised, not
"only when there are more than N callers", because the count is not what makes it noise; the
universality is.

⏳ Placement (a Claude Code hook versus the `aify-wrapper` contract) remains Steven's call. This
measurement does not depend on it, and it removes the part of the decision that was guesswork:
whichever surface it lands on, one of the two candidate contents is disqualified and the other has
a fire rate that clears the bar.
