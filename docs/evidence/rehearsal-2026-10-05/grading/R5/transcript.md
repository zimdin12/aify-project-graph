# R5 — runtime: hermes, task: T2

### tool call: terminal
```
{
 "command": "git status --short && git branch --show-current"
}
```

### tool call: search_files
```
{
 "pattern": "lspVerifiedPctOfVerifiableInScopeCalls|verifiableInScope",
 "path": ".",
 "limit": 50
}
```

### tool call: read_file
```
{
 "path": "package.json"
}
```

### tool result: terminal
```
{"output": "main", "exit_code": 0, "error": null}
```

### tool result: search_files
```
{"total_count": 3, "matches": [{"path": ".\\docs\\superpowers\\specs\\2026-08-10-contradiction-surface-design.md", "line": 168, "content": "`lspVerifiedPctOfVerifiableInScopeCalls` exists to fix."}, {"path": ".\\docs\\superpowers\\specs\\2026-08-10-contradiction-surface-design.md", "line": 286, "content": "`lspVerifiedPctOfVerifiableInScopeCalls`, not `lspVerifiedPctOfCalls` beside a"}, {"path": ".\\mcp\\stdio\\query\\verbs\\health.js", "line": 1571, "content": "        codeIntel.lspVerifiedPctOfVerifiableInScopeCalls = verifiedPct;"}]}
```

### tool result: read_file
```
{"content": "1|{\n2|  \"name\": \"aify-project-graph\",\n3|  \"version\": \"0.7.1\",\n4|  \"description\": \"On-demand codebase graph map for coding agents (Claude Code, Codex). Tree-sitter extraction → SQLite graph → compact MCP query verbs.\",\n5|  \"type\": \"module\",\n6|  \"license\": \"MIT\",\n7|  \"scripts\": {\n8|    \"test\": \"node ./scripts/run-vitest.mjs\",\n9|    \"test:watch\": \"node ./scripts/run-vitest.mjs --watch\",\n10|    \"validate:marketplace\": \"node ./scripts/validate-marketplace-package.mjs\",\n11|    \"smoke\": \"node scripts/smoke.mjs\"\n12|  },\n13|  \"bin\": {\n14|    \"apg\": \"./bin/apg.js\",\n15|    \"aify-code-intel\": \"./bin/aify-code-intel.js\"\n16|  },\n17|  \"dependencies\": {\n18|    \"3d-force-graph\": \"^1.80.0\",\n19|    \"ajv\": \"^8.20.0\",\n20|    \"ajv-formats\": \"^3.0.1\",\n21|    \"better-sqlite3\": \"^11.0.0\",\n22|    \"cytoscape\": \"^3.30.4\",\n23|    \"cytoscape-dagre\": \"^3.0.0\",\n24|    \"cytoscape-expand-collapse\": \"^4.1.1\",\n25|    \"cytoscape-fcose\": \"^2.2.0\",\n26|    \"ngraph.graph\": \"^20.1.2\",\n27|    \"ngraph.leiden\": \"^0.2.0\",\n28|    \"proper-lockfile\": \"^4.1.2\",\n29|    \"pyright\": \"^1.1.410\",\n30|    \"tree-sitter\": \"^0.22.0\",\n31|    \"tree-sitter-c\": \"^0.23.0\",\n32|    \"tree-sitter-cpp\": \"^0.23.0\",\n33|    \"tree-sitter-css\": \"^0.23.2\",\n34|    \"tree-sitter-glsl\": \"^0.2.0\",\n35|    \"tree-sitter-go\": \"^0.23.0\",\n36|    \"tree-sitter-java\": \"^0.23.0\",\n37|    \"tree-
…[552 more chars cut]
```

### tool call: read_file
```
{
 "path": "mcp/stdio/query/verbs/health.js",
 "offset": 1360,
 "limit": 260
}
```

### tool call: search_files
```
{
 "pattern": "lspVerifiedPct|verifiable.*Calls|verifiable_in_scope|verifiedPct",
 "path": "tests",
 "limit": 80
}
```

### tool call: read_file
```
{
 "path": ".aify-graph/brief.agent.md",
 "limit": 100
}
```

### tool call: read_file
```
{
 "path": "scripts/run-vitest.mjs"
}
```

### tool result: read_file
```
{"content": "1360|    return {\n1361|      commits_behind: behind,\n1362|      unaffected: [\n1363|        'live code_intel_* verbs — they query the language server, not this snapshot',\n1364|        'last_touched / activity — these run `git log` at query time, not from the index',\n1365|      ],\n1366|      degraded: [\n1367|        'symbol lookups for code added since the indexed commit — a \"not found\" may mean \"not indexed yet\"',\n1368|        'callers/callees/impact over new or moved code',\n1369|        'file lists and per-file digests, which reflect the indexed tree',\n1370|      ],\n1371|      unaffected_by_staleness_but_check_separately: [\n1372|        'feature/task overlay fields — they age on their OWN clock (see artifactAges), not on commit distance',\n1373|      ],\n1374|      note:\n1375|        'Staleness is only fatal for questions ABOUT CODE THAT CHANGED. Orientation, architecture shape '\n1376|        + 'and \"what connects to what\" over untouched code are unaffected. If your question concerns recent '\n1377|        + 'work, run graph_index() first — an absence here is not evidence of absence.',\n1378|    };\n1379|  })() : null;\n1380|\n1381|  // LH-3 (2026-07-26): `graph_index` refreshes the structural graph + briefs and\n1382|  // says NOTHING about the other derived artifacts, so \"reindexed\" reasonably\n1383|  // reads as \"everything is current\". Measured on sand_castle right after a\n1384|  // successful reindex: functionality.json 54 days old, 
…[16487 more chars cut]
```

