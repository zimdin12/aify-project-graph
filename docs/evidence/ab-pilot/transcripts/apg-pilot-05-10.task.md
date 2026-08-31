# apg-pilot-05 (graph) and -10 (no graph) — C6 task answers (arms sealed)

Both answered **yes, two call sites — but `normalizeInput` is TWO unrelated symbols**, one
JS one C++, each with exactly one caller, and both callers themselves named `runNormalize`.
Both volunteered the same unasked fact: **nothing calls either `runNormalize`** — the chain
dead-ends one level up.

## apg-pilot-05 — WITH graph
- `graph_callers` **refused the bare name as AMBIGUOUS and forced qualification** —
  `src::entry::normalizeInput` (conf 0.90), `src::normalize::normalizeInput` (conf 0.60)
- `code_intel_references` on each definition → 1 ref each, clangd@live, exact columns
- ran controls **on the graph tool itself**: positive `graph_callers computeWeight` returned
  the known edge; negative `graph_callers zzNoSuchSymbolQqq` returned NO MATCH
- read `absenceAuthority:false`, `codeIntel.available:false` and said *"I did not lean on it
  for the absence claim"*
- noticed the repo's own indirect-dispatch shape: `gain.cpp:8` puts `applyGain` in a
  `kHandlers[]` table, and the manifest lists that edge unresolved as
  `fragment-shape-not-minted` — then checked neither `normalizeInput` has its address taken
- offered to stand up a `compile_commands.json` and re-run to get compiler-exhaustive

## apg-pilot-10 — NO graph
- read all 8 files exhaustively; positive and negative controls; case-insensitive sweep
  including hidden and untracked files
- checked indirect reach specifically, and named the same `kHandlers[]` table as the only
  indirection in the repo
- ⭐ **declined to build a graph, with a stated justification rather than silently**:
  > "for an 8-file repo I read end to end, exhaustive reading strictly dominates a resolver,
  > and building an index would have added ceremony, not confidence. Flagging that I
  > substituted the method rather than implying I ran the sanctioned tool."

That refusal is exactly what review defined as a SUCCESS: an agent correctly choosing
grep/Read over a floor-valued graph is not an adoption failure.

## Where they diverge, and it is the one place the graph earned its place
The graph arm was *told* about the name collision by the tool, which refused to answer a
bare name it could not disambiguate. The no-graph arm found the same collision by reading
every file. Both got there — but only one of those methods survives a repo too large to read.
