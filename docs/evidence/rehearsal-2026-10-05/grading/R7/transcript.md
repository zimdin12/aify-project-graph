# R7 — runtime: hermes, task: T1

### tool call: terminal
```
{
 "command": "git status --short && git branch --show-current",
 "workdir": "<ARMS>/<ARM>/aify-project-graph"
}
```

### tool call: search_files
```
{
 "pattern": "graph_callers",
 "path": "<ARMS>/<ARM>/aify-project-graph",
 "limit": 80
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/package.json"
}
```

### tool result: terminal
```
{"output": "main", "exit_code": 0, "error": null}
```

### tool result: search_files
```
{"total_count": 80, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "<ARMS>/<ARM>/aify-project-graph\\AGENTS.md\n  7: A local MCP server that indexes the user's current repo into a SQLite-backed code graph and exposes high-intent query verbs (`graph_report`, `graph_whereis`, `graph_callers`, `graph_impact`, etc.). Compact NODE/EDGE output with `file:line` citations. No server, no container, client-side only.\n  103: - **Claude Code / full toolset**: `graph_search(query=\"dispatch\")`, `graph_whereis(symbol=\"get_db\", expand=true)`, `graph_callers(symbol=\"get_db\")`\n<ARMS>/<ARM>/aify-project-graph\\CHANGELOG.md\n  64:   report a remainder — `graph_callers`, `graph_impact`, `graph_callees`, `graph_neighbors` and\n  65:   `graph_search` — and the other two never do. `graph_callees` — the direct mirror of `graph_callers` — capped three queries with\n  76: - ⛔ **The overcount guard could not fire on the case it was written for.** `graph_callers(\"has\")`\n  122: - **A cap is not a count.** `graph_callers` reported `CONFIDENCE: 100 callers` for a symbol with ten\n  532: - **`graph_callers` says what its locations ARE** — caller *declarations*, not\n  605: - **Windows backslash paths work everywhere now.** `normalizePathArg` existed and was wired into `graph_callers`/`graph_file`/`graph_find`, but `graph_callees`, `graph_search`, and `graph_modul
…[18991 more chars cut]
```

### tool result: read_file
```
{"content": "1|{\n2|  \"name\": \"aify-project-graph\",\n3|  \"version\": \"0.9.0\",\n4|  \"description\": \"On-demand codebase graph map for coding agents (Claude Code, Codex). Tree-sitter extraction → SQLite graph → compact MCP query verbs.\",\n5|  \"type\": \"module\",\n6|  \"license\": \"MIT\",\n7|  \"scripts\": {\n8|    \"test\": \"node ./scripts/run-vitest.mjs\",\n9|    \"test:watch\": \"node ./scripts/run-vitest.mjs --watch\",\n10|    \"validate:marketplace\": \"node ./scripts/validate-marketplace-package.mjs\",\n11|    \"smoke\": \"node scripts/smoke.mjs\"\n12|  },\n13|  \"bin\": {\n14|    \"apg\": \"./bin/apg.js\",\n15|    \"aify-code-intel\": \"./bin/aify-code-intel.js\"\n16|  },\n17|  \"dependencies\": {\n18|    \"3d-force-graph\": \"^1.80.0\",\n19|    \"ajv\": \"^8.20.0\",\n20|    \"ajv-formats\": \"^3.0.1\",\n21|    \"better-sqlite3\": \"^11.0.0\",\n22|    \"cytoscape\": \"^3.30.4\",\n23|    \"cytoscape-dagre\": \"^3.0.0\",\n24|    \"cytoscape-expand-collapse\": \"^4.1.1\",\n25|    \"cytoscape-fcose\": \"^2.2.0\",\n26|    \"ngraph.graph\": \"^20.1.2\",\n27|    \"ngraph.leiden\": \"^0.2.0\",\n28|    \"proper-lockfile\": \"^4.1.2\",\n29|    \"pyright\": \"^1.1.410\",\n30|    \"tree-sitter\": \"^0.22.0\",\n31|    \"tree-sitter-c\": \"^0.23.0\",\n32|    \"tree-sitter-cpp\": \"^0.23.0\",\n33|    \"tree-sitter-css\": \"^0.23.2\",\n34|    \"tree-sitter-glsl\": \"^0.2.0\",\n35|    \"tree-sitter-go\": \"^0.23.0\",\n36|    \"tree-sitter-java\": \"^0.23.0\",\n37|    \"tree-
…[552 more chars cut]
```

### tool call: search_files
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph",
 "pattern": "NO CALLERS|function graph_callers|function graphCallers",
 "file_glob": "*.js",
 "limit": 50
}
```

### tool result: search_files
```
{"total_count": 44, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "<ARMS>/<ARM>/aify-project-graph\\mcp\\stdio\\server.js\n  313:   ['code_intel_references', 'Compiler-backed \"who references this symbol\", asked of the LIVE language server — the only verb whose answer can support a delete or rename decision. ★ READ evidence BEFORE CONCLUDING: exhaustive is WITHHELD (cause index_population_unattested) — the compile DB says which TUs clangd MAY index, never which it DID, so ZERO REFERENCES IS NOT EVIDENCE OF NO CALLERS. Locations are compiler-resolved and precise; the SET is a floor. Verify with rg before any delete/rename. O\n<ARMS>/<ARM>/aify-project-graph\\mcp\\stdio\\tools\\schema.js\n  155:     description: 'Compiler-backed \"who references this symbol\", asked of the LIVE language server — the only verb whose answer can support a delete or rename decision. Bounded and budgeted. ★ READ evidence BEFORE CONCLUDING: exhaustive is WITHHELD (cause index_population_unattested) — the compile DB says which TUs clangd MAY index, never which it DID, and a TU in it can still fail to compile while indexing reports idle, so ZERO REFERENCES IS NOT EVIDENCE OF NO CALLERS. Locations are compiler-res\n<ARMS>/<ARM>/aify-project-graph\\mcp\\stdio\\query\\lsp-evidence.js\n  194: // MOST dangerous output a graph verb can emit is an absence cl
…[5684 more chars cut]
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callers.js"
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query/lsp-verified-surface.test.js"
}
```

### tool call: search_files
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp",
 "pattern": "getIncomingEdges|incomingEdges",
 "limit": 50
}
```

### tool result: read_file
```
{"content": "1|import { join } from 'node:path';\n2|import { openExistingDb } from '../../storage/db.js';\n3|import { renderCompact } from '../renderer.js';\n4|import { rankCallers } from '../rank.js';\n5|import { enforceBudget } from '../budget.js';\n6|import { collapseCallerEdges, expandClassRollupTargets } from './target_rollup.js';\n7|import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';\n8|import { loadManifest } from '../../freshness/manifest.js';\n9|import { computeTrustLevel } from './health.js';\n10|import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';\n11|import { buildTrustLine, buildAbsenceTrustLine, hasLspVerifiedEdge, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';\n12|import { EXECUTION_FAMILY, CALL_FAMILY } from '../../storage/taxonomy.js';\n13|import { normalizePathArg } from '../../util/paths.js';\n14|import { noMatchMessage } from '../did-you-mean.js';\n15|// ⚠ Shared with graph_callees, which has the identical defect mirrored onto outgoing edges.\n16|// One owner: fixing one verb and pasting into the other is how the two drift apart.\n17|import { unsearchedRelationNote } from '../unsearched-scope.js';\n18|import { indexedScopePhrase } from '../miss-scope.js';\n19|import { isOvercountSuspicious, describeResultCount } from '../overcount-risk.js';\n20|\n21|const EXECUTION_RELATIONS = EXECUTION_FAMILY;\n22|\n23|// ⛔ THE RELATIONS THIS VERB DELIBERATELY DOES 
…[15284 more chars cut]
```

### tool result: read_file
```
{"content": "1|// Code-Intel v2 / L2b — make clangd-derived LSP_VERIFIED edges VISIBLE and\n2|// TRUSTWORTHY in the agent-facing verbs.\n3|//\n4|// Asserts:\n5|//   (a) graph_callers marks the lsp-verified edge ([lsp✓]) AND emits the\n6|//       `TRUST: lsp-verified (...)` banner naming the compile-db hash.\n7|//   (b) a heuristic-only symbol emits the `TRUST: heuristic only (...)`\n8|//       undercount caveat (and never the lsp banner).\n9|//   (c) lsp-verified edges rank ABOVE heuristic ones (and are never the first\n10|//       dropped under budget).\n11|//\n12|// Producer side (LSP_VERIFIED edges + code_intel_collections row) landed in\n13|// L2a; this is the L2b consumer-surface test.\n14|\n15|import { describe, expect, it, beforeEach, afterEach } from 'vitest';\n16|import { mkdtemp, rm } from 'node:fs/promises';\n17|import { tmpdir } from 'node:os';\n18|import { join } from 'node:path';\n19|import { mkdirSync, writeFileSync } from 'node:fs';\n20|import { execFileSync } from 'node:child_process';\n21|import { openDb } from '../../../mcp/stdio/storage/db.js';\n22|import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';\n23|import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';\n24|import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';\n25|import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';\n26|import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';\n27|import { graphImpact } from '../../..
…[16207 more chars cut]
```

### tool result: search_files
```
{"total_count": 0}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callees.js",
 "limit": 145
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/scripts/run-vitest.mjs",
 "limit": 180
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/target_rollup.js",
 "limit": 180
}
```

### tool call: search_files
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query",
 "pattern": "EDGE_FETCH_CAP|fetch cap|SQL cap|file:.*src|file scope",
 "limit": 35
}
```

### tool result: read_file
```
{"content": "1|import { join } from 'node:path';\n2|import { openExistingDb } from '../../storage/db.js';\n3|import { renderCompact } from '../renderer.js';\n4|import { rankCallees } from '../rank.js';\n5|import { enforceBudget } from '../budget.js';\n6|import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';\n7|import { selectBestRoot } from './path.js';\n8|import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';\n9|import { buildTrustLine, buildAbsenceTrustLine, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';\n10|import { indexedScopePhrase } from '../miss-scope.js';\n11|import { EXECUTION_FAMILY, CALL_FAMILY } from '../../storage/taxonomy.js';\n12|import { normalizePathArg } from '../../util/paths.js';\n13|import { scanDynamicBoundaries, renderDynamicBoundaries, readSymbolBody } from '../dynamic-boundaries.js';\n14|import { noMatchMessage } from '../did-you-mean.js';\n15|// ⚠ Shared with graph_callers. This verb is the exact MIRROR — same narrowing, outgoing\n16|// instead of incoming — so it gets the same owner rather than a pasted copy that can drift.\n17|import { unsearchedRelationNote } from '../unsearched-scope.js';\n18|\n19|const EXECUTION_RELATIONS = EXECUTION_FAMILY;\n20|\n21|// ⛔ A CAP IS NOT A COUNT, and this verb had THREE bare `LIMIT 100`s — the exact defect written up\n22|// as \"worse\" about graph_impact, in the direct mirror of graph_callers. Ask who calls X
…[8284 more chars cut]
```

### tool result: read_file
```
{"content": "1|// Keep `npm test` consistent with MCP startup: if this checkout was last used\n2|// from another platform (Windows vs WSL), the preflight rebuilds better-sqlite3\n3|// once before Vitest boots.\n4|import '../mcp/stdio/preflight-native.js';\n5|import { startVitest } from 'vitest/node';\n6|\n7|const args = process.argv.slice(2);\n8|const watchIndex = args.indexOf('--watch');\n9|const mode = watchIndex >= 0 ? 'watch' : 'test';\n10|const filters = watchIndex >= 0\n11|  ? args.slice(0, watchIndex).concat(args.slice(watchIndex + 1))\n12|  : args;\n13|\n14|// ⛔ THIS RUNNER USED TO PASS `config: false` AND `pool: 'threads'`, WHICH DISCARDED\n15|// vitest.config.js ENTIRELY — the file `npm test` is supposed to be configured by.\n16|//\n17|// vitest.config.js pins two settings and explains at length why each is load-bearing:\n18|// `pool: 'forks'` (relative-reporoot.test.js calls process.chdir(), which THROWS in the\n19|// `threads` pool) and `fileParallelism: false` (real clangd/tsserver/pyright tests lose\n20|// races for CPU when run concurrently). Both were written INTO THE CONFIG while this\n21|// runner was already ignoring it, so `npm test` ran threads-parallel and failed 4 tests\n22|// that pass under `node node_modules/vitest/vitest.mjs`. Same tree, two runners, two\n23|// answers — and the documented command was the one that lied.\n24|//\n25|// ★ The config's own comment claims the requirement \"travels with the repo rather than\n26|// with my installed versio
…[903 more chars cut]
```

### tool result: read_file
```
{"content": "1|import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';\n2|\n3|function placeholders(values, prefix) {\n4|  return {\n5|    sql: values.map((_, index) => `$${prefix}${index}`).join(','),\n6|    params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])),\n7|  };\n8|}\n9|\n10|// `withCallerSets` is opt-in and only `graph_callers` passes it: its refusal is the one whose\n11|// subject IS the caller set, so a dead-end list of names is the milestone's named failure there and\n12|// merely noise in graph_impact or graph_trace.\n13|export function expandClassRollupTargets(db, symbol, { withCallerSets = false } = {}) {\n14|  // resolveSymbol handles class-qualified forms (C++ `Class::method`,\n15|  // dotted `Class.method`) by falling back to the bare name and\n16|  // disambiguating via extra.qname when the parent is named. Critical\n17|  // for C++ where agents naturally ask `GpuSimFramework::setGravAxis`.\n18|  const targets = resolveSymbol(db, symbol);\n19|  const ambiguity = buildAmbiguousMatchMessage(symbol, targets, 5, null,\n20|    { callerSetsFrom: withCallerSets ? db : null });\n21|  if (ambiguity) {\n22|    return {\n23|      targets: [],\n24|      targetIds: [],\n25|      rolledUp: false,\n26|      header: '',\n27|      methodIds: [],\n28|      error: ambiguity,\n29|    };\n30|  }\n31|  if (targets.length === 0) {\n32|    return { targets: [], targetIds: [], rolledUp: false, header: '', methodIds: [], erro
…[2098 more chars cut]
```

### tool result: search_files
```
{"total_count": 35, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query\\a-cap-is-not-a-count.test.js\n  8: // ⭐ AND 100 WAS NEVER A COUNT. `EDGE_FETCH_CAP` is 100, so `mapped.length` saturates there. The verb\n  150:     // overflows the display budget and does NOT reach the fetch cap, which is the only shape that\n<ARMS>/<ARM>/aify-project-graph/tests/unit/query\\absence-names-what-is-not-modelled.test.js\n  4: // incomplete, index not ready, collection stale, fetch cap hit. All of them answer \"how much do we\n<ARMS>/<ARM>/aify-project-graph/tests/unit/query\\absence-names-its-population.test.js\n  80:       upsertNode(db, node('file:app', 'app.py', 'src/app.py', 'File'));\n  83:         source_file: 'src/app.py', source_line: 40, confidence: 1,\n<ARMS>/<ARM>/aify-project-graph/tests/unit/query\\ambiguity-remedy-can-change-the-answer.test.js\n  5: // path afterwards. So {symbol:'render', file:'src/alpha.js'} still returns AMBIGUOUS MATCH — verified\n  64:     const viaTargetFile = String(await graphCallers({ repoRoot: repo, symbol: 'render', file: 'src/alpha.js' }));\n  65:     const viaCallerFile = String(await graphCallers({ repoRoot: repo, symbol: 'render', file: 'src/useAlpha.js' }));\n<ARMS>/<ARM>/aify-project-graph/tests/unit/query\\callees-bou
…[4594 more chars cut]
```

### tool call: read_file
```
{
 "offset": 145,
 "limit": 60,
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callees.js"
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query/evidence-tier-outranks-confidence.test.js"
}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/vitest.config.js"
}
```

### tool result: read_file
```
{"content": "145|      });\n146|      let line = '';\n147|      try { line = '\\n' + await buildAbsenceTrustLine({ noun: 'callees', db, repoRoot, freshness, language: sources[0]?.language }); }\n148|      // ⛔ NOT an empty catch — see lsp-evidence.js ABSENCE_TRUST_UNAVAILABLE.\n149|      catch { line = '\\n' + ABSENCE_TRUST_UNAVAILABLE; }\n150|      return prefixReadWarnings(msg + line + scope, freshness.warnings);\n151|    };\n152|\n153|    if (edges.length === 0 && overrideEdges.length === 0) return absence(`NO CALLEES for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n154|\n155|    let mapped = edges.map(e => ({\n156|      from_id: e.from_id, to_id: e.to_id, relation: e.relation,\n157|      // Displayed location stays the CALLEE'S DEFINITION — that is where the\n158|      // agent navigates next.\n159|      source_file: e.to_file, source_line: e.to_line,\n160|      // The CALL SITE is kept separately for ordering. Overwriting source_line\n161|      // with the definition line discarded the only field that could express\n162|      // call order, which is why the list came back scrambled (see rankCallees).\n163|      call_line: e.source_line ?? null,\n164|      confidence: e.confidence,\n165|      provenance: e.provenance ?? 'EXTRACTED',\n166|      depth: e.depth ?? 1,\n167|      from_type: 'Function', fan_in: 1,\n168|      to_label: e.to_label,\n169|    }));\n170|    // Merge virtual-override callees (INFERR
…[2631 more chars cut]
```

### tool result: read_file
```
{"content": "1|import { describe, expect, it, beforeEach, afterEach } from 'vitest';\n2|import { mkdtemp, rm } from 'node:fs/promises';\n3|import { mkdirSync, writeFileSync } from 'node:fs';\n4|import { execFileSync } from 'node:child_process';\n5|import { tmpdir } from 'node:os';\n6|import { join } from 'node:path';\n7|import { openDb } from '../../../mcp/stdio/storage/db.js';\n8|import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';\n9|import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';\n10|import { graphPreflight } from '../../../mcp/stdio/query/verbs/preflight.js';\n11|import { graphFile } from '../../../mcp/stdio/query/verbs/file.js';\n12|import { provenanceRank, provenanceRankSql } from '../../../mcp/stdio/query/lsp-evidence.js';\n13|\n14|// ⛔ CONFIDENCE IS NOT AN EVIDENCE TIER, AND TWO VERBS RANKED BY IT.\n15|//\n16|// Measured on the pinned click arm:\n17|//\n18|//     EXTRACTED     n=10976   conf 0.75..1.00  (avg 0.933)\n19|//     LSP_VERIFIED  n=1460    conf 0.95..0.95  (avg 0.950)\n20|//     AMBIGUOUS     n=1145    conf 0.75..0.95  (avg 0.930)\n21|//\n22|// The ranges overlap and the averages are indistinguishable, so `ORDER BY confidence DESC LIMIT n`\n23|// cannot rank tiers — the candidates tie and SQLite breaks the tie arbitrarily.\n24|//\n25|// ⛔ WHAT THAT DID TO THE DELETION-SAFETY VERB. `graph_preflight(\"Context\")` rendered five\n26|// EXTRACTED callers, every one of them from a test file, while 124 LSP_VERIFIED callers existed on\
…[9282 more chars cut]
```

### tool result: read_file
```
{"content": "1|import { defineConfig } from 'vitest/config';\n2|import { mkdirSync } from 'node:fs';\n3|import { join } from 'node:path';\n4|import { tmpdir } from 'node:os';\n5|\n6|// ⛔ EVERY TEST'S TEMP DIRECTORY LIVES INSIDE ONE PER-RUN ROOT THAT IS DELETED WHOLESALE.\n7|//\n8|// Measured 2026-09-02: 379,380 leaked directories in %TEMP%, 328,427 of them ours, ~26 GB,\n9|// accumulating since 2026-05-31 at roughly 2,000–4,000 per full suite run. Dozens of test files\n10|// call `mkdtempSync` and each relied on its own `afterAll`; the ones that forgot were invisible\n11|// because nothing checked. The volume eventually hit 100% and the suite died with ENOSPC.\n12|//\n13|// Node's `os.tmpdir()` reads TEMP/TMP (Windows) or TMPDIR (POSIX) at CALL time, so redirecting them\n14|// here relocates every `mkdtempSync(join(os.tmpdir(), …))` in every worker — and anything a spawned\n15|// child writes to its own temp dir, clangd included — without touching a single test file.\n16|//\n17|// ⇒ Computed at config-evaluation time because the value has to reach BOTH the worker `env` below\n18|// and the globalSetup teardown, which runs in this process.\n19|const RUN_TMP = join(tmpdir(), `apg-vitest-${process.pid}-${Date.now()}`);\n20|mkdirSync(RUN_TMP, { recursive: true });\n21|process.env.APG_TEST_TMP_ROOT = RUN_TMP;\n22|\n23|export default defineConfig({\n24|  test: {\n25|    // Deletes RUN_TMP after the run, and prunes roots abandoned by a crashed one.\n26|    globalSetup: ['./tests/hel
…[5947 more chars cut]
```

### tool call: write_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query/directory-scope-before-cap.test.js",
 "content": "import { describe, expect, it, beforeEach, afterEach } from 'vitest';\nimport { mkdtemp, rm } from 'node:fs/promises';\nimport { mkdirSync, writeFileSync } from 'node:fs';\nimport { execFileSync } from 'node:child_process';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport { openDb } from '../../../mcp/stdio/storage/db.js';\nimport { upsertNode } from '../../../mcp/stdio/storage/nodes.js';\nimport { upsertEdge } from '../../../mcp/stdio/storage/edges.js';\nimport { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';\nimport { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';\n\nfor (const [direction, query] of [['callers', graphCallers], ['callees', graphCallees]]) {\n  describe(`${direction}: directory scope precedes the SQL fetch cap`, () => {\n    let repoRoot;\n    let db;\n    const node = (id, file_path) => ({\n      id, type: 'Function', label: id, file_path,\n      start_line: 1, end_line: 1, language: 'cpp', confidence: 1,\n      structural_fp: '', dependency_fp: '', extra: {},\n    });\n    const edge = (neighbor, target = 'target', provenance = 'INFERRED', relation = 'CALLS') => {\n      upsertEdge(db, {\n        from_id: direction === 'callers' ? neighbor : target,\n        to_id: direction === 'callers' ? target : neighbor,\n        relation, source_file: 'outside/call.cpp', source_li
…[4128 more chars cut]
```

### tool result: write_file
```
{"bytes_written": 5390, "dirs_created": true, "verified": true, "lint": {"status": "ok", "output": ""}, "resolved_path": "<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js", "files_modified": ["<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js"]}
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/directory-scope-before-cap.test.js",
 "timeout": 180
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.9.0 test\n> node ./scripts/run-vitest.mjs tests/unit/query/directory-scope-before-cap.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ❯ tests/unit/query/directory-scope-before-cap.test.js (13 tests | 10 failed) 74375ms\n   × callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=1 5609ms\n     → expected 'NO CALLERS from \"wanted/\"\\nTRUST: abs…' to contain 'scopedNeighbor'\n   × callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=1 7017ms\n     → expected 'NO CALLERS from \"wanted/\"\\nTRUST: abs…' to contain 'scopedNeighbor'\n   × callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=2 4791ms\n     → expected 'NO CALLERS from \"wanted/\"\\nTRUST: abs…' to contain 'scopedNeighbor'\n   × callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=2 5327ms\n     → expected 'NO CALLERS from \"wanted/\"\\nTRUST: abs…' to contain 'scopedNeighbor'\n   × callers: directory scope precedes the SQL fetch cap > traverses an out-of-scope intermediate to find an in-scope depth-2 neighbor 6509ms\n     → expected 'NO CALLERS from \"wanted/\"\\nTRUST: abs…' to contain 'scopedNeighbor'\n   × callers: directory scope precedes the SQL fetch cap > preserves literal, case-sensitive prefix matching and Windows path normalization 2469ms\n     → expected 'NO 
…[11842 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: <ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callers.js\n@@\n     targetIds.forEach((id, i) => { params[`t${i}`] = id; });\n+    // Scope before LIMIT: unrelated callers must not consume the scoped fetch budget.\n+    // substr preserves startsWith's literal, case-sensitive semantics (unlike LIKE).\n+    const fileScope = file ? 'AND substr(n.file_path, 1, length($file)) = $file' : '';\n+    const queryParams = file ? { ...params, file } : params;\n@@\n          WHERE e.to_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})\n+         ${fileScope}\n          LIMIT ${EDGE_FETCH_CAP + 1}`,\n-        params\n+        queryParams\n@@\n          JOIN nodes n ON n.id = e.from_id\n+         -- Filter the result, not the traversal: ancestors may cross directory boundaries.\n+         WHERE 1 = 1 ${fileScope}\n          LIMIT ${EDGE_FETCH_CAP + 1}`,\n-        { ...params, depth }\n+        { ...queryParams, depth }\n@@\n-    // File scope filter: only show callers from a specific directory\n-    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));\n*** Update File: <ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callees.js\n@@\n     sourceIds.forEach((id, i) => { scopeParams[`s${i}`] = id; });\n+    // Apply the directory scope before each fetch cap, including virtual overrides.\n+  
…[1173 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js\n@@ -48,6 +48,10 @@\n     const placeholders = targetIds.map((_, i) => `$t${i}`).join(',');\n     const params = {};\n     targetIds.forEach((id, i) => { params[`t${i}`] = id; });\n+    // Scope before LIMIT: unrelated callers must not consume the scoped fetch budget.\n+    // substr preserves startsWith's literal, case-sensitive semantics (unlike LIKE).\n+    const fileScope = file ? 'AND substr(n.file_path, 1, length($file)) = $file' : '';\n+    const queryParams = file ? { ...params, file } : params;\n \n     // The SQL cap is a HARDER ceiling than the top_k display budget: past it the\n     // edges were never fetched, so raising top_k cannot reveal them and the trust\n@@ -59,8 +63,9 @@\n         `SELECT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line\n          FROM edges e JOIN nodes n ON n.id = e.from_id\n          WHERE e.to_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})\n+         ${fileScope}\n          LIMIT ${EDGE_FETCH_CAP + 1}`,\n-        params\n+        queryParams\n       );\n     } else {\n       edges = db.all(\n@@ -81,8 +86,10 @@\n           AND e.to_id = c.to_id\n           AND e.relation IN (${EXECUTION_RELATIONS.map((relati
…[5315 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: <ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callers.js\n@@\n-    if (edges.length === 0) return absence(`NO CALLERS for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n+    if (edges.length === 0) return absence(file ? `NO CALLERS from \"${file}\"${indexedScopePhrase(db)}` : `NO CALLERS for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n@@\n-    // line to show. It is also what makes the `file` directory filter below mean\n+    // line to show. It is also what makes the SQL `file` directory filter mean\n*** Update File: <ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/verbs/callees.js\n@@\n-    if (edges.length === 0 && overrideEdges.length === 0) return absence(`NO CALLEES for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n+    if (edges.length === 0 && overrideEdges.length === 0) return absence(file ? `NO CALLEES in \"${file}\"${indexedScopePhrase(db)}` : `NO CALLEES for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n@@\n     overrideCount = overrideMapped.length;\n \n-\n     if (mapped.length === 0 && overrideCount === 0) return absence(file ? `NO CALLEES in \"${file}\"${indexedScopePhrase(db)}` : `NO CALLEES
…[135 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js\n@@ -128,13 +128,13 @@\n       return prefixReadWarnings(msg + line + scope, freshness.warnings);\n     };\n \n-    if (edges.length === 0) return absence(`NO CALLERS for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n+    if (edges.length === 0) return absence(file ? `NO CALLERS from \"${file}\"${indexedScopePhrase(db)}` : `NO CALLERS for \"${symbol}\"${indexedScopePhrase(db)}. Try graph_whereis(symbol=\"${symbol}\", expand=true) for an overview.`);\n \n     // NOTE (P0-4): `source_file`/`source_line` here carry the CALLER's\n     // DECLARATION location, not the call site. That is deliberate — edges are\n     // function-granular (see docs/known-limitations.md), so one edge can stand\n     // for several call sites inside the caller and there is no single call-site\n-    // line to show. It is also what makes the `file` directory filter below mean\n+    // line to show. It is also what makes the SQL `file` directory filter mean\n     // \"callers living under this path\". The location is honest data; what was\n     // NOT honest was rendering it in a format that reads as a call site, so the\n     // output now says which it is (see LOCATIONS note below).\n\n--- a/<ARMS>/<ARM>\
…[1750 more chars cut]
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/directory-scope-before-cap.test.js tests/unit/query/lsp-verified-surface.test.js tests/unit/query/a-cap-is-not-a-count.test.js tests/unit/query/every-capped-verb-reports-its-floor.test.js tests/unit/query/caller-callee-chain.test.js && git diff --check",
 "timeout": 600
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.9.0 test\n> node ./scripts/run-vitest.mjs tests/unit/query/directory-scope-before-cap.test.js tests/unit/query/lsp-verified-surface.test.js tests/unit/query/a-cap-is-not-a-count.test.js tests/unit/query/every-capped-verb-reports-its-floor.test.js tests/unit/query/caller-callee-chain.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ✓ tests/unit/query/directory-scope-before-cap.test.js (13 tests) 30167ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=1  1611ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=1  1034ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=2  381ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=2  1017ms\n   ✓ callers: directory scope precedes the SQL fetch cap > traverses an out-of-scope intermediate to find an in-scope depth-2 neighbor  1223ms\n   ✓ callers: directory scope precedes the SQL fetch cap > preserves literal, case-sensitive prefix matching and Windows path normalization  2245ms\n   ✓ callees: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=1  1426ms\n   ✓ callees: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=1  1903ms\n   ✓ callees: directory scope precedes the
…[4779 more chars cut]
```

### tool call: read_file
```
{
 "offset": 115,
 "limit": 45,
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query/every-capped-verb-reports-its-floor.test.js"
}
```

### tool call: terminal
```
{
 "command": "git diff --stat && git status --short",
 "timeout": 30
}
```

### tool call: search_files
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/renderer.js",
 "pattern": "TRUNCATED|truncated",
 "limit": 15
}
```

### tool result: read_file
```
{"content": "115| * carried a `candidate cap:` note reading \"matched at least 200 nodes … results are a FLOOR\", and\n116| * it fires on the SAME condition as the marker. So a whole-output assertion passes whether or not\n117| * `truncatedIsFloor` is wired at all, and would have kept passing if I had wired nothing — which is\n118| * the vacuous-test shape this file exists to avoid. Measured, not assumed: at 201 nodes the answer\n119| * contains \"at least\" twice, on two different lines.\n120| */\n121|const markerLine = (out) => out.split('\\n').find((l) => /^(TRUNCATED |\\+\\d)/.test(l));\n122|\n123|const VERBS = [\n124|  { name: 'graph_callers',   cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphCallers({ repoRoot: rr, symbol: 'target' }) },\n125|  { name: 'graph_impact',    cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphImpact({ repoRoot: rr, symbol: 'target', depth: 1 }) },\n126|  { name: 'graph_callees',   cap: EDGE_CAP,   build: (n) => fanRepo(n, 'out'), run: (rr) => graphCallees({ repoRoot: rr, symbol: 'target', depth: 1 }) },\n127|  { name: 'graph_neighbors', cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphNeighbors({ repoRoot: rr, symbol: 'target' }) },\n128|  { name: 'graph_search',    cap: SEARCH_CAP, build: (n) => labelRepo(n),      run: (rr) => graphSearch({ repoRoot: rr, query: 'widget' }) },\n129|];\n130|\n131|describe('every capped verb reports a floor when its fetch saturates', () => {\n132|  for (c
…[2277 more chars cut]
```

### tool result: terminal
```
{"output": "mcp/stdio/query/verbs/callees.js | 19 +++++++++++++------\n mcp/stdio/query/verbs/callers.js | 18 ++++++++++++------\n 2 files changed, 25 insertions(+), 12 deletions(-)\n M mcp/stdio/query/verbs/callees.js\n M mcp/stdio/query/verbs/callers.js\n?? tests/unit/query/directory-scope-before-cap.test.js", "exit_code": 0, "error": null}
```

### tool result: search_files
```
{"total_count": 11, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "<ARMS>/<ARM>/aify-project-graph/mcp/stdio/query/renderer.js\n  76:  * `truncated` is display budget: how many rows the renderer dropped to fit `top_k`. It is computed\n  78:  * held are themselves a floor, so the remainder is a floor too and \"TRUNCATED 70 more\" states a\n  82:  * 101 printed 30 rows and \"TRUNCATED 70 more\" — implying exactly 100 — with no confidence line at\n  98:  * @param {boolean} truncatedIsFloor  did the verb's fetch saturate, making the remainder a floor.\n  99:  *                                    REQUIRED whenever `truncated > 0`.\n  102:   { nodes = [], edges = [], truncated = 0, suggestion = '', truncatedIsFloor },\n  108:   if (truncated > 0) {\n  109:     if (typeof truncatedIsFloor !== 'boolean') {\n  111:         'renderCompact: reporting a remainder of ' + truncated + ' requires truncatedIsFloor. '\n  118:     const count = truncatedIsFloor ? `at least ${truncated}` : `${truncated}`;\n  119:     const marker = useCompact(opts) ? `+${count} more` : `TRUNCATED ${count} more`;"}
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: <ARMS>/<ARM>/aify-project-graph/tests/unit/query/directory-scope-before-cap.test.js\n@@\n-          expect(out).not.toContain('TRUNCATED');\n+          expect(out).not.toMatch(/^(TRUNCATED |\\+)/m);\n@@\n       }\n+      it(`still reports saturation when the scoped set exceeds the cap at depth=${depth}`, async () => {\n+        for (let i = 0; i < 120; i += 1) {\n+          upsertNode(db, node(`heuristic${i}`, `wanted/${i}.cpp`));\n+        }\n+        const out = await query({ repoRoot, symbol: 'target', file: 'wanted/', depth, top_k: 1 });\n+        const marker = out.split('\\n').find((line) => /^(TRUNCATED |\\+)/.test(line));\n+        expect(marker).toMatch(/at least 99 more/);\n+      });\n     }\n*** End Patch"
}
```

### tool result: patch
```
{"success": false, "error": "Patch validation failed (no files were modified):\n  • <ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js: hunk 2 (no hint) not found — Found 2 matches for old_string. Provide more context to make it unique, or use replace_all=True. Matches:\n  L49: }\n  L71: }"}
```

### tool call: read_file
```
{
 "path": "<ARMS>/<ARM>/aify-project-graph/tests/unit/query/directory-scope-before-cap.test.js",
 "offset": 53,
 "limit": 28
}
```

### tool result: read_file
```
{"content": "53|      db?.close();\n54|      await rm(repoRoot, { recursive: true, force: true });\n55|    });\n56|\n57|    for (const depth of [1, 2]) {\n58|      for (const provenance of ['LSP_VERIFIED', 'INFERRED']) {\n59|        it(`finds the scoped ${provenance} neighbor at depth=${depth}`, async () => {\n60|          upsertNode(db, node('scopedNeighbor', 'wanted/caller.cpp'));\n61|          edge('scopedNeighbor', 'target', provenance);\n62|          const out = await query({ repoRoot, symbol: 'target', file: 'wanted/', depth });\n63|          expect(out).toContain('scopedNeighbor');\n64|          expect(out).toContain('wanted/caller.cpp:1');\n65|          expect(out).not.toContain('NO CALL');\n66|          expect(out).not.toContain('heuristic0');\n67|          // The out-of-scope rows must not make a one-row scoped answer look truncated.\n68|          expect(out).not.toContain('TRUNCATED');\n69|          if (provenance === 'LSP_VERIFIED') expect(out).toContain('[lsp✓]');\n70|        });\n71|      }\n72|    }\n73|\n74|    it('traverses an out-of-scope intermediate to find an in-scope depth-2 neighbor', async () => {\n75|      upsertNode(db, node('scopedNeighbor', 'wanted/caller.cpp'));\n76|      edge('scopedNeighbor', 'heuristic0', 'LSP_VERIFIED');\n77|      const direct = await query({ repoRoot, symbol: 'target', file: 'wanted/', depth: 1 });\n78|      expect(direct).toContain('NO CALL');\n79|      const transitive = await query({ repoRoot, symbol: 'target', file: 'want
…[269 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: <ARMS>/<ARM>/aify-project-graph/tests/unit/query/directory-scope-before-cap.test.js\n@@\n-          expect(out).not.toContain('TRUNCATED');\n+          expect(out).not.toMatch(/^(TRUNCATED |\\+)/m);\n           if (provenance === 'LSP_VERIFIED') expect(out).toContain('[lsp✓]');\n         });\n       }\n+      it(`still reports saturation when the scoped set exceeds the cap at depth=${depth}`, async () => {\n+        for (let i = 0; i < 120; i += 1) {\n+          upsertNode(db, node(`heuristic${i}`, `wanted/${i}.cpp`));\n+        }\n+        const out = await query({ repoRoot, symbol: 'target', file: 'wanted/', depth, top_k: 1 });\n+        const marker = out.split('\\n').find((line) => /^(TRUNCATED |\\+)/.test(line));\n+        expect(marker).toMatch(/at least 99 more/);\n+      });\n     }\n*** End Patch"
}
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js\n@@ -65,10 +65,18 @@\n           expect(out).not.toContain('NO CALL');\n           expect(out).not.toContain('heuristic0');\n           // The out-of-scope rows must not make a one-row scoped answer look truncated.\n-          expect(out).not.toContain('TRUNCATED');\n+          expect(out).not.toMatch(/^(TRUNCATED |\\+)/m);\n           if (provenance === 'LSP_VERIFIED') expect(out).toContain('[lsp✓]');\n         });\n       }\n+      it(`still reports saturation when the scoped set exceeds the cap at depth=${depth}`, async () => {\n+        for (let i = 0; i < 120; i += 1) {\n+          upsertNode(db, node(`heuristic${i}`, `wanted/${i}.cpp`));\n+        }\n+        const out = await query({ repoRoot, symbol: 'target', file: 'wanted/', depth, top_k: 1 });\n+        const marker = out.split('\\n').find((line) => /^(TRUNCATED |\\+)/.test(line));\n+        expect(marker).toMatch(/at least 99 more/);\n+      });\n     }\n \n     it('traverses an out-of-scope intermediate to find an in-scope depth-2 neighbor', async () => {\n", "files_modified": ["<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\directory-scope-before-cap.test.js"], "lint": {"<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\que
…[444 more chars cut]
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/directory-scope-before-cap.test.js tests/unit/query/absence-headlines-name-the-scope.test.js tests/unit/query/absence-names-its-population.test.js tests/unit/query/ambiguity-remedy-can-change-the-answer.test.js tests/unit/query/every-absence-names-its-scope.test.js && git diff --check",
 "timeout": 600
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.9.0 test\n> node ./scripts/run-vitest.mjs tests/unit/query/directory-scope-before-cap.test.js tests/unit/query/absence-headlines-name-the-scope.test.js tests/unit/query/absence-names-its-population.test.js tests/unit/query/ambiguity-remedy-can-change-the-answer.test.js tests/unit/query/every-absence-names-its-scope.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ✓ tests/unit/query/directory-scope-before-cap.test.js (17 tests) 73142ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=1  3157ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=1  1429ms\n   ✓ callers: directory scope precedes the SQL fetch cap > still reports saturation when the scoped set exceeds the cap at depth=1  6441ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped LSP_VERIFIED neighbor at depth=2  1518ms\n   ✓ callers: directory scope precedes the SQL fetch cap > finds the scoped INFERRED neighbor at depth=2  7715ms\n   ✓ callers: directory scope precedes the SQL fetch cap > still reports saturation when the scoped set exceeds the cap at depth=2  12835ms\n   ✓ callers: directory scope precedes the SQL fetch cap > traverses an out-of-scope intermediate to find an in-scope depth-2 neighbor  12169ms\n   ✓ callers: directory scope precedes the SQL fetch cap > preserves literal, case-sensitive prefix matchin
…[6789 more chars cut]
```

### assistant
Fixed the cause: graph_callers fetched and capped 100 edges before applying the directory filter. Out-of-scope heuristic callers could exhaust that cap, hiding the LSP_VERIFIED caller and producing a false NO CALLERS.

Changes:
  - Apply the directory filter in SQL before LIMIT, for direct and recursive queries.
  - Keep recursive traversal through out-of-scope intermediates.
  - Preserve literal, case-sensitive prefix matching and Windows path normalization.
  - Fix the mirrored issue in graph_callees, including virtual overrides.

Added 17 regression tests in tests/unit/query/directory-scope-before-cap.test.js. The original reproduction failed before the fix and passes afterward.

Verification: both targeted test runs passed—47 tests and 54 tests respectively. git diff --check passed. The full suite was not run.

### FINAL
Fixed the cause: graph_callers fetched and capped 100 edges before applying the directory filter. Out-of-scope heuristic callers could exhaust that cap, hiding the LSP_VERIFIED caller and producing a false NO CALLERS.

Changes:
  - Apply the directory filter in SQL before LIMIT, for direct and recursive queries.
  - Keep recursive traversal through out-of-scope intermediates.
  - Preserve literal, case-sensitive prefix matching and Windows path normalization.
  - Fix the mirrored issue in graph_callees, including virtual overrides.

Added 17 regression tests in tests/unit/query/directory-scope-before-cap.test.js. The original reproduction failed before the fix and passes afterward.

Verification: both targeted test runs passed—47 tests and 54 tests respectively. git diff --check passed. The full suite was not run.
