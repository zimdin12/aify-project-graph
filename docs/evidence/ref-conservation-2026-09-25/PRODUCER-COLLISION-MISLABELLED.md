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
to an attempted row carrying **the same normalized label** — so the raw comparison reports a difference
that the stash alone accounts for. ⚠ Deliberately *not* "the same producer": what those rows are is
undetermined, for the reasons in *The correction has its own correction*.

Counted over the 25 sample rows the file itself commits:

| pairing | rows | what it is |
|---|---|---|
| `ts-langserver#nohash\|was:EXTRACTED::javascript::0.9` vs `ts-langserver#nohash` | **20** | **normalized-label-EQUAL.** ⛔ NOT proven to be "the same producer" — see *The correction has its own correction* |
| `EXTRACTED/javascript` vs `LSP_VERIFIED/ts-langserver#nohash` | 4 | different labels; REF/DIRECT by source |
| `EXTRACTED/shader-bindings` vs `EXTRACTED/glsl` | 1 | **genuinely two producers, traced to two source sites** (REF/REF) |

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
| one edge can have two producers | **STANDS** — established by the REF/REF **source sites**, not by labels, and it is the whole justification for `PRODUCER_ID` |
| "88 cross-**labelled** collision attempts" (the plan's wording) | **TRUE** — the labels did differ |
| "88 CROSS-PRODUCER" (this file's wording) | ⛔ **MISLABELLED / UNSUPPORTED — not "false as a count".** The *classification* is wrong: the census had no access to producer identity, so it was not entitled to that noun. ⚠ The numerical proposition *"the true cross-producer count is 88"* has **not been disproved** — it is unknown, and 88 could coincidentally be right. Saying FALSE would assert the count is wrong, which nothing here shows |
| the genuine cross-producer attempt count | ⛔ **UNKNOWN, with NO BOUND.** An earlier version of this note said "strictly < 88"; that followed only from reading label-equality as producer-sameness, and is **withdrawn** |
| `source_file` equal 88 / unequal 0 | ⚠ **population misdefined** — it is a cross-**labelled** population, not a producer-level one. The zero is **not refuted**; no producer-level verdict may be drawn from it |

## The correction has its own correction

⛔ **This note's first version said the 20 rows were "the same producer colliding with itself". That
was the same category error one step cleaner** — a *stripped* extractor string is still a label, not an
identity. Caught by graph-senior-dev in the commit that introduced it. The normalized label fails as an
identity in both directions:

- **It over-merges.** `code-intel/runner.js:15` maps **both** `typescript` and `javascript` to the
  provider name `ts-langserver`, written from the single `PROVIDER_NAME` at
  `code-intel/providers/ts-langserver.js:15`. One label, two collection routes.
- **A label-equal repeat is expected for an unrelated reason.** `importer.js:873-886` dedups reference
  records on `(from, to, relation, source_line)` then calls `upsertLspEdge`, while the **edge key
  ignores `source_line`**. One provider attempts the same triple once per call site, so every attempt
  after the first collides. The repeats are an artefact of per-line dedup against a line-agnostic key —
  which explains the rows without establishing anything about producer count.

⇒ **Producer identity is not determinable from any stored field.** Not the raw `extractor`, not the
normalized one. ⭐ **Normalising a label does not promote it to an identity**; it removes one known way
of being wrong and leaves the category error untouched. The test is **"is there exactly one writer of
this value, and does that writer correspond 1:1 to the thing being counted"** — here, no on both.

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

A rerunnable per-attempt census that emits one row per collision attempt, **records or independently
derives PRODUCER IDENTITY AT EMISSION under a frozen written definition of "producer"**, and carries a
hash-bound receipt. ⛔ Stripping `STASH_SEP` and comparing the cleaned string is **the defect, not the
fix**. **Not yet run.** Until it exists, no figure
from this file may be described as a count of producers.
