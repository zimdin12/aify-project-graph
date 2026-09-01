# M1 — SYMBOL IDENTITY NOT NAME: stop condition MET (JS/TS), NOT met (C++)

M1 stops when *"a same-name-different-symbol fixture proves the sets do not merge"*.

## The result, through the shipped verb

Fixture: two classes both named `Widget`, each with a `render` method, each called from a
different function. `grep -n render` returns both call sites with nothing to say which belongs to
which class. That is the case this milestone exists for.

```
alpha.Widget.render     CALLERS_LISTED     ["alphaCaller"]
alpha::Widget::render   CALLERS_LISTED     ["alphaCaller"]
beta.Widget.render      CALLERS_LISTED     ["betaCaller"]
beta::Widget::render    CALLERS_LISTED     ["betaCaller"]
render / Widget.render  REFUSED_AMBIGUOUS  — lists the qualified candidates to retry with
```

Disjoint, both non-empty, byte-identical across three consecutive runs (`edgesCreated: 10` each).
The bare-name refusal is retained deliberately: those names ARE ambiguous. What changed is that the
refusal is no longer a dead end — it names the qualified forms.

Test: `tests/integration/m1-caller-sets-do-not-merge.test.js` (5 tests).

## Mutants — the test can fail, for the right reasons

| mutant | verdict |
|---|---|
| M-A — the fixture loses its project manifest (edges -> 0) | KILLED (4 failed) |
| M-B — symbol identity becomes NAME-keyed instead of site-keyed | KILLED (3 failed) |

M-B is the load-bearing one: if two same-named methods share a `symbolId`, their reference sets
collapse and the caller sets merge. Killing it shows the test measures identity, not shape.

⚠ M-B first reported `NOT APPLIED 0 matches` — a multi-line anchor using `\n` against a CRLF file.
A 0-match mutant is an INSTRUMENT failure and says nothing about the product; it was re-anchored on
a single line and then killed. It was never read as SURVIVED.

## What made this look impossible for two cycles

`tests/fixtures/identity-callers-js` shipped with no `package.json` and no `tsconfig.json`, so
tsserver treated each file as an isolated script and resolved nothing across files. Same bytes
otherwise:

| | bare | with manifest |
|---|---|---|
| reference records `found` / `not_found_after_retry` | 2 / 8 | 14 / 2 |
| CALLS edges created by the LSP import | **0** | **10** |
| `alphaCaller -> render` | `External` | `Method`, `src/alpha.js` |
| `betaCaller -> render` | `External` | `Method`, `src/beta.js` |

The step-B write-up recorded attribution as *"structurally unavailable — the edge attaches to
neither definition"*, and an independent re-measurement reproduced it. Both ran the manifest-less
fixture. The system was not broken; the fixture could not exercise the feature, and an
unexercisable feature is indistinguishable from an absent one.

The two references that DO resolve without a manifest are for `w`, a local variable whose only
references sit inside its own definition range and are correctly skipped as declarations. So the
manifest-less state produces exactly zero attribution while still looking like a working pipeline.

## A hypothesis of mine, refuted in the same pass

I proposed the single 30ms retry at `lsp-collect.js:427` as the cause of the 80%
`not_found_after_retry` rate, labelled ASSUMED. The discriminator ran both arms together: with a
manifest the not-found count falls to 2, and those two are `alphaCaller`/`betaCaller`, which
genuinely have no callers. The 80% was measuring an unconfigured project. **Withdrawn** as evidence
for the retry hypothesis. The retry may still matter for the separate reproducibility finding; it
is not supported by this measurement.

## NOT claimed

- **C++ is NOT done.** The qualified query there still returns `REFUSED_AMBIGUOUS` because the
  decl/def pair cannot share a canonical key — see `FINDING-decl-def-qname-divergence.md`. The C++
  fixture also has no compile database, so its LSP arm was never exercised.
- **No prevalence claim.** One fixture. This shows the mechanism works, not how often it helps a
  real agent on a real repository. That is M5's job.
- **`graphIndex` alone does NOT suffice.** Without `graph_collect_code_intel` the caller sets are
  heuristic-only; the tree-sitter resolver emits the bare target `render` with no receiver, so a
  method call cannot be attributed by name and lands on an External stub.
- **Not determinism.** Three runs without variation is absence of observed variation at n=3.
