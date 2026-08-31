# M0b — identity qualification: preregistration

Written **before** any corpus was indexed and before any number was read. M1 was going to build
per-identity caller sets on top of `canonicalSymbolKey`. Review's objection: that key is a
heuristic grouping key, not a resolved identity, and attaching caller sets to false groups
attaches real callers to symbols that do not exist. M0b decides whether M1 is *richer rendering*
or *identity repair*.

## What is already known from reading the source (not yet measured)

Both are disclosed in the code and are the reason the predictions below are shaped as they are.

- `generic.js` builds `stableId([type, filePath, qname])` with `qname = parentQname.name` or
  `moduleLabel.name`. **No signature.** The file's own comment says two overloads in one file
  "silently collapse into one node", and names the field report it caused (2026-07-27: a call
  from one overload to another returned as "this function is recursive"). Disclosure exists
  (`extra.overloads`, `overload_signatures`, `overload_lines`); the identity split does not.
- `symbol_lookup.js:canonicalSymbolKey` groups by `type:qname`, then `type:parentClass.label`,
  then `type:label:file_path`. `buildAmbiguousMatchMessage` states the merge as *intended*:
  "Overloads and the C++ decl/def split share a canonical key → one group → not ambiguous."

⚠ Reading source is not measuring behaviour. Every claim below is a **prediction**, and the run
that tests it may falsify any of them. Predictions are recorded so a wrong one is visible as
wrong rather than quietly rewritten afterwards.

## Populations

⚠ **AMENDED BEFORE ANY RUN, ON REVIEW'S RULING.** My first draft had two arms and asked arm B —
~15 files from `node_modules/tree-sitter` and `node_modules/better-sqlite3` — to carry a
**prevalence** statement ("how often each hostile shape occurs in real code"). Review rejected it,
and the objection is not only that n=15: the files sit inside two dependencies **selected by
availability**, so they are not a sampling frame at all. "2 of 15 files" would describe those
exact files and nothing else, and — the sharper half — **zero occurrences would not establish
rarity**. I had built a probe whose null result I would have had no right to read.

Three separate arms, with three separate and separately-labelled claims:

**Arm 1 — synthetic C++ mechanism qualification.** A hostile fixture in `tests/fixtures/`, ground
truth frozen in JSON beside it, covering the exact identity classes: overloads, decl/def, repeated
`extern`, `static`/anonymous-namespace twins, templates and operators, cross-language homonyms.
Decides whether the identity rule can *distinguish the known classes*. **Scale claim: zero.**

**Arm 2 — large real non-C++ scale qualification.** This pinned APG snapshot, at realistic graph
size: high-frequency names, >50-row retrieval, candidate totals, output caps, latency, and
per-identity grouping. Tests the **scale machinery**, and explicitly does not pretend to validate
C++ semantics.

**Arm 3 — bounded natural-C++ smoke, optional and cheap.** The exact 22-file, two-package snapshot
recorded in `CORPUS.md` with per-file hashes. Reported only as:

> bounded observation on an exact 22-file / two-package snapshot; **not a prevalence estimate and
> not representative of C++ repositories**

The copied tree is **not committed** — a manifest plus hashes identifies the observation, and the
tree is deleted when M0b closes. After `node_modules` changes those bytes are *identified but not
locally rehydratable*, and that is stated rather than papered over with a vendored copy.

## Predictions, assigned before the run

| # | Shape | Predicted carrier behaviour | Verdict if wrong |
|---|---|---|---|
| P1 | two same-name overloads, **one file** | 1 node; `extra.overloads = 2` present | disclosure is absent or the count is wrong |
| P2 | free function declared in `.h`, defined in `.cpp` | **2 nodes, 2 canonical keys** (`qname` embeds the per-file module label) — a FORK of one symbol | prediction wrong; record it |
| P3 | method declared in `.h`, defined in `.cpp`, same class | **1 canonical key** — correct merge | the decl/def merge does not work as the comment claims |
| P4 | class `Foo` in two namespaces, each with `bar()` | **1 canonical key** — a FALSE MERGE of two symbols, undisclosed | prediction wrong; record it |
| P5 | `static` / anonymous-namespace twin in two `.cpp` | 2 keys (correct fork), but **no linkage field** marks them internal | linkage is modelled after all |
| P6 | a name whose definitions exceed the retrieval cap | group count reported is the count among **retrieved** rows, not the population | the cap is already handled |

## Identity rule for grading

A **distinct symbol** is a distinct (fully-qualified name, parameter signature, linkage) triple, as
established by reading the C++ source directly — not by any field our extractor produced.

A declaration and its definition are **one** symbol. Two overloads are **two**. A `static` function
in `a.cpp` and one in `b.cpp` sharing a spelling are **two**.

⛔ **THERE IS NO INDEPENDENT IDENTITY ORACLE ON ARMS 2 AND 3.** Grading a tree-sitter grouping with
a second tree-sitter query is one instrument read twice. So those arms report only findings that
are **self-evidencing from the extractor's own disclosed output** — a node whose own
`overload_signatures` lists two distinct signatures has, on its own account, merged two
definitions a compiler keeps apart, and no outside adjudication is needed to read that. Arm 1 is
the only arm with frozen ground truth, and it is synthetic, and that is the trade.

## Metrics

Per shape: nodes produced, canonical keys produced, **merges** (distinct symbols sharing a key),
**forks** (one symbol split across keys), whether the merge/fork is disclosed in any emitted field,
caller attribution, truncation, response bytes, latency.

## Controls, required in the same pass

- **liveness** — extraction must have produced symbols at all. A corpus that silently extracted
  nothing reports zero merges and reads exactly like a clean bill of health.
- **positive** — at least one symbol must be unique: one node, one key, no collision. If nothing
  groups cleanly, grouping is broken for an unrelated reason and no shape-specific verdict holds.
- **negative** — a spelling that appears nowhere must produce **zero** groups. A counter that
  cannot return zero cannot return a count.
- **drift** — the copy of `canonicalSymbolKey` in the harness is checked against the three real
  branches in `symbol_lookup.js` on every run, and the run aborts if they differ. A silent copy is
  how a measurement starts describing code that no longer exists.

## Abandon rule, preregistered

If arm 1 shows **no** false merge and **no** undisclosed fork, M0b's premise is wrong, M1 proceeds
as richer rendering, and this document says the objection was not borne out — rather than hunting
a different population until one produces a defect.

## Claim ceiling

Arm 1: "the identity rule does/does not distinguish these classes." Arm 2: "the scale machinery
behaves thus at this graph size, on non-C++ code." Arm 3: "these exact files contained these
shapes." **No percentage is reported without its exact noun, and no arm claims field prevalence
for C++** — that gap is carried into M5, which must state its own prevalence noun: one repo gives
prevalence *within that snapshot*; cross-repo prevalence needs independently selected repos and a
stated sampling frame.
