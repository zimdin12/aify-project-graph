# Two populations, deliberately not pooled

| population | value | bound to |
|---|---|---|
| `INCOHERENT_TEST_FIXTURES_DETECTED` | **3** | the fixtures as they stood BEFORE correction, with their original invalid source/range pairs |
| `CORRECTED_ADMITTED_LOCATIONS_CHECKED` | **2001** | the CORRECTED fixture commit/tree, with the exact admitted membership from that run |

⚠ **2001/2001 does not mean provider output is coherent.** It means: on that corrected run, on
that tree, every admitted location covered its claimed token. It is not a statement about any other
run, any other provider, or anything the field produces.

# `INCOHERENT_TEST_FIXTURES_DETECTED = 3`

A population distinct from every other in this arc. Recorded separately so it cannot be pooled
into a denominator it does not belong to.

## What this population is — and the three it is NOT

**Is:** integration qualification for the **cpp-clangd** guard. Real provider call paths consumed
incoherent Locations, the document-bound validator rejected them, and correcting the source/range
coherence restored the intended tests **without weakening a threshold or an assertion**. That
proves the guard is not a replay-only helper.

**Is not:**
- **natural field prevalence** — these payloads are test fixtures, not a producer in the field;
- **evidence that cpp-clangd records occur in this repository's live graph** — that count is still
  **zero**;
- **qualification of the shared `lsp-collect` slice** — which still owes its own hostile replay
  through its production call site, per-provider bypass mutants, and valid in-repo ts-langserver
  and pyright controls.

## Exact membership, with corrected source/range pairs

| # | fixture | claimed | actual bytes at that range | corrected to |
|---|---|---|---|---|
| 1 | `fake-lsp-server.mjs` `documentSymbol` + `definition` | symbol `foo`, identifier at line 0 chars **5–8** of `namespace ns { void foo(int x) {} }` | `pac` — inside the word *namespace* | line 0 chars **20–23** (`foo`) |
| 2 | `fake-lsp-server.mjs` `references` (`FAKE_LSP_MANY_REFS`) | 2050 refs at lines **0–2049** of `bar.cpp` | `bar.cpp` has **2 lines**; all but two were out of bounds | line 1 chars **23–26** — the genuine call site `ns::foo(7)` |
| 3 | `real-producer-emits-skip-counters.test.js` | collects `src/main.cpp` | **file does not exist** in the fixture repo, and is absent from its compile DB | `src/foo.cpp` |

Fixture 2's ordinary (non-many) reference payload had the same defect at line 4 of the same
two-line file, corrected with it.

## Why all three survived

The same reason the clangd defect did: **nothing read the document, so nothing could object.** The
fake LSP answers any URI, and no code compared a claimed range against the bytes it named. A
fixture could name one symbol and point at another indefinitely.

The guard was built for an external producer. Its first catch was our own test corpus.

# `CORRECTED_ADMITTED_LOCATIONS_CHECKED = 2001`

## Acceptance: token membership at EVERY range, not merely in-bounds lines

An in-bounds correction would not be enough — v2 could then pass because the token check was
weakened or sampled rather than because the fixture is coherent. Verified on the corrected
fixture:

```
admitted location records : 2001
ranges covering token     : 2001
violations                : 0
positive control          : range shifted +2 columns -> "o(i" -> covers token = false
```

The control is load-bearing: without it, `2001/2001` would only prove the checker always says yes.

## ⚠ The verification probe produced a confident wrong zero first

Its first run reported **0 of 2001 covering**. Stored ranges are **1-based** for line and column
(`rangeFromLsp` adds one) and the probe read them as 0-based, so every slice came back empty. Had
that been trusted, the report would have been *"the guard admits 2001 incoherent locations"* — **a
fabricated defect in the code I had just written**, carrying a precise and entirely wrong number.

Third instrument-produced wrong zero in this session. The fix was the same each time: read the
artifact's actual shape rather than the shape assumed. A wrong zero that agrees with a story you
are already telling produces no collision, so nothing prompts the check.

★ **THE CONVENTION, RECORDED WHERE THE NEXT READER WILL HIT IT.** Stored record ranges are
**1-BASED for both line and column** — `rangeFromLsp` adds one to the 0-based LSP values. LSP wire
positions are 0-based; stored `range.start.line` / `range.start.col` are not. Any probe indexing a
document by a stored range must subtract one from each. This sentence exists so the confident wrong
zero above cannot recur through a future reader, and it is repeated in the probe's own header.

## What was NOT done

No assertion weakened, no threshold moved, no guard behaviour relaxed. Before editing fixture 3 the
real producer was verified independently — **2000 reference records, `refsTruncatedSymbols = 1`,
zero refusals** — so the per-symbol cap is still earned by the producer rather than granted by the
fixture.

## Claim ceiling

Three fixtures in this repository's C++ code-intel test corpus, corrected on one commit. Says
nothing about how often real producers emit incoherent locations, and nothing about the shared
provider path.
