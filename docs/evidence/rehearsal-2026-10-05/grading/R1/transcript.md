# R1 — runtime: hermes, task: T2

### tool call: terminal
```
{
 "command": "git status --short && git branch --show-current"
}
```

### tool call: search_files
```
{
 "pattern": "lspVerifiedPctOfVerifiableInScopeCalls|verifiableInScopeCalls",
 "path": ".",
 "context": 4
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
{"total_count": 27, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": ".\\mcp\\stdio\\query\\verbs\\health.js\n  1567:         // which is why the only guard on it was eight regexes over this file — every one\n  1568:         // asserting spelling, none able to fail on a wrong number, on a statistic whose\n  1569:         // entire failure mode IS a wrong number.\n  1570:         const verifiedPct = computeCoverage(langScopeRows, verified).pct;\n  1571:         codeIntel.lspVerifiedPctOfVerifiableInScopeCalls = verifiedPct;\n  1572:         codeIntel.lspVerifiedPctOfCalls = verifiedPct;\n  1573:         codeIntel.lspVerifiedPctDenominator = trackedFiles == null\n  1574:           ? 'verifiable_calls (SCOPE UNKNOWN — git ls-files unreadable, so out-of-scope edges could not be excluded)'\n  1575:           : 'verifiable_and_in_scope_calls';\n.\\docs\\superpowers\\specs\\2026-08-10-contradiction-surface-design.md\n  164: **⛔ The line that must not be crossed.** The value-DEPENDENT sentence stays\n  165: inline: *\"833 of 833 are DEGRADED — do not read as dead code\"* is about **this\n  166: repo's numbers**. Only the value-INDEPENDENT paragraph is externalised. Get that\n  167: boundary wrong and we rebuild the number-outlives-its-qualifier defect that\n  168: `lspVerifiedPctOfVerifiableInScopeCalls` exists to fix.\n  169: \n  170: ## ★ Part 1c — the gap in my delete-rule: red
…[635 more chars cut]
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
 "offset": 1390,
 "limit": 240
}
```

### tool call: search_files
```
{
 "pattern": "computeCoverage|langScopeRows|lspVerified",
 "path": ".",
 "file_glob": "*.{js,mjs}",
 "context": 2,
 "limit": 90
}
```

### tool call: search_files
```
{
 "pattern": "*coverage*",
 "target": "files",
 "path": "."
}
```

### tool call: read_file
```
{
 "path": "mcp/stdio/query/verbs/health.js",
 "limit": 100
}
```

### tool result: read_file
```
{"content": "1390|    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;\n1391|  };\n1392|  // AGE IS NOT STALENESS for the curated overlays. `functionality.json` is\n1393|  // hand-maintained: a correct, stable one would emit a ⚠ forever, and a warning\n1394|  // that can never be resolved trains agents to ignore ⚠ lines on the one surface\n1395|  // where they must stay load-bearing. So ages are REPORTED structurally, and a\n1396|  // verdict fires only on a real, actionable signal — broken anchors (which\n1397|  // `overlay.broken` already measures) or, for tasks, links that resolve to\n1398|  // nothing. Drift after renames is the `graph-anchor-drift` skill's job.\n1399|  try {\n1400|    for (const [name, file] of [['functionality', 'functionality.json'], ['tasks', 'tasks.json']]) {\n1401|      const p = join(repoRoot, '.aify-graph', file);\n1402|      if (!existsSync(p)) continue;\n1403|      artifactAges[name] = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);\n1404|    }\n1405|  } catch { /* best-effort */ }\n1406|  // The code-intel collection IS age-sensitive in a way the overlays are not: it\n1407|  // is a snapshot of a specific commit's index, and `graph_index` never refreshes\n1408|  // it. But the honest trigger is commit drift, not the calendar — a collection\n1409|  // whose indexedCommit still equals HEAD is current no matter how old it is.\n1410|  const collectedDays = ageInDays(codeIntel?.collectedAt);\n1411|  if (coll
…[15512 more chars cut]
```

### tool result: search_files
```
{"total_count": 248, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": ".\\mcp\\stdio\\brief\\render.js\n  9: // outside the render block were called from inside it — and moving the renderers then would\n  10: // have created a CIRCULAR IMPORT, because generator.js imports render.js to call these, while\n  11: // these needed `computeCoverage` from generator.js. brief/artifacts.js exists to break that,\n  12: // and it had to land first.\n  13: //\n  23: \n  24: import { join } from 'node:path';\n  25: import { computeCoverage, openTasksByFeature, completedTaskCountsByFeature, openTasksWithoutFeatures } from './artifacts.js';\n  26: import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs, taskLinkStrength, taskLinkStrengthCounts } from '../overlay/quality.js';\n  27: import { documentEvidence, buildDocumentView } from './document-view.js';\n  833:           //   🔴 risk:    broken anchors OR severe task overhang (>20)\n  834:           // Pure synthesis from the fields above — no new data.\n  835:           coverage: computeCoverage({\n  836:             resolved: v.totalResolved,\n  837:             declared: v.totalDeclared,\n.\\mcp\\stdio\\brief\\generator.js\n  18: // Non-graph brief inputs live in artifacts.js so the renderers can be split out without a\n  19: // cycle — see that file's header for why this slice had to come first.\n  2
…[5441 more chars cut]
```

