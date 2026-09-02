# FINDING — M2's list, checked construct by construct. Two of its items do not hold.

M2 asks results to state what was NOT modelled, and lists: *indirection, macros, conditional
compilation, extern-without-header, included .cpp, cross-language*. I shipped a caveat naming
several of those. **The list was treated as evidence, and it is not.** Each construct is now
measured on a purpose-built fixture with a plain call as positive control.

## The table — every cell observed

| construct | heuristic (tree-sitter) | clangd |
|---|---|---|
| plain call **[CONTROL]** | edge conf=0.60 | edge conf=0.95 `[lsp✓]` |
| **extern, no header** **[CONTROL]** | edge conf=0.60 | edge conf=0.95 `[lsp✓]` |
| macro-generated call | **NO EDGE** | **NO EDGE** |
| function-pointer call | **NO EDGE** | edge conf=0.95 `[lsp✓]` |
| inactive `#ifdef` branch | edge conf=0.60 (**overcount**) | **NO EDGE** |
| `#include`d .cpp (not a TU) | edge conf=0.60 | **NO EDGE** |

⇒ **Only the MACRO case is blind in both tiers.** Everything else is tier-dependent, and the
direction is the actionable part: tree-sitter parses TEXT, so it counts calls that never compile and
cannot follow a pointer; clangd only ever sees what the compile database actually compiles.

## ⛔ Two of the milestone's own list items are WRONG for this tool

- **`extern`-without-header is fully modelled.** Both tiers resolve it. Shipping it as a caveat
  would be a FALSE caveat — telling an agent we cannot see something we demonstrably can. That
  corrodes trust in correct results exactly as badly as the reverse, and it is now asserted
  ABSENT from the clause by test.
- **"indirection" is only half true.** The heuristic tier misses a function-pointer call; clangd
  resolves it (`caller→demo::ptrTarget conf=0.95 [lsp✓]`). An earlier version of my caveat asserted
  it was unmodelled outright.

## The sequence of wrong claims, because the pattern is the point

Three versions of this one sentence shipped or nearly shipped with unobserved content:

1. *"an inactive branch is invisible to BOTH tiers"* — wrong about tree-sitter, which reports it.
2. *"calls through function pointers or std::function… NOT MODELLED"* — wrong about clangd.
3. `extern`-without-header — would have been wrong about both, and was only ever in the caveat's
   candidate list because the milestone named it.

Every one came from the same move: reasoning correctly from how a compile database works, then
writing the conclusion into product text as though it had been watched. **The reasoning was never
the problem. Publishing it as an observation was.** Each check cost about four minutes.

## What is locked, and what is not

- **Tested, no clangd required** (`m2-heuristic-misses-indirection-and-macros.test.js`,
  `m2-heuristic-counts-uncompiled-calls.test.js`): the heuristic tier misses function-pointer and
  macro calls, and reports inactive-`#ifdef` calls. These are OUR behaviour and are the negative
  claims — the dangerous kind, because an agent that believes "we cannot see X" acts on it.
- **Reproducible script, not a test** (`scripts/m2-conditional-compilation-probe.mjs`): the clangd
  column. Third-party behaviour needing an LLVM install.
- **NOT established:** prevalence. One fixture per construct, one compiler, one platform. Nothing
  here says any of these constructs is common in real C++, or that a real absence has ever been
  wrong because of one. That remains M5's question.
- **NOT covered:** `std::function` specifically (only a raw function pointer was tested), virtual
  dispatch, templates, and cross-language — the last is handled elsewhere, in the ambiguity path.
