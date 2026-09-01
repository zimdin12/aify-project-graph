# FINDING — `unresolved_refs` cannot answer M2's "what was NOT modelled". Measured, then abandoned.

## The idea, and why it looked right

M2 asks results to *"state what was NOT modelled (indirection, macros, conditional compilation,
extern-without-header, included .cpp, cross-language)"*. The repo already has a table that sounds
exactly like that: `unresolved_refs`, 39,971 rows, each a reference the resolver saw and did not
turn into an edge, carrying `target`, `relation`, `source_file` and `refused_reason`.

The proposed rule: when a verb is about to say "NO CALLERS for X", check for unresolved refs whose
`target` is X. If any exist, we saw references to that name and could not model them — so the
absence is not what it looks like. Graph-native, no text scan, no new collection.

## What the measurement said

```
-- unresolved CALLS, by refused_reason --
   4563  CALLS  common-name-not-worth-minting
     37  CALLS  fragment-shape-not-minted

distinct targets among unresolved CALLS: 32
top: push 1287, map 701, filter 530, get 370, test 229, run 184, set 181, close 166, parse 155, log 125
```

**All four `refused_reason` values in the whole table describe the resolver's own MINTING POLICY**
— `references-bare-local-name`, `common-name-not-worth-minting`, `relation-not-admitted:IMPORTS`,
`fragment-shape-not-minted`. None describes a language construct. The table records *what we chose
not to mint*, not *what the analysis structurally cannot see*.

The 32 targets settle it: they are `Array.prototype.push`, `Array.prototype.map`, `console.log`.
An unresolved `push` is not evidence about anybody's `push`.

**Would-fire rate**, the number that killed it: of **1,222** symbols with zero modelled callers,
the rule fires on **42 (3.4%)** — and the sample is `run`, `read`, `log`. Generic names, near-certain
false positives, attached to the most dangerous output the verb produces.

⇒ **Abandoned before implementation.** Right-shaped question, wrong substrate.

## ⛔ And the corpus cannot validate the alternative either

Every category M2 names is C/C++-specific. This repo's `unresolved_refs` are **39,895 javascript,
3 cpp, 1 c**. A detector for macro-generated calls or `#ifdef`-excluded code would be built and
tuned on a population that does not contain the phenomenon — correct code, measured against nothing.
Validating one needs a real C++ corpus, which is M5's precondition, not this milestone's.

## What IS establishable without a corpus

That the constructs are unmodelled is a fact about the extractor, verifiable by reading it, and it
does not need a population at all:

- `mcp/stdio/ingest/languages/cpp.js:422` already states it: *"every macro-mangled shape produced
  no qualified symbol at all."*
- The only preprocessor handling in that module is `preproc_include` (imports) and
  `blankCppClassHeadMacros`, which blanks an export macro between `class` and the name. There is
  **no `#if`/`#ifdef` evaluation anywhere in it**, and no function-pointer or `std::function`
  indirection handling.

⚠ And the limit is not confined to the heuristic tier. clangd resolves one **compile
configuration**, so code behind an inactive `#ifdef` branch is invisible to it too. That applies to
the strongest evidence tier we have, and nothing in the output says so today.

## Claim ceiling

This finding rejects one substrate. It does not establish how often unmodelled constructs cause a
wrong absence in real C++ — that is unmeasured here and unmeasurable on this corpus.
