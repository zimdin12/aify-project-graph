# Reference pull + codebase audit — 2026-06-12

Ran by graph-tech-lead at the dashboard's request: pull all `reference/` updates, analyze
them for borrowable techniques, then audit our own codebase for "big issues" (4 Fable-5
reference-analysis agents + 4 Fable-5 codebase-scan agents, medium effort).

## 1. Reference repos pulled (fast-forward, clean)

| repo | license | old → new | notable upstream work |
|---|---|---|---|
| agent-code-intel | UNLICENSED (pattern-only) | 8c31e79 → 6f0fc55 | Next/React FrameworkProvider, ESLint analyzer bridge, server-action/dynamic-import false-caller fixes, BOM/shebang directive sniffing |
| codegraph | MIT | b026e64 → df6f4be | chained-call resolution (return-type based), class-instantiation edges, function-as-value capture, same-name monorepo disambiguation, **stdin error→shutdown**, default tool surface→4, Windows backslash paths, dynamic-dispatch boundary surfacing |
| graphify | **Apache-2.0** (corrected 2026-08-19 — this line said "MIT (v8)"; the repo ships LICENSE + NOTICE stating Apache-2.0, and retains LICENSE-MIT only for pre-relicensing contributions) | 0cf596a → 1bb30fc | **extractor-version cache invalidation**, default import/export symbol edges, tsconfig `extends` chains, Windows claude.cmd spawn + windowsHide, Claude CLI ≥2.1 JSON-array envelope |
| agent-understand-anything | MIT | 26edf61 → 09ede19 | **NodeNext .js→.ts import rewrite**, bounded-parallel file I/O |

## 2. CONFIRMED BIG ISSUES (independently flagged by ≥2 agents → high confidence)

