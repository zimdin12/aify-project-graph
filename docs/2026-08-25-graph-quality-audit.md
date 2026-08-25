# Graph quality audit — four third-party repositories, measured

**The prior question nobody had asked.** Every efficacy measurement this project has produced is
about how agents *behave*. None asked whether the artefact those agents read is any good. This does,
against repositories whose contents can be checked independently.

Corpus: `scripts/testbed.mjs` — shallow clones, disposable, 28 MB total.
Instrument: `scripts/audit-graph-quality.mjs`.

| repo | language | tier | nodes | edges | per-language file coverage |
|---|---|---|---|---|---|
| fmt | C++ | LSP | 6,735 | 14,855 | 73/73 = **100%** |
| click | Python | LSP | 2,393 | 12,465 | 79/79 = **100%** |
| FastRoute | PHP | heuristic only | 489 | 1,343 | 47/47 = **100%** |
| p-queue | TypeScript | LSP | 184 | 384 | 14/14 = **100%** |

## What is good, stated first because it is real

- **File coverage is 100% in every language.** Nothing was skipped. Extraction reaches what is there.
- **Zero dangling edges** in all four graphs. No edge points at a node that does not exist.
- **The C++ failure mode is honest.** When collection cannot run it returns a typed error in 74 ms
  with the exact remedy, rather than an empty result that reads like "no callers".

## ⛔ F1 — a freshly installed project has NO trust spine at all

    lspVerifiedShare    fmt 0%    click 0%    FastRoute 0%    p-queue 0%

`graph_index` produces tree-sitter extraction only. Compiler-verified edges require a **second,
separately-invoked** command, `graph_collect_code_intel`. Until it runs, every edge is heuristic —
and this project's own skill text says heuristic extraction *"UNDERCOUNTS C++ virtual and cross-TU
dispatch — on one measured project it found half the calling files."*

⇒ **The default state of every new installation cannot support the tool's headline claim.** Every
project installed today is in exactly this state, including `aify-comms`.

## ⛔ F2 — collection is budget-exhausted long before it finishes

`click`, 79 Python files, one `scope:"all"` collection:

    status               partial
    reason               budget_exhausted_25_of_79_files
    collectMs            60,113
    provenance after     LSP_VERIFIED 1,410 (10.4%) · EXTRACTED 10,987 · AMBIGUOUS 1,145 · INFERRED 76

Before/after on the same graph: **0% → 10.4% verified**, for 60 seconds spent covering **32% of a
small repository**. A repository of any real size will never reach a complete spine in one call, and
nothing tells the caller how many further calls it would take.

⚠ `positionGuessSkipped: 25` on the same run — every processed file skipped a position guess. Not
yet understood; listed as an open question rather than a defect.

## ⛔ F3 — C++, the priority language, cannot be collected from a clean checkout

    status  error
    code    compile_db_missing
    ms      74

`fmt` has no `compile_commands.json`, as no freshly-cloned C++ repository does. The trust spine for
C++ therefore requires the user to **configure and build the project first**. That is inherent to
clangd rather than a defect in this tool — but it is currently discovered at *collect* time, deep in
a workflow, rather than at *install* time when the user is already configuring things.

## ⚠ F4 — PHP is permanently second-class

PHP has a tree-sitter extractor and no language server. It can never earn `[lsp✓]`, never return
`exhaustive: true`, and never license an absence claim. Named as a priority language; currently
cannot participate in the tool's central guarantee. Candidate: intelephense or phpactor.

## ⚠ F5 — orphan nodes, unexplained

    fmt 0.5%   click 2.0%   FastRoute 2.2%   p-queue 4.3%

Nodes participating in no edge at all. Small, consistent, and rising as repositories get smaller —
which suggests a fixed category rather than random loss. Not yet diagnosed.

## ⚠ F6 — `AMBIGUOUS` is 8.4% of edges after collection, and its meaning is undocumented here

1,145 of 13,618 edges in `click`. Whether a consumer should treat AMBIGUOUS as evidence, as a lead,
or as nothing is not stated anywhere a reader would meet it.

## ⛔ And a defect in the audit itself, found and fixed mid-run

The first version reported `click` as **170 indexed files against 166 tracked** — more files than
git knows about, which is impossible. The extras were `Directory` nodes carrying directory paths
(by design) and `External` nodes carrying `file_path = ''` for symbols outside the repo (`getcwd`,
`startswith`). Both correct product behaviour.

⇒ The defect was the audit's denominator: *"distinct file_path values"* is not *"source files
indexed"*. The same wrong-noun error this project keeps paying for — sound arithmetic, unchecked
noun. Fixed, with the exclusion now reported rather than silently applied.

## What this audit does NOT establish

- **Correctness of individual edges.** Coverage and integrity are measured; whether a given CALLS
  edge is *true* is not. That needs spot-checking against the source.
- **Anything about recall.** 100% file coverage says every file was visited, not that every symbol
  or call within it was found.
- **Whether any of this changes what an agent does.** Still unmeasured, still the open question.
