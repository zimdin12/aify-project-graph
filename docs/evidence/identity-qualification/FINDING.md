# M0b — the identity carrier, measured

Preregistration: `PREREGISTRATION.md` (predictions assigned before any run). Raw:
`ARM1-GRADED.json`, `COLLISION-CONTRAST.json`, `ARM2-SCALE.json`,
`RESULTS.arm1-synthetic-hostile.json`, `RESULTS.arm3-bounded-cpp-smoke.json`. Corpus
provenance: `CORPUS.md`. Harnesses: `scripts/identity-grade.mjs`,
`scripts/identity-collision-contrast.mjs`, `scripts/identity-scale-arm2.mjs`,
`scripts/identity-qualification.mjs`.

## The verdict, first

**The identity carrier is not sound on the hostile population. M1 is identity repair, not richer
rendering of existing groups.** The preregistered abandon rule — "if arm 1 shows no false merge
and no undisclosed fork, the objection was not borne out" — **did not fire.**

Building per-identity caller sets on `canonicalSymbolKey` today would attach real callers to
symbols that do not exist, and would silently omit callers of symbols the graph deleted.

## Arm 1 — 16 ground-truth symbols, graded against frozen truth

Controls: liveness PASS, positive PASS, negative PASS.

| verdict | n | which |
|---|---|---|
| MATCHED | 10 | including both `static` twins and the anonymous-namespace twin |
| FORKED | 2 | `alpha::Widget::render()`, `alpha::Widget::measure(int) const` |
| ABSORBED_DISCLOSED | 1 | `alpha::clamp(double)` — merged into `clamp(int)`, and `overload_lines` records it |
| ABSENT_FROM_GRAPH | 3 | `beta::Widget`, `beta::Widget::render()`, `::externally_declared(int)` |

`linkage` is modelled nowhere: **false**.

### The two that matter

**A declaration and its definition get two different keys.** `alpha::Widget::render()` is one
symbol. The carrier gives it `Method:src.shapes.Widget.render` (header) and `Method:Widget.render`
(implementation), because `qname` embeds the *per-file module label* when a class node is in
scope and falls back to the bare class label when it is not.

⛔ **This contradicts a comment in the shipped code.** `buildAmbiguousMatchMessage` states the
merge as intended: *"Overloads and the C++ decl/def split share a canonical key → one group → not
ambiguous."* Measured, they do not share a key. The ambiguity refusal therefore fires on symbols
that are one symbol — and note the second half of the asymmetry: the implementation-side key
`Method:Widget.render` carries **no namespace and no file**, so it collides with any other class
named `Widget` anywhere. One asymmetry produces the fork and the collision at once.

**Two classes with the same leaf name in different namespaces: the second one is deleted.**
`beta::Widget` and `beta::Widget::render()` produce no nodes at all, and nothing in the emitted
data records that they existed. `extra.overloads` does not fire, because that disclosure only
triggers when signatures *differ* — and identical signatures are exactly the case where two
distinct symbols collide. **The disclosure mechanism is blind in precisely the case it was built
for.**

### The mechanism was measured, not assumed

The grader deliberately calls this `ABSENT_FROM_GRAPH` and names no mechanism, because
never-extracted and extracted-then-dropped look identical from there — and an earlier draft called
it `MISSING`, which reads as a parser gap and would have sent the repair to the wrong layer.

The contrast settles it: rename **only** the second class, change nothing else, re-extract.

```
baseline symbol nodes : 14
mutant symbol nodes   : 17
appeared: Class src/shapes.h:27 · Method src/shapes.h:29 · Method src/shapes.cpp:24
VERDICT: IDENTITY COLLISION — the parser saw these symbols in both runs;
         the identity key discarded them in the baseline
```

The mutation is asserted before any conclusion is drawn from it, including an assertion that the
*first* `Widget` was **not** renamed — a contrast that quietly renamed both would measure a
different thing and still print a number.

## Predictions: two confirmed, two falsified, one worse than predicted, one untestable