### tool result: search_files
```
{"total_count": 1, "matches": [{"path": "tests\\unit\\query\\coverage-denominator.test.js", "line": 11, "content": "// `verifiable_and_in_scope_calls`, `lspOutOfScopeCalls`, `LSP_VERIFIABLE_LANGUAGES`, and"}]}
```

### tool result: read_file
```
{"content": "", "total_lines": 0, "file_size": 0, "truncated": false, "is_binary": false, "is_image": false, "error": "File not found: <ARMS>/<ARM>\\aify-project-graph\\.aify-graph\\brief.agent.md", "not_found": true}
```

### tool result: read_file
```
{"content": "1|// Keep `npm test` consistent with MCP startup: if this checkout was last used\n2|// from another platform (Windows vs WSL), the preflight rebuilds better-sqlite3\n3|// once before Vitest boots.\n4|import '../mcp/stdio/preflight-native.js';\n5|import { startVitest } from 'vitest/node';\n6|\n7|const args = process.argv.slice(2);\n8|const watchIndex = args.indexOf('--watch');\n9|const mode = watchIndex >= 0 ? 'watch' : 'test';\n10|const filters = watchIndex >= 0\n11|  ? args.slice(0, watchIndex).concat(args.slice(watchIndex + 1))\n12|  : args;\n13|\n14|// ⛔ THIS RUNNER USED TO PASS `config: false` AND `pool: 'threads'`, WHICH DISCARDED\n15|// vitest.config.js ENTIRELY — the file `npm test` is supposed to be configured by.\n16|//\n17|// vitest.config.js pins two settings and explains at length why each is load-bearing:\n18|// `pool: 'forks'` (relative-reporoot.test.js calls process.chdir(), which THROWS in the\n19|// `threads` pool) and `fileParallelism: false` (real clangd/tsserver/pyright tests lose\n20|// races for CPU when run concurrently). Both were written INTO THE CONFIG while this\n21|// runner was already ignoring it, so `npm test` ran threads-parallel and failed 4 tests\n22|// that pass under `node node_modules/vitest/vitest.mjs`. Same tree, two runners, two\n23|// answers — and the documented command was the one that lied.\n24|//\n25|// ★ The config's own comment claims the requirement \"travels with the repo rather than\n26|// with my installed versio
…[903 more chars cut]
```

### tool call: search_files
```
{
 "path": ".",
 "pattern": "computeCoverage",
 "limit": 40
}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/coverage-denominator.test.js"
}
```

### tool call: search_files
```
{
 "path": "tests",
 "pattern": "graph_health\\(|graphHealth\\(|health\\(",
 "file_glob": "*health*",
 "limit": 30
}
```

### tool call: read_file
```
{
 "path": "mcp/stdio/query/verbs/health.js",
 "offset": 1,
 "limit": 85
}
```

### tool result: search_files
```
{"total_count": 40, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": ".\\docs\\2026-08-12-refactor-proposal.md\n  28: >    renderers could not move until `computeCoverage` and the task readers landed where both\n  70: > `mcp/stdio/dashboard/server.js` also exists. `computeCoverage` is\n  157: declared outside the render block are called from inside it: `computeCoverage` (declared line\n  162: puts `computeCoverage` in `generator.js` and the renderers in `render.js` — but `generator.js`\n  163: must import `render.js` to call them, and `render.js` would import `computeCoverage` back. In\n  164: the slice nominated *second-safest*. `computeCoverage` and the three task-artifact readers must\n  188: brief/generator.js   orchestration + computeCoverage      ~250\n.\\mcp\\stdio\\brief\\render.js\n  11: // these needed `computeCoverage` from generator.js. brief/artifacts.js exists to break that,\n  25: import { computeCoverage, openTasksByFeature, completedTaskCountsByFeature, openTasksWithoutFeatures } from './artifacts.js';\n  835:           coverage: computeCoverage({\n.\\mcp\\stdio\\brief\\generator.js\n  20: import { computeCoverage, openTasksByFeature, completedTaskCountsByFeature, openTasksWithoutFeatures } from './artifacts.js';\n  22: // exported both `computeCoverage` and `generateBrief`; the artifacts slice moved the first and\n  26: export { computeCoverage } from './
…[3386 more chars cut]
```