### A. Server has NO shutdown path — orphans + leaks LSP children (CRITICAL, effort S)
`mcp/stdio/server.js:873-876` wires only `rl.on('line')`. No `rl.on('close')`, no
`process.stdin.on('error')`, no SIGINT/SIGTERM, no `process.stdout.on('error')`. When the
host closes stdin (the standard stdio-MCP shutdown), live `SESSIONS` (spawned
clangd/tsserver/pyright children) + watcher keep the event loop alive → server lingers and
leaks language-server children on every host exit. A `send()` to a dead stdout pipe is an
unhandled crash path. Flagged by 3 independent agents (codegraph-analysis #5, code-intel #6/#15,
query/runner #3). codegraph's upstream `0b1a2ee` is the exact fix to mirror. **We are strictly
worse than pre-fix upstream here.**

### B. False-exhaustive holes — the project's critical bug class (CRITICAL, effort S–M each)
Multiple distinct paths can stamp `exhaustive:true` / "lsp-verified (index-ready, N callers)"
on an incomplete result:
- **TS/Python coverage `complete:true` from mere tsconfig presence** — `coverage.js:35-44`
  `tsCoverage` never checks the queried file is inside the config's `include`; pyright is
  `python_dynamic` (never exhaustive) but the cause string is mislabeled. (code-intel #7, query #2/#5)
- **Stale document text in long-lived sessions** — `code_intel_live.js:199-208` / `live.js`:
  a URI opened once is never re-read (no `didChange`/`didClose`), so after an edit, refs +
  `exhaustive:true` are computed against stale content. (code-intel #1)
- **Truncation not marked partial** — TS/Py enumeration caps at 200 files and hierarchy
  caps (breadthCap 25 / totalCap 200) drop edges, but the result still carries
  `exhaustive:true` and `[lsp✓]`. cpp provider does this correctly; TS/Py + hierarchy don't.
  (code-intel #3, query #2)
- **`graph_callers` banner from 1 intra-file edge + repo index-ready** —
  `lsp-evidence.js:104-165` grants the delete-licensing banner from ≥1 LSP_VERIFIED edge
  without confirming the collection covered *this symbol*. (query #1)
- **Coverage guard fails OPEN** — `code_intel_live.js:369-371` / hierarchy `catch { coverage = null }`
  and null coverage is treated as trustworthy. Should fail closed. (query #5)

### C. Windows URI keying mismatch breaks TS/pyright diagnostics (HIGH, effort S)
`lsp-client.js:608-627` keys diagnostics on `file:///C:/...` (Node `pathToFileURL`) but
tsserver/pyright publish `file:///c%3A/...` (vscode-uri: lowercase drive, %-encoded colon).
On Windows every `diagnosticsFor` is empty, `waitForDiagnostics` always times out (1.5–3s tax
per file), and the hierarchy cold-parse gate never sees publishes. (code-intel #4)

### D. Extractor-version cache invalidation missing (HIGH, effort S)
`freshness/orchestrator.js:42-43` defines `EXTRACTOR_VERSION`/`PARSER_BUNDLE_VERSION`, writes
them to the manifest, but the rebuild decision only checks `schemaVersion`. Shipped extractor
fixes (e.g. our own C++ caller-gap work) never reach unchanged files without manual
`force=true`. Confirmed live bug; graphify `8401c50` is the fix. (graphify-analysis #1)

### E. Scoreboard "fixable" buckets are materially inflated (HIGH, effort S)
`freshness/unresolved-categorization.js:52-58` calls any short-name CALLS/REFS "fixable", but
the resolver refuses COMMON_NAMES by design and never resolves JS globals. Live artifact
confirms top "fixable" samples are `parse`, `log`, `__dirname`, `node` — never fixable.
Intra-repo imports are also miscategorized as `external-by-design:npm` (the npm regex matches
relative paths). **The whole reference-borrow premise rested on this scoreboard — it overstates
actionable work.** Fixing the classifier first tells us the real gap. (ingest #1/#2/#15)

### F. Freshness "stale reported fresh" (HIGH, effort S–M)
- `freshCache` (5s, keyed on repoRoot+HEAD only) swallows watcher-triggered syncs: edit
  within the TTL hits the cache and is never indexed. (overlay/freshness H1)
- `git.js` diff failure returns `[]` (indistinguishable from "no changes"), then the noop
  path advances `manifest.commit = HEAD` → the changed range is lost forever. (H2)

## 3. RESOLUTION-QUALITY GAPS (feed the real backlog; MED–HIGH)
- **JS/TS arrow/const functions produce NO symbols** — extractors cover only
  class/function/method declarations; `const foo = () => {}` (dominant modern style) creates
  no node, so every call to it is unresolved. Likely the single largest feeder of the JS/TS
  short-name backlog. (ingest #4)
- **Qualifiers destroyed at extraction** — `normalizeCallTarget` keeps only the last segment
  for JS/TS/Python, starving the resolver's member/inheritance machinery. (ingest #5)
- **Wrong-target false edges** — global label match runs before import evidence, so a
  same-named local symbol wins over the imported one, with `EXTRACTED` provenance. (ingest #6)
- **NodeNext `.js→.ts` rewrite missing** — `import './x.js'` where only `x.ts` exists: our
  `probeWithExtensions` appends extensions (`x.js.ts`) and drops the edge. Live bug; tests
  port directly from understand-anything `a6c653e`. (understand #1)
- **Default import/export + renamed bindings** — `import Bar from './foo'` (class Foo) finds
  no label match and bails. (graphify #4)

## 4. BORROW SHORTLIST (ranked, cross-referenced to our gaps)
1. stdin error/close → shutdown (codegraph `0b1a2ee`) — fixes issue A. S.
2. Class-instantiation edges (codegraph `d0e6499`) — `new Foo()` invisible on tree-sitter path. M.
3. NodeNext .js→.ts rewrite (understand `a6c653e`) — fixes a live edge-loss bug. S.
4. Extractor-version cache invalidation (graphify `8401c50`) — fixes issue D. S.
5. Function-as-value capture (codegraph `8a114ba`) — biggest dent in "looks dead but isn't". L.
6. Chained-call resolution via return types (codegraph `fd03f31`+`48d4654`) — TS/Py ceiling. L.
7. Same-name definition grouping + `file` narrowing (codegraph `222af6b`) — monorepo conflation. M.
8. Next/React framework-entry awareness (agent-code-intel, pattern-only) — kills false dead-code
   on Next route exports under our new TS backend. M.

## 5. Recommended fix sequence
**Wave 1 (safe, high-confidence, mostly S):** A (server lifecycle), C (Windows URI keying),
D (cache invalidation), E (scoreboard classifier honesty). Low risk, immediate correctness.
**Wave 2 (trust contract, needs care):** B's false-exhaustive holes — coverage gating, stale-doc
`didChange`, truncation→partial, fail-closed coverage. These touch the trust spine; test-heavy.
**Wave 3 (resolution quality, borrow):** ingest #4/#5/#6 + NodeNext rewrite + class-instantiation
+ default-export resolution; re-measure the (corrected) scoreboard after each.

Full per-agent findings preserved in this session's transcript; agent IDs resumable via
SendMessage if deeper detail is needed.
