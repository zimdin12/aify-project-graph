# OPEN DEFECT — the resume ledger's witness is global, so it can skip work it should redo

**Status: OPEN.** Not fixed by the typed zero-files reason. That change fixes the **reporting**
authority; this is the **correctness** defect underneath it, and conflating the two would let a
reporting fix be read as a repair.

## The defect

`readLedger(projectRoot, dbHash, graphWitness)` resets a ledger whose evidence no longer survives.
Its survival test is `ledgerEvidenceSurvives`:

```js
return graphWitness.verifiedEdges > 0 && graphWitness.intelRecords > 0;
```

Those are **global counts** over the whole graph. So the check answers *"does some LSP evidence
exist anywhere?"* — never *"does the evidence for the files this ledger claims still exist?"*

⇒ A ledger claiming 200 collected files is upheld by **one unrelated surviving edge and one
unrelated surviving record**. Collection then skips those 200 files and returns zero, having
recollected nothing.

## Why the obvious binding does not work

The natural fix — require each claimed file to have surviving evidence — was measured against the
live graph before being proposed:

```
files with code_intel_records            640
files with LSP_VERIFIED edges             28
record-bearing files with ZERO edges     612 of 640   (96%)
edge-bearing files with ZERO records       0 of 28
```

**Requiring a per-file `LSP_VERIFIED` edge would make the check fail-closed and inert for 96% of
the population.** A file can legitimately produce records and no edges. Edges are a strict subset
of records here, so per-file edge membership cannot be the authority.

Per-file **record** membership covers all 640, but `code_intel_records` carries no generation or
content lineage, so a **stale record at the same path satisfies a filename subset** after the
source has changed. Filename membership is a stronger heuristic than a global count; it is still
not lineage, and it must not authorize the sentence *"their evidence survives"*.

## What the typed-reason change did and did not do

**Did:** removed the C++ `already_collected` note, so a converged C++ resume can no longer *claim*
completion. It returns `status: 'partial'`, `complete: false`, no authoritative note, and the
summary maps that to `ZERO_FILES_CAUSE_UNKNOWN` with authority `none`.

**Did not:** make the ledger's skip decision correct. Unrelated global evidence can still uphold a
stale ledger, the claimed files are still skipped, and the collection still returns zero.

⇒ The change stops that zero **masquerading as completion**. It does not recollect the missing
evidence. **The 2026-08-20 Sand Castle class is NOT operationally closed by it.**

## What closing it requires

A persisted per-file collection witness: collection/generation identity, canonical repo-relative
path, and evidence membership or a content hash — compared against what the graph holds now. Until
that exists, no code path may state that a specific file's evidence survived.

⚠ Path handling is a trap in its own right and must be pinned when this is built: records store
repo-relative paths, ledger entries store compile-DB paths (often absolute), and the two are
compared today only by exact string. Normalise too little and the check never matches — fail-closed
but **silently inert**, which looks exactly like success. Normalise too loosely and unrelated files
satisfy it. Any implementation needs a correctly-bound positive **and** a same-basename/wrong-path
negative, or it proves nothing.

## Provenance

Measured 2026-09-01 on this repo's graph while designing `index.zeroFilesProcessed`. Raised by
review, which rejected both the global-count witness and the filename-subset binding I proposed to
replace it.
