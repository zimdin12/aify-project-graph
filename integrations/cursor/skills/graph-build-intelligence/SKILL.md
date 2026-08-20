---
name: graph-build-intelligence
description: Opt-in intelligence layer for `.aify-graph/` — LLM-derived per-file semantic summaries + architectural layer assignment. Produces semantic.files.json + architecture.json that briefs and the visual dashboard consume. Use when the user wants richer-than-structural briefs or a layer-colored dashboard. Distinct from `/graph-build-all` (which only does structural extract) — this skill costs LLM credits and should be invoked deliberately.
---

# The graph knows the shape and not the meaning

You can already ask what calls what. You cannot ask "which parts of this repo are about rendering",
because nothing in the structure carries that. This adds enough meaning to answer it.

⛔ AND IT ADDS RICHNESS, NEVER AUTHORITY. Everything here is LLM-derived, which means it is a
plausible reading of the code rather than a fact about it. The structural graph, the briefs and the
hand-authored `functionality.json` win on ANY conflict — not as a courtesy, but because they are
the only ones with a human or a parser behind them.

⚠ Treat a confident-sounding summary of a file you have not opened as a hypothesis. It is the one
layer here whose errors read exactly like its successes.

It runs a two-phase LLM pipeline over the existing structural graph and produces two overlay files
that other systems read:

- `.aify-graph/semantic.files.json` — per-file plain-language summary, tags, complexity, nodeType, entryPoint
- `.aify-graph/architecture.json` — 3-10 logical layers + per-file assignment with confidence + reason

These overlays are **additive**. They do not replace the structural graph, the briefs, or the hand-authored `functionality.json` taxonomy — those still win on any conflict. The intelligence layer adds richness, not authority.

## When to run this

Run when:
- The user wants briefs that explain *what* files are for in plain language, not just *what symbols* they contain.
- The user is about to use the visual graph dashboard (`graph_dashboard`) and wants nodes color-grouped by architectural layer.
- A new dev is onboarding and wants an architectural overview without reading every file.

Do NOT run when:
- `.aify-graph/graph.sqlite` does not exist yet — run `/graph-build-all` first.
- The user is in a CI loop or budget-sensitive context — this skill makes ~5-15 LLM calls per repo (one per file batch + one for architecture).
- The user only needs the structural graph and briefs already work — this is an enrichment, not a fix.

## Pipeline (mandatory build order)

```
[ existing graph DB ]                 ← from /graph-build-all
        │
        ▼
[ Phase 0 — deterministic extract ]   ← mcp/stdio/intelligence/extract.js
   buildStructuralExtract({repoRoot, db, graphHead})
   batchFilesForLlm(files, {maxFiles:20, maxChars:50000})
        │
        ▼
[ Phase 1 — file-summarizer LLM ]     ← prompts/file-summarizer.md
   per-batch: structural extract in → {path,summary,tags,complexity,
   nodeType,entryPoint} array out
        │
        ▼  (assemble all batches)
[ Validator — semantic-files ]        ← validators/semantic-files.js
   schema + no-duplicate-paths + on-disk-existence + functionality.json
   conflict warnings. REFUSES TO PASS on any failure.
        │
        ▼  (pass → write .aify-graph/semantic.files.json)
        │
        ▼
[ Phase 2 — architecture-layer-assigner LLM ]  ← prompts/architecture-layer-assigner.md
   inputs: semantic.files.json + structural extract
   output: {layers[3-10], assignments{path→{layerId,confidence,reason}}}
        │
        ▼
[ Validator — architecture ]          ← validators/architecture.js
   schema + every assignment path ∈ semantic.files.json paths +
   every semantic.files.json path has an assignment (no orphans) +
   layer ids match. REFUSES TO PASS on any failure.
        │
        ▼  (pass → write .aify-graph/architecture.json)
```

