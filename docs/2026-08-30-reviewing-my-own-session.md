# Reviewing my own session

2026-08-30. Six commits went in today with no outside reviewer available. This is the adversarial
pass over my own work: what I attacked, what held, and the one real defect I put in.

The rule I was applying to myself is the one I applied to the code all session — **a claim I reasoned
about is not a claim I executed** — so each risk below names the experiment, not the argument.

## ⛔ One real defect, mine, an hour old

**`collection_stale` asserted a cause it had not established.** I added a clause denying absence
authority when a collection is not current, and collapsed two different facts into it:

- the collection's commit differs from HEAD — *known* stale, and re-collecting fixes it;
- the comparison could not be made at all — HEAD unreadable, or the collection predates commit
  tracking.

In the second case my refusal said *"the collection is complete but was taken at an older commit"*
and prescribed a re-collect. Both halves are wrong there: nothing established an older commit, and in
a non-git checkout HEAD stays unreadable no matter how many collections run. `WorktreeState` already
models this distinction with `headKnown`, and the orchestrator explicitly supports non-git checkouts,
so this was reachable rather than theoretical.

**This is the exact defect shape I spent the session fixing, committed by me an hour after fixing
it.** Split into `collection_stale` and `collection_currency_unknown`; both still fail closed, but
only one claims to know why. The unknown case now names the two candidate causes and asserts neither,
because one is fixable by re-collecting and the other is not fixable at all — promising a single
remedy would be wrong half the time.

A test now holds that line, using the controlled matcher so its silence means something.

## What I attacked and what held

**A rebuild silently discarding itself.** The outer transaction spans ~500 lines; any `return`
between `begin()` and `commit()` would leave it open, and `db.close()` in the `finally` rolls back —
so the rebuild would vanish with no error at all. Checked: **no `return` in the span**, the only
occurrence of the word being in a comment. The probe was positive-controlled first — the same matcher
finds 27 returns across the file — because a zero from an untested instrument is not a zero.

**The orchestrator wiring being untested.** My tests cover `RebuildTransaction` in isolation, so I
mutated the *wiring*: removing `rebuildTxn.commit()` fails **47 tests across 11 files**. The
integration and freshness suites cover it well.

**Incremental runs.** The code comment claims the transaction covers them too, and I had only ever
tested `force: true`. Now measured against a real incremental run — exit code asserted, and the run
proven to have changed the graph so a constant could not pass for atomicity:

    count 8349 -> 8364, 388 samples, distinct values [8349, 8364]
    values that were NEITHER complete state: []

**Serving a legacy partial graph.** My freshness change serves the previous snapshot when
`alreadyIndexedFiles > 0`. The F8 partial (90 nodes: Document/Directory/Config, zero code) has no
`File` nodes, so it still refuses. And any legacy partial under status `ok` was already being served
before my change — that exposure is pre-existing and unchanged, covered separately by
`graph_health`'s index-incomplete verdict. Noted rather than scope-crept into.

## Mutants that survive, and why each is allowed to

Eight mutations across the two new modules; six killed. The two survivors are both **defensive code
whose absence is not observable**, and that is now measured rather than assumed:

| mutant | outcome | why |
|---|---|---|
| `RELEASE` omitted after `ROLLBACK TO` | survives | 5,000 rollbacks without it: no error, data identical. A savepoint-stack cost, not a behaviour change. |
| explicit `rollback()` removed from the orchestrator's catch | survives | `db.close()` in the `finally` already rolls back an open transaction. |

Both are kept — an unbounded savepoint stack and an implicit unwind are costs with no upside — but
neither is load-bearing today, and saying so is better than implying coverage I do not have.

## An honest limit I created

⚠ **The full label-level diff of the reindex can no longer be run.** My spine-decay analysis compared
1,943 verified edges before against 1,054 after, drilled into the five unchanged files by label, and
found 158 of 168 apparent losses were node-id churn. I did **not** label-diff the whole set, and I
then deleted the 161 MB backup to reclaim disk — so that comparison is no longer reconstructible
without another before/after cycle.

The arithmetic that looks like corroboration is not: `lost − gained = |before| − |after|` holds for
any two sets, so `1277 − 388 = 889` confirms nothing. The churn conclusion rests on the five-file
label sample, and that is the honest extent of it.

⇒ **A probe that deletes its own evidence caps how far its own conclusion can later be pushed.** I
knew that rule and deleted the backup anyway, for disk.

## What did not need changing

The atomic rebuild, the freshness policy, the spine-decay analysis and the F4 and hook re-measurements
survived the pass unchanged. The suite is green at 389 files.

## The certification gate itself is unreliable under load

Three consecutive full-suite runs while reviewing this work:

| run | result | failing test |
|---|---|---|
| 1 | 1 failed / 3,158 passed | `scoped-collect-survives-real` — collect ledger empty |
| 2 | 1 failed / 3,161 passed | `live-verbs-real` — `not_found_after_retry` |
| 3 | **0 failed / 3,162 passed** | — |

A different test each time, each passing in isolation (6/6, in 15.4s and 9.0s), and neither importing
anything I changed. The cause is not mine and is not new: the repository already diagnosed it, in the
failing file's own comment —

> *"FLAKE FIX, not a mask. This failed once under full-suite concurrency and passed in isolation and
> on every rerun. Cause is resource contention: several real-server integration files each spawn
> their own language server."*

Three test files each spawn a real clangd, `pool: 'forks'` runs them in parallel, and the mitigation
already in place — `waitForReadyMs: 15000` — is not sized for a machine also running another
project's suite. Checked and ruled out as mine: zero leaked clangd processes, CPU at 23%, and the
failing paths import none of my changes.

⛔ **Reporting all three runs rather than the green one.** The same file warns against "retry until
green (which would hide a real undercount)", and quoting only run 3 would be exactly that. The honest
claim is: the suite passes, and it passes intermittently on a loaded machine for a documented reason.

**I did not fix it, deliberately.** The failure is intermittent, so demonstrating a fix would take
many 15-minute runs — I could not show the remedy worked, and an unverified flake fix is the shape
this repo forbids. The structural remedy is to stop the three real-server files running concurrently;
that is a config change someone should make on a quiet machine where it can be proven.

⇒ **A green suite is a statement about a machine at a moment, not a property of the code.** Every
"full suite green" in today's commits carries that qualifier.
