# F12 — the deletion-safety verb showed test callers while 124 compiler-verified ones sat unread

## What an agent actually got

`graph_preflight("Context")` on the pinned click arm, before:

    CALLERS 164 total (top 5):
      test_required_argument CALLS tests/test_arguments.py:271 conf=0.95
      test_deprecated_empty_help_no_leading_space CALLS tests/test_arguments.py:416 conf=0.95
      test_param_named_help CALLS tests/test_basic.py:59 conf=0.95
      test_option_reusing_help_flag CALLS tests/test_basic.py:63 conf=0.95
      test_get_help_option_names CALLS tests/test_commands.py:71 conf=0.95

All five are `EXTRACTED`. All five are test files. Meanwhile that same symbol, in that same graph,
carries **124 `LSP_VERIFIED` callers** — pyright ground truth, none of them shown.

After:

    _complete_visible_commands CALLS src/click/core.py:64  conf=0.95 [lsp✓]
    augment_usage_errors       CALLS src/click/core.py:125 conf=0.95 [lsp✓]
    Command                    CALLS src/click/core.py:1010 conf=0.95 [lsp✓]
    ...

## Two independent causes

### 1. Confidence is not an evidence tier

Measured on click:

| provenance | n | confidence range | avg |
|---|---|---|---|
| EXTRACTED | 10,976 | 0.75 … 1.00 | 0.933 |
| LSP_VERIFIED | 1,460 | 0.95 … 0.95 | 0.950 |
| AMBIGUOUS | 1,145 | 0.75 … 0.95 | 0.930 |
| INFERRED | 76 | 0.75 … 0.95 | 0.866 |

The ranges **overlap** and the averages are indistinguishable. `confidence` measures how sure the
extractor was about *that* edge; it says nothing about which instrument produced it. So
`ORDER BY confidence DESC LIMIT n` ranks a heuristic guess exactly as highly as compiler ground
truth — every candidate ties at 0.95 and SQLite breaks the tie arbitrarily.

Across the corpus, counting only files where truncation actually fires:

| arm | truncating files | tier-inverted | lower-tier kept | higher-tier discarded |
|---|---|---|---|---|
| click | 18 | **8 (44%)** | 91 | **325** |
| fmt | 8 | 0 | 0 | 0 |
| fast-route | 3 | 0 | 0 | 0 |
| p-queue | 0 | — | — | — |

⭐ The three zeros are the control, not an absence of measurement: those arms have **no
`LSP_VERIFIED` tier at all**, so there is nothing to invert against. The defect appears exactly
where a trust spine exists — which is also the only place it can matter.

⚠ **And that bounds the fix.** On a repo with no collection, tier-first ordering changes nothing,
because every edge is already the same tier.

### 2. The tier was invisible even when it was right

Eight verbs — `callers`, `callees`, `impact`, `neighbors`, `module_tree`, `path`, `search`,
`whereis` — route through the shared renderer, which prints `[lsp✓]` for verified edges and
`prov=AMBIGUOUS` / `prov=INFERRED` for heuristic ones, and stays silent on the `EXTRACTED` default.

`preflight` and `graph_file` build their line by hand and printed `conf=` and nothing else.
`graph_file("src/click/core.py")` rendered **40 edge lines, 0 carrying any provenance tag**, drawn
from a candidate set of 979 edges spanning three tiers.

⛔ `preflight`'s query **selected `e.provenance`** on line 46 and the render dropped it on line 130.
The data was fetched, carried, and thrown away one line before a reader could see it.

⛔⛔ This is the original F6 finding — "EXTRACTED and AMBIGUOUS are identical in every rendered
field" — which I **withdrew twice** after checking the shared renderer, the one place where it was
already false. Both withdrawals were correct about the renderer and wrong about the product,
because I never asked which verbs bypass it.

## The fix

- `provenanceRank` / `provenanceRankSql` in `lsp-evidence.js`, the module that already owns "is this
  evidence verified". One map; the SQL `CASE` is **generated** from it rather than restated in a
  second language where it would drift.
- Unknown provenance ranks **0 — last, not first**. A tag this build has never heard of must not be
  promoted above evidence we can vouch for.
- `provenanceRankSql` refuses any argument that is not a plain column name, since the expression is
  interpolated into SQL. Verified in both directions: accepts `provenance` and `e.provenance`,
  rejects `e.provenance; DROP TABLE nodes`, `(SELECT 1)`, `e..p`, and `''`.
- Both verbs order by tier first, confidence second, and both render the shared provenance tag.

## Evidence

**Consumer side, on the pinned corpus, after the fix** — the tag is neither always-on nor
always-off, which one arm alone could not show:

    click       src/click/core.py              27 [lsp✓]   0 prov=AMBIGUOUS   13 EXTRACTED
    fmt         test/gtest/gmock-gtest-all.cc   0           11 prov=AMBIGUOUS   8 EXTRACTED
    fast-route  src/FastRoute.php               0            0                 40 EXTRACTED
    p-queue     source/index.ts                 0           14 prov=AMBIGUOUS   6 EXTRACTED

**Inversion, same script and same corpus, differing only in the `ORDER BY`:** click 8 of 18
truncating files inverted (325 higher-tier edges discarded) → **0**. The other three arms read 0
under both orderings.

**7 mutants, 7 killed** — each verified to have applied before running, each restored green after:
preflight orders by confidence again · preflight drops the tag · `graph_file` orders by confidence
again · `graph_file` drops the tag · unknown provenance promoted to the top · verified no longer
outranks the AST · the injection guard removed.

The unit fixture inverts on purpose: six heuristic callers at `conf=1.00` against two verified ones
at `0.95`. A verb that still sorts by confidence returns the heuristic set and fails deterministically,
where a real graph would only fail on a coin toss.

**Suite: 368 files, 2,979 passed, 4 skipped, 0 failed.** The `live-verbs-real` clangd test that
flaked under load during the previous change passed here.

## ⛔ Two self-inflicted errors

1. **A backtick inside a SQL comment** terminated the JS template literal holding the query. The
   explanation now sits above the call as a JS comment, where it belongs — prose was being shipped
   to SQLite either way.
2. **The preregistered claim was not the one that survived.** I preregistered "an AMBIGUOUS edge
   displaces an EXTRACTED or LSP_VERIFIED one" with an abandon rule. On the first file I measured
   there were no AMBIGUOUS incoming edges at all, so that exact claim failed — and the measurement
   surfaced something worse instead: 185 compiler-verified edges discarded to keep 13 AST-derived
   ones. The preregistration did its job by refusing to let me report the claim I set out to prove.
