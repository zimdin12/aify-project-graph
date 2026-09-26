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

## ⭐ INDEPENDENTLY WITNESSED, TWICE, ON A SUBSTRATE THIS PROJECT DID NOT BUILD

Everything above was measured by this project's own instruments against its own graph. That is one
instrument read twice. graph-senior-dev wrote their own eight-ref / five-file fixture and auditor and ran
it in an isolated clone; both results below are **their reported results, which this project did not run**.

**WITNESS 1 — the defect, against unmodified apg at `871a1d65`.** Baseline 8/8 refs had edges; after a real
committed `innerTwo()` and an incremental refresh, 2/8 — three outer File IMPORTS and three outer symbol
CALLS with neither an edge nor an `unresolved_refs` row; a full rebuild over the identical final tree
recorded 8/8. Action control: generation 1→2, HEAD equal to the indexed commit, the new node present.
Negative control in the same run: deleting one known-good edge from a disposable rebuilt DB moved exactly
that ref to LOST, 7/8 retained — so the auditor was shown able to report ABSENT.

**WITNESS 2 — the fix, as a differential in ONE run.** Their fixture run in a single Node process against
fixed `72996bce` and against the exact parent orchestrator blob `835e97a5`, all other files matching, same
baseline and edited git trees, separate disposable fixture DBs:

| arm | baseline | after changing only inner.js |
|---|---|---|
| fixed `72996bce` | 8/8 | **8/8** |
| reverted blob `835e97a5` | 8/8 | **2/8** (3 File IMPORTS + 3 symbol CALLS, zero unresolved) |
| full same-tree rebuild | — | 8/8 |

Both incremental arms advanced generation 1→2 and indexed `innerTwo`, so the action control holds in the
arm that passed as well as the one that failed. The negative control again returned exactly 7/8.

⭐ One run with the patch toggled is stronger than two runs of the same fixture, because no difference
between two environments can explain the pass. This is the only evidence here that the FIX works which was
not produced by the author of the fix.

⚠ THEIR SCOPING, CARRIED VERBATIM RATHER THAN SUMMARISED. This supports the repair of **this specific
synthetic class**. It does NOT support conservation for all refs, NOT the cause of the nine historical
missing edges, and NOT a clean provenance certificate for existing indexes.

⭐ PROVENANCE THAT SURVIVES, BECAUSE THE SUBJECT IS VERIFIABLE EVEN THOUGH THE SCRIPT IS NOT.
Their two arms were not hand-written approximations of this project's code: they name the exact git BLOBS
they ran. Verified here, in this repository, rather than taken on trust:

    git rev-parse 72996bce:mcp/stdio/freshness/orchestrator.js  →  55d4b6d24a53889f4aa4c68925cf26de426de762
    git rev-parse 871a1d65:mcp/stdio/freshness/orchestrator.js  →  835e97a58019d81e8328a462153414c8dec0cf62

Both match what they reported (fixed `55d4b6d2`, reverted `835e97a5`), and they state that `mcp/stdio` and
the package files outside the orchestrator did not differ between the two pinned clones. **A later reader can
re-derive those two blob hashes from this repository at any time**, which is a durable anchor for WHAT was
tested even though the instrument itself is not stored here.

⚠ THE INSTRUMENT ITSELF IS NOT DURABLE EVIDENCE AND IS NOT CITED AS SUCH. Their scripts live outside this
repository in a hermes cache directory, attested by SHA256: witness 1 output `fb904f47…a37b2f65`; witness 2
script `ref-conservation-paired-20260926.mjs` `4aecd113…9c32b8d8` and its output `5d6313a7…95da3a4`.
**A SHA256 attests integrity, not existence, and a cache has a deletion date** — their words, and the reason
those hashes appear here as attribution rather than as a pointer a reader could follow. They have made no
changes to this repository's tree.

## The specification the across-a-run check has to meet

Set by graph-senior-dev when granting permission to build on their fixture, and it is a harder bar than
the point-in-time check already shipped at `25d8c342`:

- **Distinguish a ref that SURVIVED unchanged from one whose source was intentionally removed or
  retargeted.** A ref that is gone because the file legitimately stopped referencing it is not a loss, and
  a check that cannot tell those apart reports noise or, worse, learns to ignore real losses.
- **Fail OBSERVABLY on a planted lost surviving ref** — naming the file, relation and target, not merely
  reporting that counts differ.
- **Portable inputs.** Adapt the fixture into this repository's tree with their authorship stated for the
  fixture and mine for the new instrument, carrying none of their cache paths.
- **Commit the script and its actual output together** if the run is cited at all.

## ⚠ THE COST CLAIM IS WEAKER THAN IT WAS FIRST WRITTEN

`reproduction-output.txt` says the worst case is "bounded by what a full rebuild costs anyway". Two
corrections, the second from graph-senior-dev's review:

1. What is **structurally** bounded is the number of files re-extracted: the closure cannot exceed the
   indexed file set, so it cannot re-extract more than a full rebuild does.
2. **Wall clock is not bounded by that, and one measurement is not a general upper bound.** The 50,799 ms
   against 48,935 ms pair is ONE hub file, on ONE repository, on ONE machine, in one run. A hub edit going
   from roughly 8.6s to ~50s is a significant regression and needs its own representative performance
   judgement rather than a single comparison. Recorded as an open cost question, not a settled trade.

The suite-scale figure, measured here: 962.95s against 904.39s for the same suite before the closure,
+58.6s or about 6.5%.

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