| # | prediction | outcome |
|---|---|---|
| P1 | same-file overloads merge, `overloads` discloses | **CONFIRMED** |
| P2 | free function decl in `.h` + def in `.cpp` → 2 nodes, 2 keys | **FALSIFIED** — the header declaration produces **no node at all**; one node, one key. Not a fork, an omission |
| P3 | method decl + def → 1 key, correct merge | **FALSIFIED** — it **forks**, and the shipped comment says otherwise |
| P4 | same class name in two namespaces → 1 key, false merge | **CONFIRMED, AND WORSE** — not a shared key: the symbol is **deleted**, undisclosed |
| P5 | `static` twins fork correctly, linkage unmodelled | **CONFIRMED** — but they fork because `qname` is file-scoped, not because linkage is understood. Right answer, wrong reason |
| P6 | high-cardinality name reports a capped count as the population | **UNTESTED** — see arm 2 |

Recording P2 and P3 as falsified matters more than the confirmations: I had reasoned both from
reading the source, and reading source is not measuring behaviour.

## Arm 2 — scale machinery, on this APG snapshot (JavaScript, not C++)

Controls: negative PASS, positive PASS (`#require` resolves and is not ambiguous), liveness PASS.
6,007 nodes. Ambiguity fires on all 15 busiest names; refusal messages are 799–1,586 bytes;
latency is sub-millisecond after warm-up (9.6 ms first call, then 0.11–0.40 ms).

⛔ **The cap — the one thing this arm existed to qualify — was not reachable.** The busiest name in
this graph has 37 definitions against a 50-row `LIMIT`. Nothing hits it, so **P6 remains untested
and the cap is unqualified.** Reporting the arm as "machinery behaves" without this would be a
pass earned by a population that could not fail.

⚠ One denominator note against myself: my `SELECT` counted only `Function|Method|Class` (37 for
`git`) while `resolveSymbol` matches more than those types (38 rows). The gap is in **my** query,
not theirs, and is recorded so the two numbers are not read as a discrepancy in the carrier.

## Arm 3 — bounded observation on real C++

> bounded observation on an exact 22-file / two-package snapshot; **not a prevalence estimate and
> not representative of C++ repositories**

389 symbols, 389 distinct canonical keys, 0 cross-file key collisions, 1 disclosed within-file
overload merge (`ThrowSqliteError`, 2 definitions), and **69 decl/def key asymmetries** — every one
the same header-vs-implementation shape arm 1 isolated, e.g.:

```
src/parser.h:13   -> Method:src.parser.Parser.Init
src/parser.cc:112 -> Method:Parser.Init
```

Verified at the source by hand for that one pair: `node_tree_sitter::Parser::Init` is declared at
`parser.h:13` and defined at `parser.cc:112`. One symbol, two keys — and **neither key contains the
namespace**.

The corpus is identified by `CORPUS.md` (package, commit, per-file SHA-256) and is **not
committed**. After `node_modules` changes those bytes are identified but not locally rehydratable.

## A near-miss in evidence custody, recorded because it nearly published unsupported numbers

The arm-3 harness wrote every run to one `RESULTS.json`. I ran arm 1 after arm 3, which
**overwrote arm 3's raw results**, and then deleted the corpus as preregistered. For a short
while this document cited 389 symbols and 69 asymmetries with no file behind them and no corpus to
regenerate from — the exact shape of a claim that survives only because nobody re-derives it.

Recovered rather than reasoned around: `node_modules` still held the originals, so the corpus was
rehydrated and **all 22 files verified byte-identical to the SHA-256 values in `CORPUS.md`**
before anything was re-run. Both arms then reproduced the same numbers exactly. That check is also
the first real test of `CORPUS.md` as an identifier, and it passed.

The harness now writes `RESULTS.<arm>.json`, so two arms cannot occupy one slot. The single-file
output was the defect; deleting the corpus merely made it visible.

## What M0b does not show

- **No prevalence claim for C++.** Arm 3's files were selected by availability inside two
  dependencies; they are not a sampling frame, and a zero there would not have established rarity.
  That gap goes to M5, which must state its own prevalence noun.
- **The retrieval cap is unqualified.** No population here reaches it.
- **Arm 1 is synthetic.** It is the only arm with an oracle, and that is the trade.
- **Arms 2 and 3 have no independent identity oracle** — a second tree-sitter query over the same
  substrate is one instrument read twice — so they report only what the extractor's own output
  evidences.
- **Nothing here measures caller attribution**, because attaching callers to these groups is the
  thing M0b just said not to do yet.