### tool result: read_file
```
{"content": "1|// THE DENOMINATOR DECIDES WHETHER A COVERAGE NUMBER MEANS ANYTHING.\n2|//\n3|// Dividing verified edges by EVERY CALLS edge reported 12% on a repo where every\n4|// verifiable edge had in fact been verified. That reads as a coverage failure and was an\n5|// accounting one — and the field test checked the 833/1599 arithmetic against this exact\n6|// field, which makes it one of the few they confirmed they actually use.\n7|//\n8|// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.\n9|//\n10|// The previous version was eight regexes over health.js: `verified / verifiable`,\n11|// `verifiable_and_in_scope_calls`, `lspOutOfScopeCalls`, `LSP_VERIFIABLE_LANGUAGES`, and\n12|// so on. Every one asserts SPELLING. None could fail on a wrong number — and a wrong\n13|// number is the entire failure mode of a coverage statistic.\n14|//\n15|// The computation was inline in health.js, which is why it had never been tested by\n16|// running it. It now lives in `query/coverage-denominator.js` and this calls it with rows\n17|// and compares integers.\n18|import { describe, it, expect } from 'vitest';\n19|import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../../../mcp/stdio/query/coverage-denominator.js';\n20|\n21|describe('lsp coverage denominator', () => {\n22|  it('★★ divides by the VERIFIABLE subset, not by every CALLS edge', () => {\n23|    // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 JS edges\n24|    // no backend here can verify. The honest a
…[3841 more chars cut]
```

### tool result: search_files
```
{"total_count": 30, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "tests\\unit\\query\\health-brief-stale.test.js\n  50:     const result = await graphHealth({ repoRoot });\n  71:     const result = await graphHealth({ repoRoot });\n  107:     const result = await graphHealth({ repoRoot });\n  127:     const result = await graphHealth({ repoRoot });\n  142:     const result = await graphHealth({ repoRoot });\ntests\\unit\\query\\health-code-intel.test.js\n  23:     const result = await graphHealth({ repoRoot: dir });\n  35:     const result = await graphHealth({ repoRoot: dir });\ntests\\unit\\query\\health-collection-coverage.test.js\n  119:     const h = await graphHealth({ repoRoot: repo });\n  134:     const h = await graphHealth({ repoRoot: repo });\n  147:     const h = await graphHealth({ repoRoot: repo });\n  158:     const h = await graphHealth({ repoRoot: repo });\n  239:     const h = await graphHealth({ repoRoot: repo });\n  263:     const h = await graphHealth({ repoRoot: repo });\n  288:     const h = await graphHealth({ repoRoot: repo });\ntests\\unit\\query\\health-dirty-noise.test.js\n  60:     const res = await graphHealth({ repoRoot });\n  74:     const res = await graphHealth({ repoRoot });\n  90:     const res = await graphHealth({ repoRoot });\ntests\\unit\\query\\health-fragment-count-can-fail.test.js\n  44: const summary = async () => String((awa
…[934 more chars cut]
```

### tool result: read_file
```
{"content": "1|// graph_health — single trustable answer to \"is the graph usable right now?\"\n2|//\n3|// Echoes PM feedback 2026-04-21: \"To answer 'is the graph usable right now?'\n4|// an agent has to call graph_index, read brief.plan.md, parse the TRUST line,\n5|// cross-reference. All three can disagree.\" This verb aggregates those signals\n6|// into one response so a session can check health in a single call.\n7|//\n8|// Synthesis-only. No new data — just a coherent view of what graph_status +\n9|// the overlay validator + the brief's trust logic already expose.\n10|\n11|import { join, dirname } from 'node:path';\n12|import { graphCapabilities } from '../graph-capabilities.mjs';\n13|import { getBackend } from '../../code-intel/backends.js';\n14|import { existsSync, readFileSync, statSync } from 'node:fs';\n15|import { fileURLToPath } from 'node:url';\n16|import { execFileSync } from 'node:child_process';\n17|\n18|// HOW MUCH OF THE COLLECTION'S EVIDENCE HAS ALREADY DECAYED.\n19|//\n20|// The salvage gate drops verified evidence per FILE: a covered file that changed since the\n21|// collection loses it on the next rebuild. So the honest magnitude is \"how many of the files this\n22|// collection covered have changed\", not \"how many commits have passed\" — 121 commits that touch no\n23|// covered file destroy nothing, and one that rewrites forty covered files destroys a great deal.\n24|//\n25|// Returns nulls rather than zeros when it cannot tell. A zero here would re
…[3737 more chars cut]
```

### tool call: read_file
```
{
 "path": "mcp/stdio/query/coverage-denominator.js"
}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/health-collection-coverage.test.js"
}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/health-code-intel.test.js"
}
```

### tool call: search_files
```
{
 "path": "mcp",
 "pattern": "lspVerifiedEdges|lspCallsVerifiable|computeCoverage\\(langScopeRows",
 "limit": 40
}
```

