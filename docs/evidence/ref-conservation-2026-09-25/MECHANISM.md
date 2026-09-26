# The mechanism: the repair reads the data the deletion destroys

2026-09-26, at `2062ae83`. Closes the "mechanism NOT identified" line in `FINDING.md` and in
`docs/evidence/zero-caller-audit-2026-09-25/FINDING.md`. Found in code, with measurements, after two
refuted hypotheses and one refuted reproduction.

## The mechanism, in three steps

**1. The repair.** When file X changes, `expandAffectedFiles` (`mcp/stdio/freshness/orchestrator.js:1308`)
adds X's dependents to the re-extraction set. It finds them with:

    SELECT DISTINCT source_file FROM edges
    WHERE to_id IN (<the ids of X's nodes>) AND source_file != ''

So the set of files that need rebuilding is read **out of the edges that point into X**.

**2. The deletion.** `deleteNodesForFile` (`:1245`) drops X's edges by source file, then calls
`deleteNode` per node. `deleteNode` (`mcp/stdio/storage/nodes.js:37`) is:

    DELETE FROM edges WHERE from_id = $id OR to_id = $id

`to_id` is the half that matters. **Re-extracting X destroys every edge pointing INTO X's nodes, from
every file in the repository**, whether or not that file is being re-extracted. `SPECIAL_TYPES` (`:134`)
exempts Directory, Document, Config, Route, Entrypoint, Schema, ShaderBinding, BuildTarget and BuildTest —
**`File` is not on that list**, and IMPORTS edges point at `File` nodes.

**3. The regeneration.** Re-extraction rebuilds the edges each re-extracted file owns. X's incoming edges
come back only because step 1 pulled their owners into the set.

⇒ **Steps 1 and 2 read and write the same rows, in that order.** While both run, the loss is invisible
because it is immediately repaired — which is why it is not a daily catastrophe. But if any run performs
step 2 without step 1 having named the dependents, those incoming edges are destroyed and nothing
regenerates them.

## ⛔ And then the loss conceals itself, permanently

After the edges are gone, **step 1 can no longer see the dependency**, because the edges were its only
source of truth. The importer is never expanded into again. Nothing re-extracts it unless it changes for
its own reasons. So a single miss is not a transient glitch — it is permanent, self-concealing, and
invisible to the mechanism that exists to prevent it.

Nothing records it. No `unresolved_refs` row is written, because no refusal was ever decided: the edge was
not refused, it was deleted by a cascade while nobody was asking about it.

## The measurements

Full build in a disposable worktree against the live incremental graph, both at `e3c25113`/`2062ae83`:

| imported file | incoming IMPORTS, full build | incoming IMPORTS, incremental |
|---|---|---|
| `mcp/stdio/tools/schema.js` | 5 | **0** |
| `scripts/refactor-guard.mjs` | 3 | **0** |
| `mcp/stdio/query/verbs/packet-input.js` | 7 | 6 |
| `tests/helpers/live-matcher.js` (control) | 85 | 85 |

Repo-wide: **1832 IMPORTS pairs in the full build, 1824 in the incremental one — 9 missing.** They
concentrate on those three targets and nothing else. Two targets lost **100%** of their incoming IMPORTS.
The control target, never re-extracted in the relevant window, is identical at 85.

⭐ **The File node ids are IDENTICAL across both builds** (`eaa1bf1b97`, `4461b742a3`, `917e7efdce`,
`fba2c778b6`). The node is deleted and re-inserted with the same id, so nothing about node identity looks
wrong afterwards — which is why the earlier re-mint hypotheses kept failing. The id was never the problem.

**The CALLS losses are downstream of this.** The four specimens in `FINDING.md` — `splitVolatile`,
`volatileShapeOk`, `printRefusal`, `publishBaseline` — are all imported from `scripts/refactor-guard.mjs`,
whose incoming IMPORTS edges are all gone. Without the import edge the short-name call has no import
evidence to resolve against, so the caller edge does not form either. One deletion, two visible symptoms.

## What was refuted on the way, and why each was wrong

| hypothesis | how it died |
|---|---|
| Editing the defining file re-mints its site ids and orphans incoming edges | Tested with an action control: id WAS re-minted, edges SURVIVED two runs. The first version of this test was void — comment-only and uncommitted edits do not re-extract at all. |
| The graphify mechanism: the narrowed resolver cannot see a callee in an unchanged file, so changed→unchanged edges vanish | Tested in both directions with action controls. Re-extracting the caller kept its edges and added a new one; re-extracting the callee kept its incoming edges. Right symptom, wrong codebase. |
| Re-mint plus a lagged orphan prune | A controlled reproduction — six callers in their own files, a symbol inserted above the callee to re-mint it, then two further unrelated commits — produced **IDENTICAL** graphs. It could not reproduce because `expandAffectedFiles` DID pull the six callers in, which is the repair working. |

⭐ That last refutation is the one that found the mechanism. The reproduction failed **because the repair
fired**, and asking why it fired led to what it reads.

## What this does NOT establish

- **Which historical run performed step 2 without step 1.** The file has several sources for its
  re-extraction set (`:404` full enumeration, `:453` the expansion, the resume path, dirty-file handling),
  and identifying which one ran on which of 556 generations is not established here. **The defect does not
  depend on knowing that**: any single miss is permanent, so the structural fault is sufficient.
- **A rate.** Nine missing IMPORTS edges on one repository at one commit. Not a frequency.
- **That IMPORTS and CALLS are the only relations affected.** The cascade is relation-agnostic; those are
  what was measured.

## The fix, not yet made, and the trap in the obvious one

The obvious fix is to stop cascading on `to_id`. ⛔ **That would leave dangling edges pointing at deleted
nodes**, which is what the cascade exists to prevent, and a graph full of edges to nonexistent ids is a
worse failure than a missing edge.

The shape that looks right: before deleting, **capture the owners of the incoming edges and add them to
the re-extraction set** — making step 1's input independent of step 2's destruction by reading it first and
keeping it. That is the same rule this project reached from the other direction today: the repair must not
depend on data the operation destroys.

⚠ Per the rule adopted from dashboard-manager: **a fix is a claim about the fix until it has been watched
failing on the thing it fixes.** There are now nine named specimens to test one against, and a fix that
does not restore those nine has not been demonstrated to work.