### tool result: search_files
```
{"total_count": 20, "files": [".\\tests\\unit\\query\\coverage-denominator.test.js", ".\\mcp\\stdio\\query\\coverage-denominator.js", ".\\scripts\\probe-coverage-floor-vs-answer.mjs", ".\\scripts\\m4-routing-coverage.mjs", ".\\tests\\unit\\query\\structural-coverage-field.test.js", ".\\tests\\unit\\query\\overlay-coverage-verdict.test.js", ".\\tests\\unit\\query\\health-collection-coverage.test.js", ".\\scripts\\c1-site-coverage-probe.mjs", ".\\docs\\2026-08-26-framework-coverage-proven.md", ".\\docs\\2026-08-22-collection-coverage-recurrence.md", ".\\tests\\unit\\code-intel\\coverage-ratio-is-a-floor.test.js", ".\\tests\\unit\\code-intel\\coverage-first-party-gate.test.js", ".\\tests\\unit\\code-intel\\compile-db-coverage.test.js", ".\\tests\\unit\\brief\\coverage-tier.test.js", ".\\mcp\\stdio\\code-intel\\coverage.js", ".\\docs\\evidence\\m3-freshness\\FINDING-fingerprint-coverage-by-node-type.md", ".\\docs\\evidence\\process\\PREREGISTRATION-disclosure-coverage-derives.md", ".\\docs\\evidence\\m2-contract\\coverage-floor-vs-answer.txt", ".\\docs\\evidence\\m2-contract\\FINDING-the-coverage-warning-counted-records-and-claimed-edges.md", "./docs/evidence/m2-construct-coverage"]}
```

### tool result: read_file
```
{"content": "1|// graph_health — single trustable answer to \"is the graph usable right now?\"\n2|//\n3|// Echoes PM feedback 2026-04-21: \"To answer 'is the graph usable right now?'\n4|// an agent has to call graph_index, read brief.plan.md, parse the TRUST line,\n5|// cross-reference. All three can disagree.\" This verb aggregates those signals\n6|// into one response so a session can check health in a single call.\n7|//\n8|// Synthesis-only. No new data — just a coherent view of what graph_status +\n9|// the overlay validator + the brief's trust logic already expose.\n10|\n11|import { join, dirname } from 'node:path';\n12|import { graphCapabilities } from '../graph-capabilities.mjs';\n13|import { getBackend } from '../../code-intel/backends.js';\n14|import { existsSync, readFileSync, statSync } from 'node:fs';\n15|import { fileURLToPath } from 'node:url';\n16|import { execFileSync } from 'node:child_process';\n17|\n18|// HOW MUCH OF THE COLLECTION'S EVIDENCE HAS ALREADY DECAYED.\n19|//\n20|// The salvage gate drops verified evidence per FILE: a covered file that changed since the\n21|// collection loses it on the next rebuild. So the honest magnitude is \"how many of the files this\n22|// collection covered have changed\", not \"how many commits have passed\" — 121 commits that touch no\n23|// covered file destroy nothing, and one that rewrites forty covered files destroys a great deal.\n24|//\n25|// Returns nulls rather than zeros when it cannot tell. A zero here would re
…[4699 more chars cut]
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
 "path": "tests/unit/query/coverage-denominator.test.js"
}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/health-collection-coverage.test.js"
}
```

### tool call: search_files
```
{
 "path": "tests/unit/query",
 "pattern": "*health*",
 "target": "files"
}
```

### tool call: read_file
```
{
 "path": "mcp/stdio/query/verbs/health.js",
 "offset": 1630,
 "limit": 70
}
```