### tool result: read_file
```
{"content": "1|// ★ THE DENOMINATOR, EXTRACTED SO IT CAN BE RUN INSTEAD OF GREPPED.\n2|//\n3|// `lspVerifiedPct` was computed inline in health.js, so the only way to guard it was to\n4|// assert regexes over that file — eight of them, all spelling. the field test rates this\n5|// denominator among the fields they ACTUALLY USED (they checked the 833/1599 arithmetic\n6|// against it), which makes a test that cannot fail on a wrong number the worst kind to\n7|// have here.\n8|//\n9|// Pulling it out is a small refactor with a large consequence: the invariant becomes\n10|// checkable by calling it with rows and comparing integers.\n11|//\n12|// THE INVARIANTS, each of which was a real defect at some point:\n13|//\n14|//  1. DIVIDE BY THE VERIFIABLE SUBSET, NOT BY EVERY CALLS EDGE. Dividing by all calls\n15|//     reported 12% on a repo where every verifiable edge was verified — a number that\n16|//     read as a coverage failure and was an accounting one.\n17|//  2. OUT-OF-SCOPE EDGES NEVER ENTER, AND NEVER MIGRATE IN. An edge outside the tracked\n18|//     corpus is not verifiable debt; if a backend for its language later lands, it must\n19|//     not silently appear in the denominator and drop the percentage.\n20|//  3. UNVERIFIABLE-BY-CONSTRUCTION IS NOT UNVERIFIED-BY-OMISSION. A JS edge in a C++-only\n21|//     collection was never going to be verified. Counting it as a miss blames the tool\n22|//     for a language it does not claim.\n23|//  4. UNKNOWN SCOPE ≠ EVERYTHING IN 
…[2201 more chars cut]
```

### tool result: read_file
```
{"content": "1|// A COLLECTION EXISTING IS NOT A COLLECTION COVERING ANYTHING.\n2|//\n3|// ⛔ FOUND BY RUNNING THE FIRST CODE-INTEL COLLECTION THIS REPO HAS EVER HAD. `graph_health` had\n4|// been naming \"no code-intel collection\" as its top next action for the life of the repo, so I ran\n5|// one — scoped to three files, to see whether it worked at all. It did. And then:\n6|//\n7|//     the response said        filesProcessed 3 · filesTotal 3      -> reads as 100%\n8|//     the stored row said      status ok, mode null                 -> no scope recorded at all\n9|//     graph_health then said   nextActions: []                      -> its ONLY code-intel\n10|//                                                                       warning went silent\n11|//\n12|// `filesTotal` was the SCOPE's denominator, not the repo's. 3 of 3 is complete. 3 of 484 is 0.6%.\n13|// Same defect as every other denominator this repo has shipped: a ratio over the population the\n14|// code happened to look at rather than the population the claim is about.\n15|//\n16|// ⚠ AND `nextActions: []` IS DOCUMENTED AS MEANING A HEALTHY REPO — \"EMPTY on a healthy repo,\n17|// which is what makes a populated list mean something\". So a 0.6% collection did not merely fail\n18|// to warn; it actively asserted health.\n19|import { describe, it, expect, afterEach } from 'vitest';\n20|import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';\n21|import { tmpdir } from 'node:os';\n22|import { join } fr
…[17372 more chars cut]
```

### tool result: read_file
```
{"content": "1|import { describe, it, expect } from 'vitest';\n2|import fs from 'node:fs';\n3|import os from 'node:os';\n4|import path from 'node:path';\n5|import { mkdirSync } from 'node:fs';\n6|import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';\n7|import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';\n8|import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';\n9|\n10|function setupRepo() {\n11|  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-h-ci-'));\n12|  const graphDir = path.join(dir, '.aify-graph');\n13|  mkdirSync(graphDir, { recursive: true });\n14|  const dbPath = path.join(graphDir, 'graph.sqlite');\n15|  const db = openDb(dbPath);\n16|  db.close();\n17|  return { dir, graphDir, dbPath };\n18|}\n19|\n20|describe('graph_health.codeIntel', () => {\n21|  it('reports codeIntel.available=false when no collection exists', async () => {\n22|    const { dir } = setupRepo();\n23|    const result = await graphHealth({ repoRoot: dir });\n24|    expect(result.codeIntel.available).toBe(false);\n25|    expect(result.codeIntel.reason).toBe('no_collection');\n26|  });\n27|\n28|  it('reports codeIntel.available=true after a collection import', async () => {\n29|    const { dir, dbPath } = setupRepo();\n30|    const tmp = path.join(os.tmpdir(), `apg-h-ci-${Date.now()}.json`);\n31|    fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));\n32|    const db =
…[466 more chars cut]
```

