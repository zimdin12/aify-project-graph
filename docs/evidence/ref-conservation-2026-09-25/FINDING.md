# Conservation of refs: the class is real, four more specimens, and my earlier refutation was void

2026-09-25, at `e3c25113`. Follow-on from `docs/evidence/zero-caller-audit-2026-09-25/FINDING.md`,
which verified one silently dropped caller set (`graphPacket`) and could not name a mechanism.

## What changed about the method

The plan was to diff an incremental graph against a forced rebuild at the same commit. That treats
the rebuild as ground truth, and nothing had established that it is: **if both builds lose the same
ref, the diff is empty and reads as clean** — a wrong zero inside the instrument hunting wrong zeros.

`scripts/audit-ref-conservation.mjs` compares the graph against the EXTRACTOR'S OWN OUTPUT instead,
which is upstream of both builds. The invariant: a ref extraction emits must end as an edge or as an
`unresolved_refs` row. Anything that is neither was dropped, and nothing recorded the drop.

## 1. The instrument, and the two times it was wrong before it was right

| version | key | positive control | why it was wrong |
|---|---|---|---|
| 1 | `(file, line, relation)` over `SELECT DISTINCT file_path FROM nodes` | 65.20% | ⛔ population: nodes exist for files the pipeline never extracts refs from. `node_modules/typescript/lib/typescript.d.ts` alone contributed 3,359 phantom losses |
| 2 | `(file, line, relation)` over the indexer's own enumeration | 68.59% | ⛔ key: `edges` is deduplicated on `(from_id, to_id, relation)` — 36,635 rows, 36,635 distinct triples, **max 1 distinct `source_line` per triple**. A symbol called from twenty lines of one file keeps one row, so nineteen "losses" are the key's fault |
| 3 | `(file, relation, target-name)` over the indexer's own enumeration | **90.19%** | usable |

⭐ Both wrong versions produced a number that looked like a catastrophic defect. Neither was
discovered by suspicion; both were caught by the positive control being implausible. **A 65% reading
is not a finding, it is a broken instrument.** The control is what separated the two.

Version 3 at `e3c25113`, controls in the same run: FRESHNESS same tree; NEGATIVE a fabricated target
reported MISSING; POSITIVE 41,519 of 46,033 emitted keys recorded. Raw: `conservation-output.txt`.

Residual, and what it is: **4,488 IMPORTS** (the key's fault again — an import target is a module
path, the resolved node's label is a symbol, so they cannot match; the check does not describe
IMPORTS and should not be read as if it did), **9 CONTAINS** in C++ fixtures, and **17 CALLS**. Of the
17, thirteen are import aliases (`import { validate as validateSemantic }` — the ref carries the local
name, the node carries the real one) and four are real.

## 2. ⭐ THE CLASS, REPRODUCED AS A COMPARISON AT ONE COMMIT

A full build in a disposable worktree at `e3c25113` against the live incremental graph at the same
commit — generation 548, the graph agents actually read:

| symbol | caller the graph should hold | FULL build | INCREMENTAL build | refusal row |
|---|---|---|---|---|
| `splitVolatile` | tests/unit/scripts/volatile-line-exclusion.test.js:29 | 2 callers, 1 from the test | **1 caller, 0 from the test** | 0 |
| `volatileShapeOk` | tests/unit/scripts/volatile-line-exclusion.test.js | 2 callers, 1 from the test | **1 caller, 0 from the test** | 0 |
| `printRefusal` | tests/unit/scripts/refusal-presentation.test.js:23 | 2 callers, 1 from the test | **1 caller, 0 from the test** | 0 |
| `publishBaseline` | tests/unit/scripts/baseline-publication.test.js:34 | 2 callers, 1 from the test | **1 caller, 0 from the test** | 0 |
| `graphPacket` | scripts/demo-verify-ab.mjs | 18, 1 from it | 18, 1 from it | 0 |
| `canonicalise` | tests/unit/scripts/ab-graph-effect.test.js | 3, 1 from it | 3, 1 from it | 0 |

The last two are the control in the agreeing direction: two symbols where the builds match, in the
same query, so a systematic offset between the two graphs would show up there too. It does not.
All four callees live in `scripts/refactor-guard.mjs`; all four callers import them by name, not by
alias, so the key is not at fault. **None of the four was found by the rebuild** — the conservation
check named them from extractor output alone, which is the point of building it that way.

⚠ The two builds differ in total size (7,268 nodes / 33,822 edges full, 7,733 / 36,635 incremental)
because the working tree carries untracked files a worktree checkout does not. That is why the table
compares per-symbol caller sets and not totals.

## 3. ⛔ MY EARLIER REFUTATION WAS VOID, AND THE REASON IS WORTH MORE THAN THE REFUTATION