**The validators are non-negotiable.** If either fails, do NOT write the file. Surface the error list to the user and stop. LLM hallucinations (invented paths, unknown layer ids, paths with backslashes, contradictions with `functionality.json`) are the failure modes the validators exist to catch — bypassing them defeats the entire intelligence layer.

## Phase 1 prompt — file-summarizer

See `prompts/file-summarizer.md` for the full prompt. Summary of the contract:

- Input per batch: an array of structural-extract objects (path, language, loc, sha, symbols[], exports[], importsTo[], importedBy[]).
- Output per batch: an array of file enrichment objects matching `docs/schemas/semantic-files.v0.1.schema.json` — one entry per input file, same order, same paths.
- `nodeType` is constrained to: utility, api-handler, data-model, test, config, build, doc, infra, script, ui-component, service, fixture. Do NOT invent new categories. If unclear, pick the most-fitting available category.
- `entryPoint:boolean` is orthogonal to nodeType. A file can be both an `api-handler` and an entry point (main bootstrap), or both a `script` and an entry point (CLI entrypoint). Set entryPoint:true only when this file is genuinely an executable starting point.
- Tags must be supplemental, not contradictory. If `functionality.json` exists and says a file belongs to feature `freshness-tracking`, don't tag it `something-else-major`. Mirror the feature id when natural.
- Summary: 1-2 sentences, plain language, focused on **purpose** not implementation detail.

## Phase 2 prompt — architecture-layer-assigner

See `prompts/architecture-layer-assigner.md` for the full prompt. Summary of the contract:

- Input: parsed semantic.files.json + the structural extract (same one phase 1 saw).
- Output: 3-10 layers + an assignment per file with confidence + reason.
- Layer names must be the **project's natural vocabulary**. A cpp engine might be "Sim / Fields / Engine / Tools / Build". A React app might be "API / Service / UI / State / Build". Don't force generic names if the project has clearer ones.
- Every file in semantic.files.json MUST have exactly one assignment.
- Confidence calibration: `high` = obvious from path + imports + exports. `medium` = inferable but with judgment. `low` = ambiguous; reason should explain why.

## Stale detection

Both outputs carry:
- `schema_version`, `generatorVersion`, `generatedAt`
- `graphHead` — the git rev the inputs were drawn from
- `inputSha` — sha256 of the canonical structural extract

Consumers (briefs, dashboard) should re-run the pipeline when:
- `graphHead` doesn't match current HEAD, OR
- `inputSha` doesn't match a fresh `buildStructuralExtract()` run.

If only `graphHead` changed but `inputSha` is identical (no source changes), the cached overlays are still valid — consumers should accept them.

## Output paths (locked)

- `.aify-graph/semantic.files.json`
- `.aify-graph/architecture.json`

Do not write to other paths. Briefs and the dashboard read from these exact locations.

## Cost & dispatch shape

A typical mid-size repo (200-500 files) costs:
- 10-25 file-summarizer dispatches (depending on file size distribution and the 20-file / 50KB cap)
- 1 architecture dispatch
- Total: ~10-25 LLM calls

Run as a dedicated subagent invocation if your runtime supports it. Each dispatch is a fresh prompt — do NOT keep one giant context; each file batch is independent.

## What stays UNCHANGED by this skill

- `functionality.json` — hand-authored taxonomy, the highest-signal layer. Wins all conflicts.
- The structural graph database (`.aify-graph/graph.sqlite`).
- `brief.*.md` outputs from `/graph-build-all` (those gain supplemental sections from semantic.files.json + architecture.json, but the core briefs still work without the intelligence layer).
- All `code_intel_*` MCP verbs and the Plan #14 evidence contract.

## What the visual dashboard gets (Plan #16, follow-up)

- Color-grouping nodes by `architecture.json` layer.
- Click-detail panel shows the semantic summary + tags + complexity.
- Search box queries summaries and tags as well as node names.

Plan #16 is a separate slice — it depends on this skill producing valid overlays.