### tool result: read_file
```
{"content": "1|// ★ THE DENOMINATOR, EXTRACTED SO IT CAN BE RUN INSTEAD OF GREPPED.\n2|//\n3|// `lspVerifiedPct` was computed inline in health.js, so the only way to guard it was to\n4|// assert regexes over that file — eight of them, all spelling. the field test rates this\n5|// denominator among the fields they ACTUALLY USED (they checked the 833/1599 arithmetic\n6|// against it), which makes a test that cannot fail on a wrong number the worst kind to\n7|// have here.\n8|//\n9|// Pulling it out is a small refactor with a large consequence: the invariant becomes\n10|// checkable by calling it with rows and comparing integers.\n11|//\n12|// THE INVARIANTS, each of which was a real defect at some point:\n13|//\n14|//  1. DIVIDE BY THE VERIFIABLE SUBSET, NOT BY EVERY CALLS EDGE. Dividing by all calls\n15|//     reported 12% on a repo where every verifiable edge was verified — a number that\n16|//     read as a coverage failure and was an accounting one.\n17|//  2. OUT-OF-SCOPE EDGES NEVER ENTER, AND NEVER MIGRATE IN. An edge outside the tracked\n18|//     corpus is not verifiable debt; if a backend for its language later lands, it must\n19|//     not silently appear in the denominator and drop the percentage.\n20|//  3. UNVERIFIABLE-BY-CONSTRUCTION IS NOT UNVERIFIED-BY-OMISSION. A JS edge in a C++-only\n21|//     collection was never going to be verified. Counting it as a miss blames the tool\n22|//     for a language it does not claim.\n23|//  4. UNKNOWN SCOPE ≠ EVERYTHING IN 
…[2201 more chars cut]
```

### tool result: read_file
```
{"content": "1|// THE DENOMINATOR DECIDES WHETHER A COVERAGE NUMBER MEANS ANYTHING.\n2|//\n3|// Dividing verified edges by EVERY CALLS edge reported 12% on a repo where every\n4|// verifiable edge had in fact been verified. That reads as a coverage failure and was an\n5|// accounting one — and the field test checked the 833/1599 arithmetic against this exact\n6|// field, which makes it one of the few they confirmed they actually use.\n7|//\n8|// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.\n9|//\n10|// The previous version was eight regexes over health.js: `verified / verifiable`,\n11|// `verifiable_and_in_scope_calls`, `lspOutOfScopeCalls`, `LSP_VERIFIABLE_LANGUAGES`, and\n12|// so on. Every one asserts SPELLING. None could fail on a wrong number — and a wrong\n13|// number is the entire failure mode of a coverage statistic.\n14|//\n15|// The computation was inline in health.js, which is why it had never been tested by\n16|// running it. It now lives in `query/coverage-denominator.js` and this calls it with rows\n17|// and compares integers.\n18|import { describe, it, expect } from 'vitest';\n19|import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../../../mcp/stdio/query/coverage-denominator.js';\n20|\n21|describe('lsp coverage denominator', () => {\n22|  it('★★ divides by the VERIFIABLE subset, not by every CALLS edge', () => {\n23|    // The original defect, as arithmetic. 100 C++ edges all verified, plus 700 JS edges\n24|    // no backend here can verify. The honest a
…[3841 more chars cut]
```

### tool result: read_file
```
{"content": "1|// A COLLECTION EXISTING IS NOT A COLLECTION COVERING ANYTHING.\n2|//\n3|// ⛔ FOUND BY RUNNING THE FIRST CODE-INTEL COLLECTION THIS REPO HAS EVER HAD. `graph_health` had\n4|// been naming \"no code-intel collection\" as its top next action for the life of the repo, so I ran\n5|// one — scoped to three files, to see whether it worked at all. It did. And then:\n6|//\n7|//     the response said        filesProcessed 3 · filesTotal 3      -> reads as 100%\n8|//     the stored row said      status ok, mode null                 -> no scope recorded at all\n9|//     graph_health then said   nextActions: []                      -> its ONLY code-intel\n10|//                                                                       warning went silent\n11|//\n12|// `filesTotal` was the SCOPE's denominator, not the repo's. 3 of 3 is complete. 3 of 484 is 0.6%.\n13|// Same defect as every other denominator this repo has shipped: a ratio over the population the\n14|// code happened to look at rather than the population the claim is about.\n15|//\n16|// ⚠ AND `nextActions: []` IS DOCUMENTED AS MEANING A HEALTHY REPO — \"EMPTY on a healthy repo,\n17|// which is what makes a populated list mean something\". So a 0.6% collection did not merely fail\n18|// to warn; it actively asserted health.\n19|import { describe, it, expect, afterEach } from 'vitest';\n20|import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';\n21|import { tmpdir } from 'node:os';\n22|import { join } fr
…[17372 more chars cut]
```

### tool result: search_files
```
{"total_count": 15, "files": ["tests/unit/query\\health.test.js", "tests/unit/query\\health-trust-basis-comes-from-the-capture.test.js", "tests/unit/query\\health-storage.test.js", "tests/unit/query\\health-stale-externals.test.js", "tests/unit/query\\health-response-bounded.test.js", "tests/unit/query\\health-reports-manifest-unusable.test.js", "tests/unit/query\\health-population-census.test.js", "tests/unit/query\\health-next-actions.test.js", "tests/unit/query\\health-index-incomplete.test.js", "tests/unit/query\\health-fragment-count-can-fail.test.js", "tests/unit/query\\health-dirty-noise.test.js", "tests/unit/query\\health-consequence-scope.test.js", "tests/unit/query\\health-collection-coverage.test.js", "tests/unit/query\\health-code-intel.test.js", "tests/unit/query\\health-brief-stale.test.js"]}
```