### tool result: search_files
```
{"total_count": 8, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "mcp\\stdio\\query\\coverage-denominator.js\n  41: export function computeCoverage(langScopeRows = [], verified = 0) {\nmcp\\stdio\\query\\verbs\\health.js\n  293:   } else if (s.codeIntel?.available && s.codeIntel.lspVerifiedEdges === 0) {\n  302:     // 484. Afterwards `available` was true and `lspVerifiedEdges` was 68, so BOTH existing\n  687:       // ⭐ THE COLLECTION COMES FROM THE AUTHORITY CAPTURE, not a fresh open. lspVerifiedEdges and\n  1424:         codeIntel.lspVerifiedEdges = verified;\n  1545:         codeIntel.lspCallsVerifiable = verifiable;\n  1570:         const verifiedPct = computeCoverage(langScopeRows, verified).pct;\n  1845:     compilerVerifiedEdges: codeIntel?.lspVerifiedEdges ?? 0,"}
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: mcp/stdio/query/coverage-denominator.js\n@@\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        CALLS counts and LSP_VERIFIED CALLS counts per (language, scope) bucket.\n@@\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n@@\n-  const verifiable = inScopeRows\n-    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))\n-    .reduce((a, r) => a + r.c, 0);\n+  const verifiableRows = inScopeRows.filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang));\n+  const verifiable = verifiableRows.reduce((a, r) => a + r.c, 0);\n+  // Filter BOTH halves of the ratio by the same scope and language predicates.\n+  // The graph-wide verified-edge total also includes non-CALLS relations and\n+  // excluded files/languages; it is not a coverage numerator.\n+  const verified = verifiableRows.reduce((a, r) => a + (r.verified ?? 0), 0);\n*** Update File: mcp/stdio/query/verbs/health.js\n@@\n-                  COUNT(*) AS c\n+                  COUNT(*) AS c,\n+                  SUM(CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 1 ELSE 0 END) AS verified\n@@\n-          acc.set(key, { lang: r.l
…[1144 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n@@ -28,9 +28,8 @@\n export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);\n \n /**\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        CALLS counts and LSP_VERIFIED CALLS counts per (language, scope) bucket.\n  * @returns {{\n  *   verifiable: number, verified: number, pct: number,\n  *   denominator: string,\n@@ -38,13 +37,16 @@\n  *   unverifiable: Array<{reason: string, lang: string, count: number}>\n  * }}\n  */\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n   const outOfScopeRows = langScopeRows.filter((r) => r.inScope === false);\n   const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);\n \n-  const verifiable = inScopeRows\n-    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))\n-    .reduce((a, r) => a + r.c, 0);\n+  const verifiableRows = inScopeRows.filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang));\n+  const verifiable = verifiableRow
…[4785 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: tests/unit/query/coverage-denominator.test.js\n@@\n-      { lang: 'cpp', c: 100, inScope: true },\n+      { lang: 'cpp', c: 100, verified: 100, inScope: true },\n@@\n-    const r = computeCoverage(rows, 100);\n+    const r = computeCoverage(rows);\n@@\n-      { lang: 'cpp', c: 50, inScope: true },\n-      { lang: 'cpp', c: 950, inScope: false },\n+      { lang: 'cpp', c: 50, verified: 50, inScope: true },\n+      { lang: 'cpp', c: 950, verified: 950, inScope: false },\n@@\n-    const r = computeCoverage(rows, 50);\n+    const r = computeCoverage(rows);\n@@\n-    const inScopeOnly = computeCoverage([{ lang: 'cpp', c: 10, inScope: true }], 10);\n+    const inScopeOnly = computeCoverage([{ lang: 'cpp', c: 10, verified: 10, inScope: true }]);\n@@\n-      { lang: 'cpp', c: 10, inScope: true },\n-      { lang: 'cpp', c: 10_000, inScope: false },\n-    ], 10);\n+      { lang: 'cpp', c: 10, verified: 10, inScope: true },\n+      { lang: 'cpp', c: 10_000, verified: 10_000, inScope: false },\n+    ]);\n@@\n-      { lang: 'cpp', c: 10, inScope: true },\n+      { lang: 'cpp', c: 10, verified: 10, inScope: true },\n@@\n-    ], 10);\n+    ]);\n@@\n-    expect(computeCoverage([], 0).denominator).toBe('verifiable_and_in_scope_calls');\n+    expect(computeCoverage([]).denominator).toBe('verifiable_and_in_scope_calls');\n@@\n-    const r = computeCoverage([{ lang: 'javascript', c: 10, inScope: true }], 0);\n+    const r = compute
…[1378 more chars cut]
```

### tool result: patch
```
{"error": "No shell found. Hermes needs bash (Git for Windows on Windows). Run `hermes pm install` or reinstall the bundle."}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/coverage-denominator.test.js"
}
```

