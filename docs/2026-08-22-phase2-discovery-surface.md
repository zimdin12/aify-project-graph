# Phase 2 — what the document layer can actually be searched BY

Measured 2026-08-22 on this repo, 179 `Document` nodes, all readable on disk.

## The two probes ef-manager designed, both run

They asked for two, aimed at finding "a fourth mistake" after three attempts at the discovery slice.

### Probe 2 — a query with ZERO legitimate doc answers ✅ NO DEFECT

> *"a reserved slot is a strong incentive to promote something."*

| query | code hits | documents returned |
|---|---|---|
| `roadmap` | — | 2 ✔ **positive control: the slot fires** |
| `efficacy` | — | 1 ✔ |
| `resolve` | 22 lines | **0** |
| `upsert` | 13 lines | **0** |
| `blockchain`, `kubernetes`, `thermodynamics` | 0 | **0** |

⚠ The zero-match queries prove nothing on their own — nothing matched at all, so a broken slot and
a correct one look identical. The code-heavy queries are the real probe: `resolve` returns 22 lines
of code hits and still promotes **no** document. The reserved slot does not manufacture a doc answer
to fill itself.

### Probe 1 — a hit whose FILENAME contains no query word ✅ WORKS, via TITLE

`roadmap` returns `docs/code-intel-v2-status.md`, whose filename contains no query word. It matched
on `json_extract(extra,'$.title')` — *"Code-Intel v2 — delivery status, A/B findings, roadmap"*.

⇒ So the tool **does** clear the `ls docs/` bar the roadmap sets. Just not by much, which is the
next section.

## ⛔ THE SEARCHABLE SURFACE IS FILENAME ∪ TITLE. BODIES ARE NOT SEARCHED.

    CREATE VIRTUAL TABLE nodes_fts USING fts5(id UNINDEXED, label, tokenize = ...)

`nodes_fts` indexes **`label` only**. A `Document` node additionally carries `extra.title` and
`extra.summary`, and search queries the title directly. The `summary` is truncated to roughly 100
characters and is not queried. **No document body text is searchable anywhere in the system.**

Ten topic words this repo genuinely discusses, chosen before any result was looked at:

| topic | documents whose BODY contains it | documents whose NAME or TITLE contains it |
|---|---|---|
| overlay | 95 | **0** |
| clangd | 68 | 1 |
| sqlite | 58 | **0** |
| precision | 50 | 1 |
| staleness | 31 | **0** |
| worktree | 23 | 1 |
| mutation | 12 | **0** |
| compaction | 4 | **0** |
| tokenizer | 2 | **0** |
| heartbeat | 1 | **0** |

⇒ **7 of 10 have ZERO reachable surface.** For those, `graph_search` returns nothing and *cannot*
return anything — 203 document-mentions unreachable **by construction**, not by ranking.

`graph_search("sqlite", kind:"all")` answers `NO RESULTS` on the repository whose storage layer is
SQLite.

## ⛔ WHAT THIS IS NOT: A 99.4% MISS RATE

My first pass computed exactly that — 342 of 344 body-containing documents not returned — and it is
**not a defect rate and must not be quoted as one.**

"The word appears in the body" is not ground truth for "this document should be returned." A
document mentioning `sqlite` once in passing is not what someone searching `sqlite` wants, and
returning all 58 would be catastrophic precision. Treating word-containment as relevance is
*precisely* the error that produced the legacy `mentions` extractor and the "83.5% wrong" figure two
reviewers corrected independently. I reproduced it, on the same layer, in the same week.

⇒ The claim this evidence supports is about **CAPABILITY, not accuracy**: a topic that lives only in
document bodies is unreachable regardless of how relevant it is. Whether reaching it would be an
improvement is a separate question with a separate measurement, and this document does not answer it.

## What follows, and what does not

⚠ **Not a proposal to index bodies.** Full-text search over document bodies is the shape that
returns 95 documents for `overlay`, and the roadmap's own ruling is that removing false data
increases capability. An admission rule is needed here for the same reason it was needed for
doc→symbol edges, and [[adjacent-not-ambient]] applies: the evidence should be adjacent and
structural — a heading the topic appears under, a title, a first paragraph — not ambient
whole-document presence.

⚠ **`summary` is truncated at ~100 characters and is dead weight.** It is stored on every Document
node, is not searched, and is cut mid-word (*"Driven by `graph-tech-lead`. Ruled on by
`graph-senior-dev` (correctness, executed"*). Either it earns its place by being searchable or it
should go; today it is neither.

⇒ **The honest headline for Phase 2:** discovery by topic works when an author happened to put the
topic in the filename or the title. That beats `ls docs/`, and it is a long way from *"what do I
know that I have forgotten I know"*.
