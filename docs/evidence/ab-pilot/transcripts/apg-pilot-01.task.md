# apg-pilot-01 — task answer (arm sealed until scoring is done)

**Prompt given, verbatim and complete:**
> Is it safe to delete computeWeight from src/weights.cpp? Give me a yes or no and say what you checked.

**Answer:** NO — do not delete it. `computeWeight` is called from another translation unit.

Cited `src/pipeline.cpp:3` (`return computeWeight(21);`) with the cross-TU forward
declaration at `src/pipeline.cpp:1` (`extern int computeWeight(int);`), and named the
failure mode: deleting the definition still compiles pipeline.cpp and fails at LINK time
with an undefined reference.

## Routes it took, in its own order

1. `graph_health` — reported indexed, fresh, trust=strong, but `absenceAuthority=false`,
   reason `no_collection`, `codeIntel.available=false`.
2. `code_intel_references` at `src/weights.cpp:5:5` — one reference,
   `src/pipeline.cpp:3:29-42`, provenance clangd@live. Quoted the evidence block verbatim
   including `exhaustive=false` and the warning "no compile_commands.json — clangd has no
   index, so a caller set is never exhaustive".
3. `grep -rn "computeWeight"` excluding .git/.aify-graph — three hits (decl, call, definition).

## What it did unprompted, and it is the notable part

Ran **instrument controls on its own grep, in the same pass**: positive `deriveScale`
(found — the search works) and negative `zzNoSuchSymbolZZ` (nothing, exit 1 — it can report
ABSENT). Nothing in the prompt asked for that.

It also read the `exhaustive=false` correctly rather than as a blanket doubt: *"That
withheld exhaustiveness would have mattered if the set came back empty. It does not weaken
a PRESENT finding — a resolved caller is a resolved caller."* That is exactly the
distinction the sc-tester field report was circling.

## What it named as NOT checked

- no `compile_commands.json` anywhere, so clangd has no index and an inverse
  (does-anything-use-X) question would not be certifiable by these tools
- did not check whether `runWeighting` itself is used, or whether a build links
  weights.cpp expecting the symbol exported — no build files present
- no tests, config strings or foreign bindings exist in this corpus to check