### tool result: read_file
```
{"content": "1|// THE DENOMINATOR DECIDES WHETHER A COVERAGE NUMBER MEANS ANYTHING.\n2|//\n3|// Dividing verified edges by EVERY CALLS edge reported 12% on a repo where every\n4|// verifiable edge had in fact been verified. That reads as a coverage failure and was an\n5|// accounting one — and the field test checked the 833/1599 arithmetic against this exact\n6|// field, which makes it one of the few they confirmed they actually use.\n7|//\n8|// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.\n9|//\n10|// The previous version was eight regexes over health.js: `verified / verifiable`,\n11|// `verifiable_and_in_scope_calls`, `lspOutOfScopeCalls`, `LSP_VERIFIABLE_LANGUAGES`, and\n12|// so on. Every one asserts SPELLING. None could fail on a wrong number — and a wrong\n13|// number is the entire failure mode of a coverage statistic.\n14|//\n15|// The computation was inline in health.js, which is why it had never been tested by\n16|// running it. It now lives in `query/coverage-denominator.js` and this calls it with rows\n17|// and compares integers.\n18|import { describe, it, expect } from 'vitest';\n19|import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../../../mcp/stdio/query/coverage-denominator.js';\n20|\n21|describe('lsp coverage denominator', () => {\n22|  it('★★ divides by the VERIFIABLE subset, not by every CALLS edge', () => {\n23|    // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 JS edges\n24|    // no backend here can verify. The honest a
…[4035 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: tests/unit/query/coverage-denominator.test.js\n@@\n-      { lang: 'cpp', c: 100, inScope: true },\n+      { lang: 'cpp', c: 100, verified: 100, inScope: true },\n@@\n-    const r = computeCoverage(rows, 100);\n+    const r = computeCoverage(rows);\n@@\n-      { lang: 'cpp', c: 50, inScope: true },\n-      { lang: 'cpp', c: 950, inScope: false },\n+      { lang: 'cpp', c: 50, verified: 50, inScope: true },\n+      { lang: 'cpp', c: 950, verified: 950, inScope: false },\n@@\n-    const r = computeCoverage(rows, 50);\n+    const r = computeCoverage(rows);\n@@\n-    const inScopeOnly = computeCoverage([{ lang: 'cpp', c: 10, inScope: true }], 10);\n+    const inScopeOnly = computeCoverage([{ lang: 'cpp', c: 10, verified: 10, inScope: true }]);\n@@\n-      { lang: 'cpp', c: 10, inScope: true },\n-      { lang: 'cpp', c: 10_000, inScope: false },\n-    ], 10);\n+      { lang: 'cpp', c: 10, verified: 10, inScope: true },\n+      { lang: 'cpp', c: 10_000, verified: 10_000, inScope: false },\n+    ]);\n@@\n-      { lang: 'cpp', c: 10, inScope: true },\n+      { lang: 'cpp', c: 10, verified: 10, inScope: true },\n@@\n-    ], 10);\n+    ]);\n@@\n-    expect(computeCoverage([], 0).denominator).toBe('verifiable_and_in_scope_calls');\n+    expect(computeCoverage([]).denominator).toBe('verifiable_and_in_scope_calls');\n@@\n-    const r = computeCoverage([{ lang: 'javascript', c: 10, inScope: true }], 0);\n+    const r = compute
…[1073 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\coverage-denominator.test.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\coverage-denominator.test.js\n@@ -23,10 +23,10 @@\n     // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 JS edges\n     // no backend here can verify. The honest answer is 100%; dividing by 800 gives 12%.\n     const rows = [\n-      { lang: 'cpp', c: 100, inScope: true },\n+      { lang: 'cpp', c: 100, verified: 100, inScope: true },\n       { lang: 'javascript', c: 700, inScope: true },\n     ];\n-    const r = computeCoverage(rows, 100);\n+    const r = computeCoverage(rows);\n \n     expect(r.verifiable, 'JS edges are not verifiable by this backend').toBe(100);\n     expect(r.pct, 'every verifiable edge was verified — that is 100%, not 12%').toBe(100);\n@@ -35,10 +35,10 @@\n   it('★★ out-of-scope edges never enter the denominator', () => {\n     // Attack nine: an edge outside the tracked corpus is not verification debt.\n     const rows = [\n-      { lang: 'cpp', c: 50, inScope: true },\n-      { lang: 'cpp', c: 950, inScope: false },\n+      { lang: 'cpp', c: 50, verified: 50, inScope: true },\n+      { lang: 'cpp', c: 950, verified: 950, inScope: false },\n     ];\n-    const r = computeCoverage(rows, 50);\n+    const r = computeCoverage(rows);\n \n     expect(r.verifiable).toBe(50);\n     expect(r.outOfScope).toBe(950);\n@@ -50,11 +
…[3889 more chars cut]
```

### tool call: write_file
```
{
 "path": "tests/unit/query/health-call-coverage.test.js",
 "content": "import { describe, it, expect, afterEach } from 'vitest';\nimport { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport { execFileSync } from 'node:child_process';\nimport { openDb } from '../../../mcp/stdio/storage/db.js';\nimport { ensureCodeIntelCollectionsTable } from '../../../mcp/stdio/storage/schema.js';\nimport { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';\n\nlet repo;\nafterEach(() => {\n  if (repo) rmSync(repo, { recursive: true, force: true });\n  repo = undefined;\n});\n\nfunction fixture({ calls = 19, verifiedCalls = 19, references = 930, excludedCalls = 0 } = {}) {\n  repo = mkdtempSync(join(tmpdir(), 'apg-call-cov-'));\n  mkdirSync(join(repo, '.aify-graph'));\n  execFileSync('git', ['init', '-q', repo]);\n  for (const file of ['a.cpp', 'b.cpp', 'a.js']) writeFileSync(join(repo, file), '// fixture\\n');\n  execFileSync('git', ['-C', repo, 'add', 'a.cpp', 'b.cpp', 'a.js']);\n  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture']);\n  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();\n  writeFileSync(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({\n    commit, indexedAt: new Date().toISOString(), schemaVersion: 4,\n    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: 
…[3355 more chars cut]
```

