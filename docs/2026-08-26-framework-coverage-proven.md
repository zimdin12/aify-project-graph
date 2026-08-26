# Converting asserted framework coverage to proven

The resolver fix (`f6a9566`) was proven end-to-end for **one** framework — Express — and asserted for
the rest through a shared derivation. This closes that gap, and the closing found more defects than
the fixtures did.

## Real fixtures, indexed by the real pipeline

Each is a minimal repository built in scratch and run through `scripts/reindex.mjs`:

| framework | routed edges | bound to real nodes |
|---|---|---|
| Express (node-web) | 12 | 10 (+2 correctly `External:cors`) |
| FastAPI (python-web) | 2 | **2 / 2** |
| Django | 2 | **2 / 2** |
| Laravel | 2 | **2 / 2** |
| NestJS | 4 | **4 / 4** (including the guard chain) |

⭐ **The before-state, measured in the same pass** by reverting only the resolver line and
reindexing: Flask and Django produced **0 routed edges** — not even an `External` stub, because
`shouldMaterializeExternal` omits `INVOKES`, so the route node sat in isolation with no edge at all.
That is a worse symptom than Express's stubs, and the fixtures can demonstrably return it.

## ⛔ Qt is NOT fixed, and the reason is a second gate

The `qt` plugin emits its refs correctly and they now carry `language: 'cpp'` — confirmed by reading
`dirty-edges.full.json`, where they sit **unresolved**:

    {"from_target":"runTask","relation":"CALLS","target":"progressChanged",
     "extractor":"qt","language":"cpp"}

The block is elsewhere:

    const SYMBOLIC_CHAIN_RELATIONS = new Set(['PASSES_THROUGH', 'INVOKES']);

`CALLS` is not in it, so a ref with a **symbolic source** (`from_target` rather than `from_id`) is
pushed to `unresolved` before any language logic runs. My fix is necessary but not sufficient here.

⚠ **Not fixed, deliberately.** Adding `CALLS` to that set changes resolution for every extractor
that emits a symbolic-source CALLS ref, not just qt — a broad behaviour change I cannot verify in
this slice. Reported rather than forced.

## The enumeration guard — and why its first two versions were wrong

`tests/unit/ingest/every-framework-ref-carries-a-language.test.js` enumerates the plugin
**directory**, builds a minimal repo per plugin, and runs `detect()` + `enrich()` for real, asserting
every hard-gated ref carries a language. A plugin with no fixture fails the enumeration, so a new
plugin cannot arrive uncovered.

**Version 1 scanned source text.** The repo's own `suite-composition` guard rejected it, correctly: a
test that regexes implementation text cannot fail when the behaviour breaks, and *can* fail when a
line is reflowed. It was rewritten to drive the plugins.

**Version 2's positive control summed across plugins** and required the total to exceed a threshold.
`python_web` emitted **zero** — its fixture omitted the `fastapi` token the plugin greps for — and
the control passed anyway on other plugins' refs, so two mutants deleting a language survived against
a green suite.

⇒ **AN AGGREGATE CONTROL HIDES PER-ITEM FAILURE.** It now asserts *per plugin*, which immediately
exposed `rails` as silent too (its fixture needed `resources :articles`; the bare `get ... to:` line
produced nothing).

## What the guard found that the fixtures did not

Switching it on listed **five ref sites with no language** that all five end-to-end fixtures had
missed:

    python_web.js:119  PASSES_THROUGH   <- a priority language, missed because the Flask
                                           fixture only exercised the INVOKES path
    laravel.js  x4     INVOKES + PASSES_THROUGH

Laravel worked in practice only through the legacy `['laravel','php']` map entry. Carrying the
language explicitly makes it independent of that entry.

⇒ **Fixtures prove the paths they happen to walk. Enumeration finds the paths nobody walked.** They
are not substitutes for each other.

## ⚠ A declared gap

Laravel's middleware-chain `PASSES_THROUGH` refs are the one language-carrying site no fixture
reaches. `Route::middleware([...])` was tried grouped, grouped with `::class` tokens, and inline —
all three emit only the `INVOKES` ref; the chain appears to need conventional groups from a Kernel
file. **A mutant deleting that site's language survives this guard.** The other four sites' mutants
are killed.

Recorded here rather than left to be rediscovered, because an unstated gap in a green guard reads as
coverage.

## Status

| framework | binding proven | guard covers its language |
|---|---|---|
| node-web | ✅ real app | ✅ |
| python-web | ✅ real app | ✅ |
| django | ✅ real app | ✅ |
| laravel | ✅ real app | ⚠ INVOKES yes, middleware chain no |
| nestjs | ✅ real app | ✅ |
| rails | — no fixture indexed | ✅ |
| spring | — no fixture indexed | ✅ |
| qt | ❌ blocked by SYMBOLIC_CHAIN_RELATIONS | ✅ |

Suite: 372 files, 3,003 passed, 4 skipped, 0 failed.