### tool result: read_file
```
{"content": "1630|            + 'This does NOT constrain the LIVE verbs: code_intel_references / code_intel_hierarchy query the language server directly and carry their own evidence block — '\n1631|            + 'trust THEIR evidence.exhaustive for a delete decision, not this line. '\n1632|            + 'A full reindex drops verified edges; run graph_collect_code_intel to restore the graph spine.');\n1633|        }\n1634|        // THE PERCENTAGE IS A FLOOR, AND IT MUST SAY SO IN THE RENDERED LINE.\n1635|        //\n1636|        // Symbols we DECLINED to query — identifier column unlocatable, or a hub\n1637|        // whose reference set hit the cap — sit in the denominator and can never\n1638|        // reach the numerator. Quoting the percentage alone turns \"not asked\" into\n1639|        // \"asked and found nothing\", which are different states and only one of\n1640|        // them is evidence about the code. This is the same half-truth as a\n1641|        // partial sample wearing the name of the whole, so the caveat travels with\n1642|        // the number rather than living in a chat log.\n1643|        // ★ A CAVEAT MUST BE COMPUTED FROM THE SAME SOURCE AS THE NUMBER IT\n1644|        //   QUALIFIES, OR IT CAN BE DELETED INDEPENDENTLY AND THE NUMBER KEEPS\n1645|        //   PRINTING.\n1646|        //\n1647|        // the field test watched this happen with a before-image (2026-07-31). An\n1648|        // empty collection row wiped the session stats, and:\n1649|        /
…[4220 more chars cut]
```

### tool call: search_files
```
{
 "path": "tests",
 "pattern": "computeCoverage\\(",
 "file_glob": "*.js",
 "limit": 70
}
```

### tool call: read_file
```
{
 "path": "tests/unit/query/health-code-intel.test.js",
 "limit": 170
}
```

### tool call: read_file
```
{
 "path": "scripts/run-vitest.mjs",
 "limit": 130
}
```

### tool result: search_files
```
{"total_count": 23, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "tests\\unit\\code-intel\\backends.test.js\n  48:     const c = computeCoverage({ language: 'python', projectRoot: '/x' });\n  56:     const c = computeCoverage({ language: 'typescript', projectRoot: dir });\n  62:     const c = computeCoverage({ language: 'typescript', projectRoot: dir });\n  69:     const c = computeCoverage({ language: 'cpp', projectRoot: dir });\n  80:     const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'src/a.ts' });\n  87:     const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'packages/other/b.ts' });\n  98:     const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'packages/app/src/x.ts' });\n  104:     const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'lib/deep/y.ts' });\n  109:     const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'src/a.ts' });\ntests\\unit\\brief\\coverage-tier.test.js\n  11:     const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 2, contractCount: 1 });\n  17:     const r = computeCoverage({ resolved: 2, declared: 4, taskCount: 0, contractCount: 1 });\n  24:     const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 22, contractCount: 1 });\n  30:     const r = computeCoverage({ resolved: 4, declared: 4, taskCou
…[898 more chars cut]
```

### tool result: read_file
```
{"content": "1|import { describe, it, expect } from 'vitest';\n2|import fs from 'node:fs';\n3|import os from 'node:os';\n4|import path from 'node:path';\n5|import { mkdirSync } from 'node:fs';\n6|import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';\n7|import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';\n8|import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';\n9|\n10|function setupRepo() {\n11|  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-h-ci-'));\n12|  const graphDir = path.join(dir, '.aify-graph');\n13|  mkdirSync(graphDir, { recursive: true });\n14|  const dbPath = path.join(graphDir, 'graph.sqlite');\n15|  const db = openDb(dbPath);\n16|  db.close();\n17|  return { dir, graphDir, dbPath };\n18|}\n19|\n20|describe('graph_health.codeIntel', () => {\n21|  it('reports codeIntel.available=false when no collection exists', async () => {\n22|    const { dir } = setupRepo();\n23|    const result = await graphHealth({ repoRoot: dir });\n24|    expect(result.codeIntel.available).toBe(false);\n25|    expect(result.codeIntel.reason).toBe('no_collection');\n26|  });\n27|\n28|  it('reports codeIntel.available=true after a collection import', async () => {\n29|    const { dir, dbPath } = setupRepo();\n30|    const tmp = path.join(os.tmpdir(), `apg-h-ci-${Date.now()}.json`);\n31|    fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));\n32|    const db =
…[466 more chars cut]
```