### tool result: write_file
```
{"bytes_written": 4681, "dirs_created": true, "verified": true, "lint": {"status": "ok", "output": ""}, "resolved_path": "<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\health-call-coverage.test.js", "files_modified": ["<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\health-call-coverage.test.js"]}
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-collection-coverage.test.js",
 "timeout": 180
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.7.1 test\n> node ./scripts/run-vitest.mjs tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-collection-coverage.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ✓ tests/unit/query/health-collection-coverage.test.js (7 tests) 45742ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ a SCOPED collection warns, naming both real numbers  3339ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ UNKNOWN coverage warns too — three states, not two  2042ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ a COMPLETE collection is silent — or the warning is permanent and worthless  6184ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ files_in_scope is stored SEPARATELY from the eligible population  8330ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★★ the record count is not offered as the compiler-verified surface  11337ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★★ the verified number counts FILES, not edges  10010ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★ POSITIVE CONTROL — the count moves with the population  4499ms\n ✓ tests/unit/query/coverage-denominator.test.js (9 tests) 4ms\n ✓ tests/unit/query/health-call-coverage.test.js (3 tests) 22200ms\n   ✓ graph_health CALLS co
…[618 more chars cut]
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query",
 "timeout": 600
}
```

### tool call: terminal
```
{
 "command": "git diff --check && git diff --stat && git diff -- mcp/stdio/query/verbs/health.js mcp/stdio/query/coverage-denominator.js && git status --short"
}
```

### tool result: terminal
```
Error executing tool 'terminal': timed out after 420.0s
```

### tool result: terminal
```
{"output": "mcp/stdio/query/coverage-denominator.js       | 16 +++++++++-------\n mcp/stdio/query/verbs/health.js               | 19 +++++++++++++------\n tests/unit/query/coverage-denominator.test.js | 47 ++++++++++++++++++++++++++++++++++-------------\n 3 files changed, 56 insertions(+), 26 deletions(-)\ndiff --git a/mcp/stdio/query/coverage-denominator.js b/mcp/stdio/query/coverage-denominator.js\nindex 759ef4b..cd91180 100644\n--- a/mcp/stdio/query/coverage-denominator.js\n+++ b/mcp/stdio/query/coverage-denominator.js\n@@ -28,9 +28,8 @@\n export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);\n \n /**\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        CALLS counts and LSP_VERIFIED CALLS counts per (language, scope) bucket.\n  * @returns {{\n  *   verifiable: number, verified: number, pct: number,\n  *   denominator: string,\n@@ -38,13 +37,16 @@ export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', '\n  *   unverifiable: Array<{reason: string, lang: string, count: number}>\n  * }}\n  */\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n   const outOfScopeRows = langSco
…[4727 more chars cut]
```

### tool call: terminal
```
{
 "command": "ps -ef | python -c \"import sys; print(''.join(l for l in sys.stdin if 'node' in l or 'vitest' in l))\"",
 "timeout": 30
}
```

### tool result: terminal
```
{"output": "Traceback (most recent call last):\r\n  File \"<string>\", line 1, in <module>\r\n    import sys; print(''.join(l for l in sys.stdin if 'node' in l or 'vitest' in l))\r\n                      ~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\r\n  File \"<string>\", line 1, in <genexpr>\r\n    import sys; print(''.join(l for l in sys.stdin if 'node' in l or 'vitest' in l))\r\n                                         ^^^^^^^^^\r\n  File \"<frozen codecs>\", line 325, in decode\r\nUnicodeDecodeError: 'utf-8' codec can't decode byte 0xf1 in position 4032: invalid continuation byte", "exit_code": 1, "error": null}
```

### tool call: terminal
```
{
 "command": "ps -ef | python -c \"import sys; print('\\n'.join(l for l in sys.stdin.buffer.read().decode('utf-8', errors='replace').splitlines() if 'node' in l or 'vitest' in l))\"",
 "timeout": 30
}
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: mcp/stdio/query/verbs/health.js\n@@\n-        // Languages an LSP backend in this server can actually verify. Anything\n-        // else is unverifiable by construction, not unverified by omission.\n-\n         // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,\n*** End Patch"
}
```

