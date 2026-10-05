# R4 — runtime: claude, task: T1

### tool call: Grep
```
{
 "pattern": "NO CALLERS",
 "glob": "*.{js,mjs,ts}",
 "output_mode": "content",
 "head_limit": 30,
 "path": "<ARMS>/<ARM>\\aify-project-graph"
}
```

### tool result
```
scripts\gate-absence-refusal.mjs:25:  // its callers -- so this is NO CALLERS, not NO MATCH.
scripts\gate-absence-refusal.mjs:49:  const controlFired = withCallers.length > 0 && !/NO CALLERS/.test(withCallers);
scripts\gate-absence-refusal.mjs:50:  // ⛔ NO MATCH IS NOT NO CALLERS. The first means the symbol never resolved to a target; the
mcp\stdio\tools\schema.js:155:[Omitted long matching line]
mcp\stdio\server.js:313:[Omitted long matching line]
scripts\graph-query.mjs:45:  if (rows.length === 0) console.log('NO CALLERS for ' + symbol);
scripts\m2-absence-census.mjs:61:  // Strip comments so a DISCUSSION of "NO CALLERS" is not counted as an emitted answer.
scripts\probe-clause-firing-rate.mjs:17://                  (a) symbols with NO incoming CALLS edge  -> NO CALLERS
scripts\probe-clause-firing-rate.mjs:94:  ...orphans.map((s) => ['NO CALLERS', s]),
scripts\probe-clause-firing-rate.mjs:108:// callerless, only some produce NO CALLERS; the rest resolve to NO MATCH. Labelling a specimen by my
scripts\probe-clause-firing-rate.mjs:114:  const shape = /NO CALLERS/.test(text) ? 'NO CALLERS'
scripts\probe-absence-names-indexed-scope.mjs:17://                NO MATCH (symbol unknown) and NO CALLERS (symbol known, empty caller set).
scripts\probe-absence-names-indexed-scope.mjs:67:  const shapesOk = /NO MATCH/.test(noMatch) && /NO CALLERS/.test(noCallers);
scripts\probe-absence-names-indexed-scope.mjs:76:      { shape: 'NO CALLERS (empty set)    ', text: noCallers },
scripts\probe
…[1982 more chars cut]
```

### tool call: Grep
```
{
 "pattern": "NO CALLERS",
 "path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio",
 "output_mode": "content",
 "-n": true,
 "glob": "*.js"
}
```