### tool result: read_file
```
{"content": "1|// Keep `npm test` consistent with MCP startup: if this checkout was last used\n2|// from another platform (Windows vs WSL), the preflight rebuilds better-sqlite3\n3|// once before Vitest boots.\n4|import '../mcp/stdio/preflight-native.js';\n5|import { startVitest } from 'vitest/node';\n6|\n7|const args = process.argv.slice(2);\n8|const watchIndex = args.indexOf('--watch');\n9|const mode = watchIndex >= 0 ? 'watch' : 'test';\n10|const filters = watchIndex >= 0\n11|  ? args.slice(0, watchIndex).concat(args.slice(watchIndex + 1))\n12|  : args;\n13|\n14|// ⛔ THIS RUNNER USED TO PASS `config: false` AND `pool: 'threads'`, WHICH DISCARDED\n15|// vitest.config.js ENTIRELY — the file `npm test` is supposed to be configured by.\n16|//\n17|// vitest.config.js pins two settings and explains at length why each is load-bearing:\n18|// `pool: 'forks'` (relative-reporoot.test.js calls process.chdir(), which THROWS in the\n19|// `threads` pool) and `fileParallelism: false` (real clangd/tsserver/pyright tests lose\n20|// races for CPU when run concurrently). Both were written INTO THE CONFIG while this\n21|// runner was already ignoring it, so `npm test` ran threads-parallel and failed 4 tests\n22|// that pass under `node node_modules/vitest/vitest.mjs`. Same tree, two runners, two\n23|// answers — and the documented command was the one that lied.\n24|//\n25|// ★ The config's own comment claims the requirement \"travels with the repo rather than\n26|// with my installed versio
…[903 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: mcp/stdio/query/coverage-denominator.js\n@@\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        one row per (language, scope) CALLS bucket, including its verified count.\n@@\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n@@\n-  const verifiable = inScopeRows\n-    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))\n-    .reduce((a, r) => a + r.c, 0);\n+  // Both sides must describe the same CALLS population. A global verified-edge\n+  // count also includes other relations, languages and out-of-scope files.\n+  const verifiableRows = inScopeRows.filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang));\n+  const verifiable = verifiableRows.reduce((a, r) => a + r.c, 0);\n+  const verified = verifiableRows.reduce((a, r) => a + (r.verified ?? 0), 0);\n*** Update File: mcp/stdio/query/verbs/health.js\n@@\n-                  COUNT(*) AS c\n+                  COUNT(*) AS c,\n+                  SUM(CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 1 ELSE 0 END) AS verified\n@@\n-          acc.set(key, { lang: r.lang, inScope, c: (acc.get(key)?.c ?? 0) + r.c });\n+          acc.
…[2710 more chars cut]
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n@@ -28,9 +28,8 @@\n export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);\n \n /**\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        one row per (language, scope) CALLS bucket, including its verified count.\n  * @returns {{\n  *   verifiable: number, verified: number, pct: number,\n  *   denominator: string,\n@@ -38,13 +37,15 @@\n  *   unverifiable: Array<{reason: string, lang: string, count: number}>\n  * }}\n  */\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n   const outOfScopeRows = langScopeRows.filter((r) => r.inScope === false);\n   const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);\n \n-  const verifiable = inScopeRows\n-    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))\n-    .reduce((a, r) => a + r.c, 0);\n+  // Both sides must describe the same CALLS population. A global verified-edge\n+  // count also includes other relations, l
…[9817 more chars cut]
```

### tool call: write_file
```
{
 "path": "tests/unit/query/health-call-coverage.test.js",
 "content": "import { afterEach, describe, expect, it } from 'vitest';\nimport { execFileSync } from 'node:child_process';\nimport { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nimport { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';\nimport { openDb } from '../../../mcp/stdio/storage/db.js';\nimport { ensureCodeIntelCollectionsTable } from '../../../mcp/stdio/storage/schema.js';\n\nlet repo;\nafterEach(() => {\n  if (repo) rmSync(repo, { recursive: true, force: true });\n  repo = undefined;\n});\n\nfunction setup(verifiedCalls) {\n  repo = mkdtempSync(join(tmpdir(), 'apg-health-calls-'));\n  mkdirSync(join(repo, '.aify-graph'));\n  mkdirSync(join(repo, 'src'));\n  for (const file of ['a.cpp', 'b.cpp', 'a.js']) writeFileSync(join(repo, 'src', file), '');\n  execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });\n  execFileSync('git', ['add', 'src'], { cwd: repo, stdio: 'ignore' });\n  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'],\n    { cwd: repo, stdio: 'ignore' });\n  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();\n  writeFileSync(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({\n    commit, indexedAt: new Date().toISOString(), schemaVersion: 4,\n    extractorVersion: '0.1.0', status: '
…[3372 more chars cut]
```