### tool result: terminal
```
{"output": "Administ 1938551 1938426 cons24   05:13:46 C:\\nvm4w\\nodejs\\node.exe C:\\Users\\Administrator\\.aify-comms\\mcp\\stdio/hermes-managed-host\r\nAdminist 3954701 3954522 ?          Sep 30 C:\\nvm4w\\nodejs\\node.exe -e \"const net=require(\\\"net\\\");net.createServer(()=>{}).listen(N\r\nAdminist 1854834 1854728 cons16   02:44:27 C:\\nvm4w\\nodejs\\node.exe C:\\Users\\Administrator\\.aify-comms\\mcp\\stdio/hermes-managed-host\r\nAdminist 1983191 1981631 cons26   06:29:41 C:\\nvm4w\\nodejs\\node.exe C:\\Users\\Administrator\\.aify-comms\\mcp\\stdio/hermes-managed-host\r\nAdminist 1999382 1997597 cons32   06:57:33 C:\\nvm4w\\nodejs\\node.exe C:\\Users\\Administrator\\.aify-comms\\mcp\\stdio/hermes-managed-host\r\nAdminist 2082768       1 ?        10:01:37 bash -c (node run-arm.mjs claude A T2 > batch3-claude-A-T2.log 2>&1; echo EXIT=$? >> batc\r\nAdminist  239585  239580 ?          Sep 26 bash /c/nvm4w/nodejs/npm test \r\nAdminist  152942       1 cons17     Sep 25 C:\\nvm4w\\nodejs\\node.exe C:\\Users\\Administrator\\AppData\\Local\\Temp\\aify-checkpoint-85LsQK\r\nAdminist 2098937 2098895 ?        10:23:38 C:\\nvm4w\\nodejs\\node.exe --test --test-concurrency=1 tests/a-launcher-can-serve-another-s\r\nAdminist  234240  234232 ?          Sep 26 C:\\nvm4w\\nodejs\\node.exe C:\\nvm4w\\nodejs/node_modules/npm/bin/npm-cli.js test annels ser�\r\nAdminist 2099684 2099647 ?        10:25:17 C:\\nvm4w\\nodejs\\node.exe docs/evidence/mutate.mjs docs/evidence/bridge-instructions-
…[1659 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js\n@@ -1517,9 +1517,6 @@\n         const langScopeRows = [...byLang.values()];\n         const outOfScope = langScopeRows.filter((r) => r.inScope === false);\n         const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);\n-        // Languages an LSP backend in this server can actually verify. Anything\n-        // else is unverifiable by construction, not unverified by omission.\n-\n         // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,\n         // and — the point of attack nine — never MIGRATE into it when a backend\n         // for their language lands.\n", "files_modified": ["<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js"], "lint": {"<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js": {"status": "ok", "output": ""}}, "resolved_path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js"}
```

### tool call: terminal
```
{
 "command": "git diff --check && npm test -- tests/unit/query/health-call-coverage.test.js tests/unit/query/coverage-denominator.test.js tests/unit/query/health-code-intel.test.js",
 "timeout": 180
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.7.1 test\n> node ./scripts/run-vitest.mjs tests/unit/query/health-call-coverage.test.js tests/unit/query/coverage-denominator.test.js tests/unit/query/health-code-intel.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ✓ tests/unit/query/health-call-coverage.test.js (3 tests) 3041ms\n   ✓ graph_health CALLS coverage uses matching populations > 949 verified edges over 19 verifiable calls is not 4995% coverage  1009ms\n   ✓ graph_health CALLS coverage uses matching populations > excludes verified out-of-scope and non-verifiable calls from partial coverage  1477ms\n   ✓ graph_health CALLS coverage uses matching populations > reports zero with no eligible calls even when verified edges exist  554ms\nfatal: not a git repository (or any of the parent directories): .git\nfatal: not a git repository (or any of the parent directories): .git\nfatal: not a git repository (or any of the parent directories): .git\nfatal: not a git repository (or any of the parent directories): .git\n ✓ tests/unit/query/health-code-intel.test.js (2 tests) 460ms\n ✓ tests/unit/query/coverage-denominator.test.js (9 tests) 4ms\n\n Test Files  3 passed (3)\n      Tests  14 passed (14)\n   Start at  10:27:56\n   Duration  9.49s (transform 595ms, setup 0ms, collect 4.26s, tests 3.50s, environment 0ms, prepare 510ms)", "exit_code": 0, "error": null}
```

### assistant
Fixed the population mismatch.

Cause: health.js counted all LSP_VERIFIED edges as the numerator, but divided by only verifiable, in-scope CALLS. Non-call relations, out-of-scope files, and unsupported languages inflated the percentage.

The fix counts verified CALLS within the same language/scope buckets as the denominator—no percentage clamping. lspVerifiedEdges remains the all-edge total; the new lspVerifiedVerifiableInScopeCalls exposes the actual numerator. Both percentage fields use the corrected calculation.

Tests cover:
  949 verified edges with 19 eligible, verified calls → 100%, not 4995%.
  Partial coverage with excluded verified calls → 26%, not a clamped 100%.
  Zero eligible calls → 0%.

Verification: regression, helper, and related health tests passed. git diff --check passed. The broader query suite timed out, so its result is unverified.

### FINAL
Fixed the population mismatch.

Cause: health.js counted all LSP_VERIFIED edges as the numerator, but divided by only verifiable, in-scope CALLS. Non-call relations, out-of-scope files, and unsupported languages inflated the percentage.

The fix counts verified CALLS within the same language/scope buckets as the denominator—no percentage clamping. lspVerifiedEdges remains the all-edge total; the new lspVerifiedVerifiableInScopeCalls exposes the actual numerator. Both percentage fields use the corrected calculation.

Tests cover:
  949 verified edges with 19 eligible, verified calls → 100%, not 4995%.
  Partial coverage with excluded verified calls → 26%, not a clamped 100%.
  Zero eligible calls → 0%.

Verification: regression, helper, and related health tests passed. git diff --check passed. The broader query suite timed out, so its result is unverified.