### tool result
```
mcp\stdio\ingest\code-intel\importer.js:286:// "NO CALLERS" for a symbol that genuinely has callers.
mcp\stdio\tools\schema.js:155:[Omitted long matching line]
mcp\stdio\query\lsp-evidence.js:194:// MOST dangerous output a graph verb can emit is an absence claim ("NO CALLERS
mcp\stdio\query\lsp-evidence.js:212:// the bare "NO CALLERS for X" line. ALWAYS the heuristic-not-exhaustive caveat.
mcp\stdio\query\lsp-evidence.js:481://     NO CALLERS for "alpha::Widget::render". Try graph_whereis(...) for an overview.
mcp\stdio\query\lsp-evidence.js:536:  // ⛔ "NO CALLERS" IS WHAT AN AGENT READS AS A DELETION LICENCE, and it was handing that licence
mcp\stdio\server.js:313:[Omitted long matching line]
mcp\stdio\query\unsearched-scope.js:4:// PASSES_THROUGH — a deliberate, documented choice. Both then said "NO CALLERS" / "NO CALLEES",
mcp\stdio\query\unsearched-scope.js:21://     graph_callers("Class2")    ->  NO CALLERS for "Class2"
mcp\stdio\query\verbs\callers.js:92:    // I1 / R2-2026-05-31 — an absence claim ("NO CALLERS") is the most dangerous
mcp\stdio\query\verbs\callers.js:97:    // "NO CALLERS" and never a "trustworthy/exhaustive absence".
mcp\stdio\query\verbs\callers.js:124:    if (edges.length === 0) return absence(`NO CALLERS for "${symbol}"${indexedScopePhrase(db)}. Try graph_whereis(symbol="${symbol}", expand=true) for an overview.`);
mcp\stdio\query\verbs\callers.js:147:    if (mapped.length === 0) return absence(file ? `NO CALLERS from "${file}"${indexedScopePhrase(d
…[396 more chars cut]
```

### tool call: Read
```
{
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js"
}
```

### tool result
```
1	import { join } from 'node:path';
2	import { openExistingDb } from '../../storage/db.js';
3	import { renderCompact } from '../renderer.js';
4	import { rankCallers } from '../rank.js';
5	import { enforceBudget } from '../budget.js';
6	import { collapseCallerEdges, expandClassRollupTargets } from './target_rollup.js';
7	import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
8	import { loadManifest } from '../../freshness/manifest.js';
9	import { computeTrustLevel } from './health.js';
10	import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
11	import { buildTrustLine, buildAbsenceTrustLine, hasLspVerifiedEdge, ABSENCE_TRUST_UNAVAILABLE, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';
12	import { EXECUTION_FAMILY, CALL_FAMILY } from '../../storage/taxonomy.js';
13	import { normalizePathArg } from '../../util/paths.js';
14	import { noMatchMessage } from '../did-you-mean.js';
15	// ⚠ Shared with graph_callees, which has the identical defect mirrored onto outgoing edges.
16	// One owner: fixing one verb and pasting into the other is how the two drift apart.
17	import { unsearchedRelationNote } from '../unsearched-scope.js';
18	import { indexedScopePhrase } from '../miss-scope.js';
19	import { isOvercountSuspicious, describeResultCount } from '../overcount-risk.js';
20	
21	const EXECUTION_RELATIONS = EXECUTION_FAMILY;
22	
23	// ⛔ THE RELATIONS THIS VERB DELIBERATELY DOES NOT SEARCH. Derived by SUBTRACTING 
…[14851 more chars cut]
```

### tool call: Grep
```
{
 "pattern": "graphCallers",
 "path": "<ARMS>/<ARM>\\aify-project-graph",
 "glob": "tests/**/*.test.js",
 "output_mode": "count"
}
```

### tool result
```
tests\integration\verbs.test.js:2
tests\integration\m2-heuristic-misses-indirection-and-macros.test.js:4
tests\integration\m2-heuristic-counts-uncompiled-calls.test.js:2
tests\integration\m2-cpp-absence-names-unmodelled-constructs.test.js:4
tests\integration\m1b-overloads-do-not-collapse.test.js:2
tests\integration\m1-cpp-caller-sets.test.js:2
tests\integration\m1-caller-sets-do-not-merge.test.js:3
tests\unit\eval\regression-invariants.test.js:2
tests\unit\query\contract-failure-is-disclosed.test.js:1
tests\unit\query\ambiguity-remedy-can-change-the-answer.test.js:8
tests\unit\query\empty-set-absence-names-uncommitted.test.js:3
tests\unit\query\absence-names-uncommitted-sources.test.js:10
tests\unit\query\caller-callee-chain.test.js:2
tests\unit\query\every-capped-verb-reports-its-floor.test.js:2
tests\unit\query\absence-names-its-population.test.js:8
tests\unit\query\absence-headlines-name-the-scope.test.js:3
tests\unit\query\ambiguous-symbol-guards.test.js:3
tests\unit\query\lsp-verified-surface.test.js:8
tests\unit\query\no-match-names-its-scope.test.js:2
tests\unit\query\nonempty-result-names-relevant-uncommitted.test.js:7
tests\unit\ab\tearing-changes-verb-output.test.js:1
tests\unit\query\provenance-surface.test.js:2
tests\unit\query\results-banner-failure-is-disclosed.test.js:2
tests\unit\query\truncation-honesty.test.js:2
tests\unit\query\untracked-file-is-named-in-the-absence.test.js:5

Found 90 total occurrences across 25 files.
```

### tool call: Read
```
{
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\truncation-honesty.test.js"
}
```

### tool result
```
1	// A result that quietly drops matches is the same failure class as a false
2	// exhaustive:true — the agent cannot tell a complete answer from a capped one.
3	//
4	// LH-1 (2026-07-26): graph_search truncated SILENTLY, twice — a SQL candidate cap
5	// and a display slice — and rendered with no `truncated` argument at all.
6	// P0-4: graph_callers printed caller DECLARATION lines in a format that reads as
7	// call sites; the Sand Castle census scored it 0/8 for exactly that reason.
8	import { describe, expect, it, beforeEach, afterEach } from 'vitest';
9	import { mkdtemp, rm, mkdir } from 'node:fs/promises';
10	import { tmpdir } from 'node:os';
11	import { join } from 'node:path';
12	import { openDb } from '../../../mcp/stdio/storage/db.js';
13	import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
14	import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
15	
16	function insertNode(db, node) {
17	  db.run(
18	    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
19	     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
20	    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node });
21	}
22	
23	function insertEdge(db, edge) {
24	  db.run(
25	    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
26	     VALUES ($from_id, $to_id, $relation, $source_file, $sour
…[3631 more chars cut]
```

### tool call: Edit
```
{
 "replace_all": false,
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js",
 "old_string": "    let edges;\n    if (depth <= 1) {\n      edges = db.all(\n        `SELECT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line\n         FROM edges e JOIN nodes n ON n.id = e.from_id\n         WHERE e.to_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})\n         LIMIT ${EDGE_FETCH_CAP + 1}`,\n        params\n      );",
 "new_string": "    // ⛔ THE `file` SCOPE FILTER MUST RUN IN SQL, BEFORE THE LIMIT. It used to run on the already\n    // capped rows, so a target with >EDGE_FETCH_CAP callers elsewhere filled the cap first and a\n    // caller that DOES live under `file` was never fetched: \"NO CALLERS from <dir>\" for a\n    // directory containing one. Prefix match via substr (not LIKE) so `_`/`%` in a path stay literal.\n    const fileClause = file ? 'AND substr(n.file_path, 1, length($file)) = $file' : '';\n    if (file) params.file = file;\n    let edges;\n    if (depth <= 1) {\n      edges = db.all(\n        `SELECT e.*, n.label AS from_label, n.type AS from_type, n.file_path AS from_file, n.start_line AS from_line\n         FROM edges e JOIN nodes n ON n.id = e.from_id\n         WHERE e.to_id IN (${placeholders}) AND e.relation IN (${EXECUTION_RELATIONS.map((relation) => `'${relation}'`).join(',')})\n         ${f
…[79 more chars cut]
```

### tool call: Edit
```
{
 "replace_all": false,
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js",
 "old_string": "         JOIN nodes n ON n.id = e.from_id\n         LIMIT ${EDGE_FETCH_CAP + 1}`,\n        { ...params, depth }",
 "new_string": "         JOIN nodes n ON n.id = e.from_id\n         WHERE 1 = 1 ${fileClause}\n         LIMIT ${EDGE_FETCH_CAP + 1}`,\n        { ...params, depth }"
}
```

### tool call: Edit
```
{
 "replace_all": false,
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\mcp\\stdio\\query\\verbs\\callers.js",
 "old_string": "    // File scope filter: only show callers from a specific directory\n    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));\n    if (mapped.length === 0)",
 "new_string": "    // File scope filter is applied in SQL above (before the fetch cap). After a class rollup the\n    // collapsed rows can still differ in file, so keep the cheap in-memory guard too.\n    if (file) mapped = mapped.filter(e => e.source_file && e.source_file.startsWith(file));\n    if (mapped.length === 0)"
}
```

### tool result
```
The file <ARMS>/<ARM>\aify-project-graph\mcp\stdio\query\verbs\callers.js has been updated successfully. (file state is current in your context — no need to Read it back)
```

### tool call: Edit
```
{
 "replace_all": false,
 "file_path": "<ARMS>/<ARM>\\aify-project-graph\\tests\\unit\\query\\truncation-honesty.test.js",
 "old_string": "  it('graph_callers states its locations",
 "new_string": "  it('graph_callers file scope finds a caller that sits past the fetch cap in another directory', async () => {\n    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));\n    insertNode(db, { id: 'callee', type: 'Function', label: 'shared_target', file_path: 'core/t.cpp' });\n    // 120 heuristic callers in one directory fill the 100-row SQL cap...\n    for (let i = 0; i < 120; i++) {\n      insertNode(db, { id: `h${i}`, type: 'Function', label: `bulk_caller_${i}`, file_path: `bulk/b${i}.cpp` });\n      insertEdge(db, { from_id: `h${i}`, to_id: 'callee', relation: 'CALLS', source_file: `bulk/b${i}.cpp`, provenance: 'INFERRED' });\n    }\n    // ...and the one verified caller lives elsewhere, inserted last.\n    insertNode(db, { id: 'v', type: 'Function', label: 'verified_caller', file_path: 'app/v.cpp' });\n    insertEdge(db, { from_id: 'v', to_id: 'callee', relation: 'CALLS', source_file: 'app/v.cpp', provenance: 'LSP_VERIFIED' });\n    db.close();\n\n    const out = await graphCallers({ repoRoot, symbol: 'shared_target', file: 'app/' });\n\n    expect(out).not.toMatch(/NO CALLERS/);\n    expect(out).toContain('verified_caller');\n  });\n\n  it('graph_callers states its locations"
}
```

### tool result
```
The file <ARMS>/<ARM>\aify-project-graph\mcp\stdio\query\verbs\callers.js has been updated successfully. (file state is current in your context — no need to Read it back)
```

### tool result
```
The file <ARMS>/<ARM>\aify-project-graph\mcp\stdio\query\verbs\callers.js has been updated successfully. (file state is current in your context — no need to Read it back)
```

### tool result
```
The file <ARMS>/<ARM>\aify-project-graph\tests\unit\query\truncation-honesty.test.js has been updated successfully. (file state is current in your context — no need to Read it back)
```

### assistant
Now I'll run the new test with the fix, then stash the fix to confirm the test fails without it.

### tool call: Bash
```
{
 "command": "npx vitest run tests/unit/query/truncation-honesty.test.js 2>&1 | tail -15; git stash push mcp/stdio/query/verbs/callers.js -q && npx vitest run tests/unit/query/truncation-honesty.test.js 2>&1 | grep -E \"✓|×|FAIL|Tests \" | head; git stash pop -q && git status --short"
}
```

### tool result
```
\u001b[1m\u001b[46m RUN \u001b[49m\u001b[22m \u001b[36mv3.2.4 \u001b[39m\u001b[90m<ARMS>/<ARM>/aify-project-graph\u001b[39m

 \u001b[32m✓\u001b[39m tests/unit/query/truncation-honesty.test.js \u001b[2m(\u001b[22m\u001b[2m5 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 1970\u001b[2mms\u001b[22m\u001b[39m
   \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m truncation honesty\u001b[2m > \u001b[22mgraph_search reports how many of how many matches it showed \u001b[33m 1807\u001b[2mms\u001b[22m\u001b[39m

\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m
\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m
\u001b[2m   Start at \u001b[22m 09:21:28
\u001b[2m   Duration \u001b[22m 6.34s\u001b[2m (transform 486ms, setup 0ms, collect 2.70s, tests 1.97s, environment 0ms, prepare 152ms)\u001b[22m

   \u001b[32m✓\u001b[39m truncation honesty\u001b[2m > \u001b[22mgraph_search reports how many of how many matches it showed\u001b[32m 136\u001b[2mms\u001b[22m\u001b[39m
   \u001b[32m✓\u001b[39m truncation honesty\u001b[2m > \u001b[22mgraph_search stays quiet when nothing was dropped\u001b[32m 15\u001b[2mms\u001b[22m\u001b[39m
   \u001b[32m✓\u001b[39m truncation honesty\u001b[2m > \u001b[22mgraph_search warns that the hard candidate cap makes results a FLOOR\u001b[32m 46\u001b[2mms\u001b[22m\u001b[39m
\u001b[31m   \u001b[31m×\u001b[31m truncation honesty\u001b[2m > \u001b[22mgraph_callers file scope finds a caller that sits past the fetch cap in another directory\u001b[39m\u001b[32m 53\u001b[2mms\u001b[22m\u001b[39m
   \u001b[32m✓\u001b[39m truncation honesty\u001b[2m > \u001b[22mgraph_callers states its locations are caller declarations, not call sites\u001b[32m 20\u001b[2mms\u001b[22m\u001b[39m
\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m\u001b[1m\u001b[41m Failed Tests 1 \u001b[49m\u001b[22m\u001b[31m⎯⎯⎯⎯⎯⎯⎯\u001b[39m
\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m tests/unit/query/truncation-honesty.test.js\u001b[2m > \u001b[22mt
…[304 more chars cut]
```

### assistant
Red without the fix, green with it. Running the other caller-related suites for regressions.

### tool call: Bash
```
{
 "command": "npx vitest run tests/unit/query tests/integration/verbs.test.js tests/integration/m1-caller-sets-do-not-merge.test.js 2>&1 | grep -E \"FAIL|Test Files|Tests \" | head",
 "timeout": 400000
}
```

### tool result
```
Command did not complete within its 400s timeout and was moved to the background (ID: b5o055apo). Output is being written to: C:\Users\Administrator\AppData\Local\Temp\claude\C--Docker-aify-trial-arms-<ARM>-aify-project-graph\778b2740-30fd-4664-a8cb-5ebfe780fe97\tasks\b5o055apo.output. You will be notified when it completes. If it is still running after 30m in the background, it will be stopped and you will be notified. To check interim output, use Read on that file path.
```

### tool call: Bash
```
{
 "command": "timeout 550 npx vitest run tests/unit/query/ --reporter=dot 2>&1 | grep -E \"FAIL|Test Files|Tests \" | head",
 "timeout": 580000
}
```

### tool result
```
(Bash completed with no output)
```

### tool call: Bash
```
{
 "command": "sleep 120; grep -E \"FAIL|Test Files|Tests \" /c/Users/Administrator/AppData/Local/Temp/claude/C--Docker-aify-trial-arms-<ARM>-aify-project-graph/778b2740-30fd-4664-a8cb-5ebfe780fe97/tasks/b5o055apo.output | head",
 "timeout": 150000
}
```

### tool result (error)
```
<tool_use_error>Blocked: sleep 120 followed by: grep -E "FAIL|Test Files|Tests " /c/Users/Administrator/AppData/Local/Temp/claude/C--Docker-aify-trial-arms-<ARM>-aify-project-graph/778b2740-30fd-4664-a8cb-5ebfe780fe97/tasks/b5o055apo.output head. To wait for a condition, use Monitor with an until-loop (e.g. `until <check>; do sleep 2; done`). To wait for a command you started, use run_in_background: true. Do not chain shorter sleeps to work around this block.</tool_use_error>
```

### assistant
The background run will notify me when it finishes.

### tool call: Monitor
```
{
 "query": "select:Monitor",
 "max_results": "1"
}
```

### tool result (error)
```
<tool_use_error>InputValidationError: Monitor failed due to the following issue:
The required parameter `description` is missing

This tool's schema was not sent to the API — it was not in the discovered-tool set derived from message history. Without the schema in your prompt, typed parameters (arrays, numbers, booleans) get emitted as strings and the client-side parser rejects them. Load the tool first: call ToolSearch with query "select:Monitor", then retry this call. For reference, this tool's input schema is: {"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"description":{"description":"Short human-readable description of what you are monitoring (shown in notifications).","type":"string"},"timeout_ms":{"description":"Kill the monitor after this deadline. Default 300000ms. Deadlines above 1800000ms are capped to 1800000ms. You are notified at expiry and can re-arm.","default":300000,"type":"number","minimum":1000,"maximum":3600000},"command":{"description":"Shell command or script. Each stdout line is an event; exit ends the watch.","type":"string"},"ws":{"description":"WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.","type":"object","properties":{"url":{"type":"string"},"protocols":{"type":"array","items":{"type":"string","pattern":"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$"}}},"required":["url"],"additionalProperties":false}},"require
…[78 more chars cut]
```

### assistant
I'll wait for the background task notification instead.

`graph_callers` with a `file` scope now finds a caller that sits outside the first 100 callers fetched. The cause was a filter that ran after the 100-row cap.

**Cause.** `mcp/stdio/query/verbs/callers.js` fetched at most 101 caller edges (`EDGE_FETCH_CAP`) and only then filtered them by `file` in JavaScript. With about 120 heuristic callers in one directory, the cap filled with those. The one LSP_VERIFIED caller in the other directory was never fetched, so the filtered list came back empty and the verb answered `NO CALLERS from "<dir>"`.

**Fix.** The `file` prefix filter is now part of the SQL, for both the depth-1 and the recursive depth>1 queries, so it applies before the cap. I used `substr(...) = $file` rather than `LIKE`, so `_` and `%` in a path stay literal. The JavaScript filter stays as a cheap guard after class rollup.

**Test.** I added a test to `tests/unit/query/truncation-honesty.test.js`. It builds 120 callers in `bulk/` and one LSP_VERIFIED caller in `app/`, then queries with `file: 'app/'`. It fails without the fix and passes with it, and all 5 tests in that file pass.

I have not seen the wider suite finish. A run of `tests/unit/query`, `verbs.test.js` and `m1-caller-sets-do-not-merge.test.js` timed out in the foreground and is still running in the background. A second attempt on `tests/unit/query/` also produced no output within its timeout. I'll report the result when it lands. Nothing is committed yet.

### FINAL
I'll wait for the background task notification instead.

`graph_callers` with a `file` scope now finds a caller that sits outside the first 100 callers fetched. The cause was a filter that ran after the 100-row cap.

**Cause.** `mcp/stdio/query/verbs/callers.js` fetched at most 101 caller edges (`EDGE_FETCH_CAP`) and only then filtered them by `file` in JavaScript. With about 120 heuristic callers in one directory, the cap filled with those. The one LSP_VERIFIED caller in the other directory was never fetched, so the filtered list came back empty and the verb answered `NO CALLERS from "<dir>"`.

**Fix.** The `file` prefix filter is now part of the SQL, for both the depth-1 and the recursive depth>1 queries, so it applies before the cap. I used `substr(...) = $file` rather than `LIKE`, so `_` and `%` in a path stay literal. The JavaScript filter stays as a cheap guard after class rollup.

**Test.** I added a test to `tests/unit/query/truncation-honesty.test.js`. It builds 120 callers in `bulk/` and one LSP_VERIFIED caller in `app/`, then queries with `file: 'app/'`. It fails without the fix and passes with it, and all 5 tests in that file pass.

I have not seen the wider suite finish. A run of `tests/unit/query`, `verbs.test.js` and `m1-caller-sets-do-not-merge.test.js` timed out in the foreground and is still running in the background. A second attempt on `tests/unit/query/` also produced no output within its timeout. I'll report the result when it lands. Nothing is committed yet.