The 2026-09-25 zero-caller finding says: hypothesis — editing the defining file re-mints its site ids
and orphans incoming edges; test — inserted a comment above the definition in `packet.js`, ran one
incremental index, the 18 caller edges survived; verdict — refuted.

**That test exercised nothing.** Two separate reasons, each measured today:

1. **An uncommitted edit does not reindex.** `ensureFresh` is driven by the commit. A manual reindex
   over a dirty tree reported `from e3c25113 to e3c25113`, generation unchanged at 548, node and edge
   counts identical to the byte.
2. **A comment-only edit does not re-extract, even committed.** E3: four comment lines inserted ABOVE
   `splitVolatile`, committed, indexed — its `start_line` stayed 301 and its node id stayed
   `a43e7165cd74`. The structural fingerprint does not move for a comment, by design.

So the probe that "refuted" the hypothesis may never have re-extracted the file it edited. **A test
that cannot exercise its subject cannot refute anything**, and it reported a null that agreed with
nothing in particular, so nothing prompted a check. The lesson is the one already in the casebook and
I did not apply it: an experiment needs an ACTION CONTROL proving the action happened, not only a
result.

### Re-run properly, the hypothesis is refuted for real

E3b: a real function inserted above `splitVolatile`, committed, one incremental index.
- ACTION CONTROL: `e3ShiftFn` present at `scripts/refactor-guard.mjs:305`. The file was re-extracted.
- `splitVolatile` moved 301 → 309 and its node id was **re-minted**, `a43e7165cd74` → `9425b64fefdb`.
- Its caller edges, including the cross-file one from the test, **SURVIVED**.
- E4, one further index after an unrelated file changed: still present, for all four symbols.

⇒ Re-minting a callee's node id does not, by itself, lose its incoming cross-file edges. Refuted with
an action control this time.

## 4. ⭐ SILENT CROSS-FILE EDGE LOSS, REPRODUCED IN A CONTROLLED RUN

E2, in the worktree: a real function appended to `scripts/ab-graph-effect.mjs`, committed, one
incremental index, with the whole edge set snapshotted either side.

- ACTION CONTROL: the new symbol is in the graph.
- **45 edge rows vanished across 35 keys. 2 were gained.**
- Every one of the 45 points at a node labelled `key` whose file is
  `tests/unit/scripts/ab-graph-effect.test.js` — **the file edited in the PREVIOUS run, not this one.**
- The 45 lost edges are owned by 35 other files across `mcp/`, `scripts/` and `tests/`. **This run
  re-extracted none of them.**

So an incremental run deleted edges belonging to files it did not touch, pointing at a symbol whose
node was re-minted one run earlier. That is cross-file edge loss with a one-run lag, and the refs that
produced those edges live in files nothing re-extracts, so nothing regenerates them.

⚠ Honest limit on this instance: I snapshotted the EDGE table either side, not `unresolved_refs`. That
those 45 disappeared is measured; that they disappeared SILENTLY is not measured for this instance.
Silence is measured for the four CALLS specimens in §2, which carry 0 refusal rows in the live graph.

⚠ And the shape differs: 44 of the 45 are REFERENCES to a short ambiguous name, not CALLS to an
imported one. So this reproduces the FAMILY, not the specimens.

## What is settled and what is not

**PROVEN.** The class is alive at HEAD. Four caller edges a full build holds are absent from the
incremental graph with no refusal row. A conservation check finds them without a rebuild as oracle.
Edges are line-deduplicated. Comment-only and uncommitted edits do not re-extract. Re-minting a node
id does not by itself drop incoming cross-file edges. An incremental run can delete edges owned by
files it did not re-extract.

**NOT IDENTIFIED.** Which run dropped the four CALLS specimens, and why the re-point that saved
`splitVolatile` in E3b did not save it across 548 generations of real history. The reproduced loss is
in the same family, not the same shape.

**NOT MEASURED.** A rate. n=4 verified specimens plus 1 from the earlier audit, on one repository.
This establishes that the class is open, which is what the roadmap needs, and nothing about frequency.

## Next, in order

1. Snapshot `unresolved_refs` as well as `edges` around each run, so "silent" is measured rather than
   inferred, and re-run the E1/E2 sequence to see whether a refusal row is ever written.
2. Replay real history in a worktree, indexing at every commit that touched `scripts/refactor-guard.mjs`
   or its three test callers, and find the run at which the edge disappears. That is the mechanism.
3. Make the conservation check a guard, not a script: it fails closed, needs no mechanism, and would
   have caught all five specimens. ⚠ Pre-registered limit, before it exists: conservation cannot catch
   a SHORT EXTRACTION. If the extractor under-emits, the invariant holds trivially at the lower number.
   It guards the path from extraction to storage, and nothing upstream of extraction.

## Files

`conservation-output.txt` (the run at `e3c25113`), `scripts/audit-ref-conservation.mjs` (the
instrument, with its population and key mistakes recorded in its header so they are not repeated).
