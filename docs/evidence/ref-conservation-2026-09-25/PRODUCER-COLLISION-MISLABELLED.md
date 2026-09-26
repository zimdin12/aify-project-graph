# `producer-collision-output.txt` says CROSS-PRODUCER. It is not.

**2026-09-26.** This annotates `producer-collision-output.txt`. **That file is captured program output
and has deliberately NOT been edited** — correcting a recorded stdout would destroy the evidence of
what the instrument actually printed. The defect is in the label the program chose, so the correction
belongs beside it.

## What the file claims

```
    of which CROSS-PRODUCER (the mechanism in question)   : 88
  source_file AGREES             : 88  <- positive control: the comparison runs
  ⛔ source_file DISAGREES        : 0
  => limb two NOT reachable via this path in this repository
```

## What it measured

The census keyed "cross-producer" on the raw `edges.extractor` string. That string is **not a producer
identity**. `mcp/stdio/ingest/code-intel/importer.js:299` defines:

```js
export const STASH_SEP = '|was:';
```

The code-intel importer appends `|was:<provenance>:<extractor>:<confidence>` when it **promotes** a
heuristic edge, so invalidation can later **restore** the original (`importer.js:349`, `:650`). It is a
restoration stash. A row whose retained `extractor` carries that stash therefore compares **unequal**
to the very same producer re-emitting the same triple.

Counted over the 25 sample rows the file itself commits:

| pairing | rows | what it is |
|---|---|---|
| `ts-langserver#nohash\|was:EXTRACTED::javascript::0.9` vs `ts-langserver#nohash` | **20** | ⛔ **the SAME producer colliding with itself** |
| `EXTRACTED/javascript` vs `LSP_VERIFIED/ts-langserver#nohash` | 4 | genuinely different producers (REF/DIRECT) |
| `EXTRACTED/shader-bindings` vs `EXTRACTED/glsl` | 1 | genuinely different producers (**REF/REF**) |

Reproduce that split from the committed file alone:

```bash
grep -oE 'retained \S+.*attempted \S+' producer-collision-output.txt \
  | sed -E 's/\|was:[^ ]*//g' \
  | awk '{ for(i=1;i<=NF;i++){ if($i=="retained") r=$(i+1); if($i=="attempted") a=$(i+1) } print (r==a ? "SAME" : "DIFF") }' \
  | sort | uniq -c
```

## What changes, and what does not

| claim | status |
|---|---|
| one edge can have two producers | **STANDS** — the REF/REF row is real, and is the whole justification for `PRODUCER_ID` |
| "88 cross-**labelled** collision attempts" (the plan's wording) | **TRUE** — the labels did differ |
| "88 CROSS-PRODUCER" (this file's wording) | ⛔ **FALSE** |
| the genuine cross-producer attempt count | ⛔ **UNKNOWN, strictly < 88.** 25 rows cannot fix the ratio over 88, and this note does not extrapolate |
| `source_file` equal 88 / unequal 0 | ⚠ **population misdefined.** The denominator included same-producer rows, so the genuine `n` is smaller and unmeasured. The zero is **not refuted** — it is unsupported at the stated size |

⛔ **"limb two NOT reachable via this path in this repository" is withdrawn as a supported conclusion.**
Not contradicted — unsupported, because the set it was computed over is not the set it names. A
separate liveness run (`comparator-liveness-output.txt`) independently showed the comparator *can*
return unequal, so the instrument works; it is the population that was wrong.

## Why this happened, and the transferable part

⭐ **Before counting how many X differ, ask whether the field you compared is the IDENTITY of X, or a
field something else also writes to.** `provenance` and `extractor` are rewritten by the CODE_INTEL
override path (`storage/edges.js:6-17`) and annotated by the promotion stash. This is the same defect
as the ref-conservation join key, one layer out: there a node's *address forms* stood in for the node,
here an extractor *string* stood in for the producer.

It is also why the three-record design forbids reading `PRODUCER_ID` back off the deduplicated edge
and requires the producer to record it at emission. That rule was written before this was found, and
this is evidence for it rather than against it.

## Owed

A rerunnable per-attempt census that emits one row per collision attempt, strips `STASH_SEP` before
comparing producers, and carries a hash-bound receipt. **Not yet run.** Until it exists, no figure
from this file may be described as a count of producers.