### tool result: write_file
```
{"bytes_written": 4706, "dirs_created": true, "verified": true, "lint": {"status": "ok", "output": ""}, "resolved_path": "<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\health-call-coverage.test.js", "files_modified": ["<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\health-call-coverage.test.js"]}
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-collection-coverage.test.js tests/unit/query/health-code-intel.test.js",
 "timeout": 180
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.7.1 test\n> node ./scripts/run-vitest.mjs tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-collection-coverage.test.js tests/unit/query/health-code-intel.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\n ✓ tests/unit/query/coverage-denominator.test.js (7 tests) 3ms\n ✓ tests/unit/query/health-collection-coverage.test.js (7 tests) 45047ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ a SCOPED collection warns, naming both real numbers  7052ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ UNKNOWN coverage warns too — three states, not two  6533ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ a COMPLETE collection is silent — or the warning is permanent and worthless  11955ms\n   ✓ health reports what a collection COVERS, not that one exists > ★★★ files_in_scope is stored SEPARATELY from the eligible population  4068ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★★ the record count is not offered as the compiler-verified surface  3542ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★★ the verified number counts FILES, not edges  8627ms\n   ✓ the coverage warning names the surface [lsp✓] actually covers > ★★ POSITIVE CONTROL — the count moves with the population  3269ms\nfatal: not a git repository (or any of the parent di
…[1580 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: mcp/stdio/query/verbs/health.js\n@@\n-        // Languages an LSP backend in this server can actually verify. Anything\n-        // else is unverifiable by construction, not unverified by omission.\n-\n         // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,\n*** Update File: tests/unit/query/coverage-denominator.test.js\n@@\n describe('lsp coverage denominator', () => {\n+  it('filters verified counts by the same scope and language as call counts', () => {\n+    const r = computeCoverage([\n+      { lang: 'cpp', c: 19, verified: 10, inScope: true },\n+      { lang: 'cpp', c: 300, verified: 300, inScope: false },\n+      { lang: 'javascript', c: 400, verified: 400, inScope: true },\n+    ]);\n+    expect(r.verifiable).toBe(19);\n+    expect(r.verified).toBe(10);\n+    expect(r.pct).toBe(53);\n+  });\n+\n+  it('aggregates supported languages without treating unverified buckets as verified', () => {\n+    const r = computeCoverage([\n+      { lang: 'cpp', c: 10, verified: 5, inScope: true },\n+      { lang: 'c', c: 10, verified: 10, inScope: true },\n+      { lang: 'hpp', c: 10, inScope: true },\n+    ]);\n+    expect(r.verifiable).toBe(30);\n+    expect(r.verified).toBe(15);\n+    expect(r.pct).toBe(50);\n+  });\n+\n*** End Patch"
}
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\health.js\n@@ -1517,9 +1517,6 @@\n         const langScopeRows = [...byLang.values()];\n         const outOfScope = langScopeRows.filter((r) => r.inScope === false);\n         const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);\n-        // Languages an LSP backend in this server can actually verify. Anything\n-        // else is unverifiable by construction, not unverified by omission.\n-\n         // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,\n         // and — the point of attack nine — never MIGRATE into it when a backend\n         // for their language lands.\n\n--- a/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\coverage-denominator.test.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\coverage-denominator.test.js\n@@ -19,6 +19,28 @@\n import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../../../mcp/stdio/query/coverage-denominator.js';\n \n describe('lsp coverage denominator', () => {\n+  it('filters verified counts by the same scope and language as call counts', () => {\n+    const r = computeCoverage([\n+      { lang: 'cpp', c: 19, verified: 10, inScope: true },\n+      { lang: 'cpp', c: 300, verified: 300, inScope: false },\n+      { lang: 'javascript'
…[1333 more chars cut]
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
 "command": "git diff --check && git diff --stat && git status --short"
}
```

### tool call: search_files
```
{
 "path": "mcp",
 "pattern": "coverage-denominator|computeCoverage\\(langScopeRows",
 "context": 1
}
```

### tool result: terminal
```
Error executing tool 'terminal': timed out after 420.0s
```

### tool result: terminal
```
{"output": "mcp/stdio/query/coverage-denominator.js       | 15 ++++++++-------\n mcp/stdio/query/verbs/health.js               | 20 ++++++++++++--------\n tests/unit/query/coverage-denominator.test.js | 48 +++++++++++++++++++++++++++++++++++-------------\n 3 files changed, 55 insertions(+), 28 deletions(-)\n M mcp/stdio/query/coverage-denominator.js\n M mcp/stdio/query/verbs/health.js\n M tests/unit/query/coverage-denominator.test.js\n?? tests/unit/query/health-call-coverage.test.js", "exit_code": 0, "error": null}
```

