# apg-pilot-09 — task answer (arm sealed until scoring is done)

**Prompt, verbatim:** Is it safe to delete computeWeight from src/weights.cpp? Give me a yes or no and say what you checked.

**Answer:** No. Do not delete it. Cited `src/pipeline.cpp:1` (extern decl) and `:3`
(the call), and named the failure as a LINK-time break of `runWeighting`.

## Route

1. whole-repo text search for `computeWeight` — 3 hits
2. read every file in `src/` (8 files) and confirmed the call site by eye, "not just by grep line"
3. instrument controls in the same run: negative `computeWeightZZZ` (exit 1 — can say ABSENT),
   positive `deriveScale` (found — can say PRESENT)

## ⭐ It named BOTH defeats, including one cell 01 did not

> "The declaration is a bare `extern` inside pipeline.cpp, not a header. There is no
> weights.h. Any include-graph, header-based, or 'who includes this file' query returns
> nothing for computeWeight and **looks like a clean zero**."

> "src/bundle.cpp does `#include "weights.cpp"` and `#include "pipeline.cpp"`, so definition
> and caller also land in one translation unit there. A per-file compile-and-see check on
> weights.cpp alone would not surface the break."

Those are exactly the two counterexamples our falsification fixtures were built around —
found independently, from source, with no graph.

## Caveat it volunteered

No build files of any kind in the corpus (checked CMakeLists, Makefile, bazel, gn, package
JSON), so it cannot say which TUs actually compile, nor see consumers outside the checkout.
Its framing: *"That uncertainty only adds risk to deleting; it does not soften the answer."*

Closing line: **"Answer stands on a positive finding, not on an absence: I read the call."**
