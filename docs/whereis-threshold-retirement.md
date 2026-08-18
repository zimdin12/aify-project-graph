# Retiring the ">10 files → Grep beats graph_whereis" threshold

**Status:** retired 2026-08-18. Not softened, not re-worded — the bullet is gone from the four
shipped `SKILL.md` files and replaced with a schema statement.

## What the guidance used to say

Under *"Use grep/read first for"*, all four runtime skills carried:

> **symbols appearing in >10 files** — `graph_whereis` tends to lose to Grep here.
> (stated reason: "the candidate set is too wide for graph's exact-match advantage to kick in")

On 2026-08-12 it was flagged `⚠ RE-MEASURE THIS ONE` but left in place, because the fix that
prompted the flag — `graph_whereis` capping at `limit=5` while claiming to be the "unsampled"
escape hatch — invalidated the *cause* without telling us anything about the *rule*.

Shipping a flagged claim is still shipping the claim. Agents read the bullet, not the caveat.

## Why the stated cause is false

`graph_whereis` selects `label = $symbol` restricted to declaration types
(`Function|Method|Class|Interface|Type|Variable|Test|Route|Entrypoint`). It answers
**"where is this defined"**. Grep answers **"where does this text appear"**.

"The candidate set is too wide for exact-match advantage to kick in" has it backwards: the wider
the *occurrence* set, the more selective exact-label matching becomes relative to text search. A
symbol mentioned in 200 files is precisely where you want the 1-row definition answer.

## What was measured

Carrier — bind it, because none of these numbers travel:

| | |
|---|---|
| repo | `aify-project-graph` @ `9626b30` |
| languages | JS/TS, plus Python/C++ test fixtures |
| corpus | `mcp/`, `scripts/`, `tests/`, `integrations/` |
| graph | `.aify-graph/graph.sqlite`, verified no source file newer than the DB |
| tools | node v22.20.0, ripgrep 15.1.0 |
| date | 2026-08-18 |

Method: take every distinct graph label of length ≥5 matching a plain identifier (1466 labels).
For each, count files containing it via `rg -l --word-regexp --fixed-strings`, and count distinct
defining files from the graph.

**Result — of the 98 symbols occurring in more than 10 files:**

| definition files | symbols |
|---|---|
| exactly 1 | 69 |
| 2–3 | 19 |
| 4+ | 10 |

So **88 of 98** high-occurrence symbols are defined in three files or fewer. Worked example:
`openDb` appears in 111 files; `graph_whereis` returns its single definition.

The occurrence count and the definition count are close to unrelated here, and the retired rule
thresholded on the one the verb does not use.

Second measurement: symbols with more than 10 *definition* files in this repo — **7**
(`git`, `insertNode`, `node`, `initGitRepo`, `runGit`, `makeRepo`, `run`). All seven are test
fixture helpers.

## What this does NOT establish

⚠ **This is not a re-run of the original bench, and must not be cited as one.** The original
observation came from a C++ engine repo, where virtuals and overloads make many-definition
symbols ordinary. This repo has 7 such symbols and all 7 are test helpers, so it *structurally
cannot* reproduce the case the original rule was probably about. The rule is retired because its
stated cause is false and its threshold measures the wrong quantity — not because a
head-to-head bench came out the other way. No such bench has been run.

Anyone with a large C++ or Java corpus can settle the remaining question: on a symbol with 30+
definitions, does the now-disclosed `graph_whereis` beat a Grep pass? That is untested.

## The cause that probably was real, and its current state

Until 2026-08-12 `graph_whereis` returned `LIMIT 5` with no total and no marker, while
`graph_packet` and `graph_consequences` both ended their truncation warnings by pointing at it as
*"every definition, unsampled"*. On a symbol with 30 definitions the escape hatch silently
returned five. A bench run against that verb was measuring the cap.

That is fixed and disclosed. Verified on `makeRepo` (12 definitions) at `9626b30`:

```
NODE ... function makeRepo tests/unit/code-intel/compile-db.test.js:36
... (5 rows)
⚠ SHOWING 5 OF 12 — this verb caps at limit=5. Re-run with limit=12 for the full set.
```

The many-definition failure mode still exists at default limit. It is now **stated instead of
silent**, which is the difference between a sample and a false population.

## Note on the instrument

The first version of the measurement script passed a non-existent directory to `rg`. Every
invocation exited 2, the `catch` scored each as **0 occurrences**, and the run printed
`symbols OCCURRING in >10 files: 0 of 1466` — a clean, plausible, entirely fabricated result.

Exit 1 (no matches) and exit 2 (apparatus failure) are different facts. The rewritten script
counts apparatus errors separately and refuses to print any figure if the count is non-zero.
Recorded here because this document exists to retire a number that was trusted past its basis,
and it nearly shipped with another one.

## Replacement guidance

The skills now say, in the same section:

- Use Grep when you want every place a symbol is **mentioned** — call sites, comments, strings.
  `graph_whereis` returns definitions, so it answers a different question **at any file count**.
  That is a schema difference, not a threshold.
- If `graph_whereis` prints `⚠ SHOWING N OF M`, re-run with `limit=M` before concluding anything
  about completeness.

Both are checkable from the source of the verb, so neither needs re-benching to stay true.