### tool result: search_files
```
{"total_count": 12, "matches_format": "path-grouped: each file path on its own line, followed by indented '<line>: <content>' rows for matches in that file", "matches_text": "mcp\\stdio\\brief\\artifacts.js\n  29: //   · code-intel/coverage.js            ({language, projectRoot, file, env})\n  30: //   · query/coverage-denominator.js     (langScopeRows, verified)\n  31: // They are unrelated. The refactor proposal referred to \"computeCoverage\" without qualification.\nmcp\\stdio\\query\\coverage-denominator.js\n  39:  */\n  40: export function computeCoverage(langScopeRows = []) {\n  41:   const outOfScopeRows = langScopeRows.filter((r) => r.inScope === false);\nmcp\\stdio\\query\\verbs\\health.js\n  72: \n  73: import { computeCoverage, LSP_VERIFIABLE_LANGUAGES } from '../coverage-denominator.js';\n  74: import { openExistingDb, captureExistingSnapshot } from '../../storage/db.js';\n  1522:         // for their language lands.\n  1523:         const coverage = computeCoverage(langScopeRows);\n  1524:         const verifiable = coverage.verifiable;"}
```

### tool call: terminal
```
{
 "command": "npm test -- tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-consequence-scope.test.js tests/unit/code-intel/coverage-ratio-is-a-floor.test.js",
 "timeout": 180
}
```

### tool result: terminal
```
{"output": "> aify-project-graph@0.7.1 test\n> node ./scripts/run-vitest.mjs tests/unit/query/coverage-denominator.test.js tests/unit/query/health-call-coverage.test.js tests/unit/query/health-consequence-scope.test.js tests/unit/code-intel/coverage-ratio-is-a-floor.test.js\n\n\n RUN  v3.2.4 <ARMS>/<ARM>/aify-project-graph\n\nfatal: not a git repository (or any of the parent directories): .git\nfatal: not a git repository (or any of the parent directories): .git\n ✓ tests/unit/query/health-call-coverage.test.js (4 tests) 31394ms\n   ✓ graph_health uses the same CALLS population on both sides of coverage > counts 0 eligible verified calls, not all 949 verified edges  12836ms\n   ✓ graph_health uses the same CALLS population on both sides of coverage > counts 10 eligible verified calls, not all 949 verified edges  8157ms\n   ✓ graph_health uses the same CALLS population on both sides of coverage > counts 19 eligible verified calls, not all 949 verified edges  7108ms\n   ✓ graph_health uses the same CALLS population on both sides of coverage > keeps unknown-scope fallback explicitly labelled and filters both sides identically  3292ms\n ✓ tests/unit/code-intel/coverage-ratio-is-a-floor.test.js (7 tests) 199ms\n ✓ tests/unit/query/coverage-denominator.test.js (9 tests) 4ms\n ✓ tests/unit/query/health-consequence-scope.test.js (4 tests) 3ms\n\n Test Files  4 passed (4)\n      Tests  24 passed (24)\n   Start at  10:52:23\n   Duration  38.44s (transform 389ms, setup 0m
…[142 more chars cut]
```

### tool call: read_file
```
{
 "limit": 38,
 "path": "mcp/stdio/brief/artifacts.js"
}
```

### tool call: terminal
```
{
 "command": "git diff --check && git diff -- mcp/stdio/query/coverage-denominator.js mcp/stdio/query/verbs/health.js",
 "timeout": 30
}
```

### tool result: read_file
```
{"content": "1|// BRIEF INPUTS THAT ARE NOT THE GRAPH — and the module that exists so rendering can be split.\n2|//\n3|// ★ WHY THIS FILE EXISTS AT ALL: `docs/2026-08-12-refactor-proposal.md` proposed extracting the\n4|// five renderers into `brief/render.js` and called that seam \"the verified-cleanest\" — one\n5|// input, one output, \"no back-references into analysis\". Auditing it found that FALSE: six\n6|// functions declared outside the render block are called from inside it, and the proposed split\n7|// would have created a CIRCULAR IMPORT — `generator.js` must import `render.js` to call the\n8|// renderers, while `render.js` needs `computeCoverage`, which the proposal left in\n9|// `generator.js`.\n10|//\n11|// ⇒ So the renderers cannot move until their non-graph dependencies land somewhere BOTH sides\n12|// can import. That is this file. It is a prerequisite slice, not a tidy-up, and skipping it\n13|// would have produced a cycle discovered at import time rather than at design time.\n14|//\n15|// WHAT BELONGS HERE: derivations over artifacts the brief consumes — `tasks.json` — plus the\n16|// pure coverage tier. Nothing here touches the graph database; anything that queries `db`\n17|// belongs on the graph-shape side of the seam, which is a later slice.\n18|import { isTaskOpen } from '../overlay/task-status.js';\n19|import { taskFeatureRefs, taskLinkStrength } from '../overlay/quality.js';\n20|\n21|// Feature coverage gradient — a composite health tier for brief.json
…[1623 more chars cut]
```

### tool result: terminal
```
{"output": "diff --git a/mcp/stdio/query/coverage-denominator.js b/mcp/stdio/query/coverage-denominator.js\nindex 759ef4b..7d27fbc 100644\n--- a/mcp/stdio/query/coverage-denominator.js\n+++ b/mcp/stdio/query/coverage-denominator.js\n@@ -28,9 +28,8 @@\n export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);\n \n /**\n- * @param {Array<{lang: string, c: number, inScope?: boolean}>} langScopeRows\n- *        one row per (language, scope) bucket with a count.\n- * @param {number} verified  edges actually verified by an LSP backend.\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ *        one row per (language, scope) CALLS bucket, including its verified count.\n  * @returns {{\n  *   verifiable: number, verified: number, pct: number,\n  *   denominator: string,\n@@ -38,13 +37,15 @@ export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', '\n  *   unverifiable: Array<{reason: string, lang: string, count: number}>\n  * }}\n  */\n-export function computeCoverage(langScopeRows = [], verified = 0) {\n+export function computeCoverage(langScopeRows = []) {\n   const outOfScopeRows = langScopeRows.filter((r) => r.inScope === false);\n   const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);\n \n-  const verifiable = inScopeRows\n-    .filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang))\n-    .reduce((a, r) => a + r.c, 0);\n+  // Both sides must describe the same CAL
…[4547 more chars cut]
```

### tool call: patch
```
{
 "mode": "patch",
 "patch": "*** Begin Patch\n*** Update File: mcp/stdio/brief/artifacts.js\n@@\n-//   · query/coverage-denominator.js     (langScopeRows, verified)\n+//   · query/coverage-denominator.js     (langScopeRows with per-bucket verified counts)\n*** Update File: mcp/stdio/query/coverage-denominator.js\n@@\n- * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean|null}>} langScopeRows\n*** End Patch"
}
```

### tool result: patch
```
{"success": true, "diff": "--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\brief\\artifacts.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\brief\\artifacts.js\n@@ -27,7 +27,7 @@\n // in this repo are called `computeCoverage`, with three different signatures —\n //   · this one                          ({resolved, declared, taskCount, contractCount})\n //   · code-intel/coverage.js            ({language, projectRoot, file, env})\n-//   · query/coverage-denominator.js     (langScopeRows, verified)\n+//   · query/coverage-denominator.js     (langScopeRows with per-bucket verified counts)\n // They are unrelated. The refactor proposal referred to \"computeCoverage\" without qualification.\n export function computeCoverage({ resolved, declared, taskCount, contractCount }) {\n   const anchorRatio = declared === 0 ? 1 : resolved / declared;\n\n--- a/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n+++ b/<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\coverage-denominator.js\n@@ -28,7 +28,7 @@\n export const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);\n \n /**\n- * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean}>} langScopeRows\n+ * @param {Array<{lang: string, c: number, verified?: number, inScope?: boolean|null}>} langScopeRows\n  *        one row per (language, scope) CALLS bucket, including its verified
…[771 more chars cut]
```

### assistant
Fixed the population mismatch.

Cause: health.js divided all LSP_VERIFIED edges—including non-CALLS relations, unsupported languages, and out-of-scope files—by only verifiable, in-scope CALLS.

Changes:
  - mcp/stdio/query/verbs/health.js:1497 now collects verified counts alongside CALLS counts, using the same caller-file scope.
  - mcp/stdio/query/coverage-denominator.js:40 filters numerator and denominator identically.
  - Preserved lspVerifiedEdges as the global count and added lspVerifiedVerifiableInScopeCalls to expose the actual numerator. Both percentage fields use the corrected ratio; no clamping.

Tests cover mixed relations/languages, out-of-scope files, aggregation across files, zero/partial/full verification, and unknown scope. The regression fixture has 949 verified edges and 19 eligible calls; with 10 eligible verified calls it correctly reports 53%.

Verification: 24 focused tests passed; existing collection-coverage and code-intel tests also passed. The broader query-suite run timed out, so I can’t claim a full-suite pass.

### FINAL
Fixed the population mismatch.

Cause: health.js divided all LSP_VERIFIED edges—including non-CALLS relations, unsupported languages, and out-of-scope files—by only verifiable, in-scope CALLS.

Changes:
  - mcp/stdio/query/verbs/health.js:1497 now collects verified counts alongside CALLS counts, using the same caller-file scope.
  - mcp/stdio/query/coverage-denominator.js:40 filters numerator and denominator identically.
  - Preserved lspVerifiedEdges as the global count and added lspVerifiedVerifiableInScopeCalls to expose the actual numerator. Both percentage fields use the corrected ratio; no clamping.

Tests cover mixed relations/languages, out-of-scope files, aggregation across files, zero/partial/full verification, and unknown scope. The regression fixture has 949 verified edges and 19 eligible calls; with 10 eligible verified calls it correctly reports 53%.

Verification: 24 focused tests passed; existing collection-coverage and code-intel tests also passed. The broader query-suite run timed out, so I can’t claim a full-suite pass.
