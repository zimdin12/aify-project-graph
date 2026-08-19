# Reference-Borrow Synthesis — making aify-project-graph better

_Generated 2026-05-08 from holistic analysis of 4 reference projects under `reference/`._
_Sources: agent-code-intel (LSP sibling, UNLICENSED/internal), codegraph (MIT), graphify (**Apache-2.0**), agent-understand-anything (MIT)._

## The headline: convergent evidence

Four independent projects in our problem space all point at the **same** highest-leverage fix:

> **Use each file's import statements as resolution evidence.**

- **codegraph** → `name-matcher.ts` import-FQN alias narrowing (#314) + `import-resolver.ts`/`path-aliases.ts`.
- **graphify** → `symbol_resolution.py` Tier-A "import-guided (EXTRACTED, conf 1.0)" resolution.
- **understand-anything** → `extract-import-map.mjs` specifier→file probing + tsconfig aliases.

Our resolver (`mcp/stdio/ingest/resolver.js`) resolves by qname/label/file-suffix + language-family gating + COMMON_NAMES denylist, but **never consults per-file imports**. Our own `mcp/stdio/freshness/unresolved-categorization.js` already labels the gap:
- **1215 `fixable:call-short-name`** + **261 `fixable:reference-short-name`** = **1476 fixable** edges
- **87 unresolved IMPORTS** (JS/TS)

That `fixable:*` bucket count is our built-in scoreboard for every resolver change below.

## Workstreams (ranked by leverage ÷ risk)

### W1 — Windows hygiene: `windowsHide: true` (codegraph #498)  — S, ~zero risk
Add `windowsHide: true` to every `child_process` options object. We have **zero** today; ~18 call sites flash console windows on win32 on every MCP call. Sites (from agent grep):
`packet.js:85,92` · `change_plan.js:96,111` · `consequences.js:161,486` · `pull.js:128,500,637` · `freshness/git.js:72` · `ingest/git-candidates.js:42` · `brief/generator.js:948,1021,1674` · `preflight-native.js:54` · `code-intel/lsp-client.js:33` · `code_intel_analyze.js:164` · `code-intel/cli/{doctor.js:13,serve-lsp.js:29,52}` · `providers/cpp-clangd.js`.
Best done as a shared `gitExec`/default-opts helper so new sites inherit it. Ignored on non-Windows → safe for Hermes/Claude Code both.

### W2 — `git ls-files -z` non-ASCII fix (understand-anything #214) — S, very low risk
`mcp/stdio/ingest/git-candidates.js` `getGitCandidateFiles` runs `git ls-files --cached --others --exclude-standard` **without `-z`** and splits on `\r?\n`. Without `-z`, git C-escapes non-ASCII paths (`"\360\237..."`) → files under emoji/CJK/accented dirs are **silently dropped from ingest**. Fix: add `-z`, split on `\0`, bump maxBuffer. Latent correctness bug independent of everything else.

### W3 — Import-evidence resolution for IMPORTS (understand-anything + codegraph) — S→M, low risk
Fixes the **87 IMPORTS**. Two sub-bugs in `normalizeImportSource` (identical in `languages/javascript.js` + `typescript.js`):
1. **No extension probing** — emits `dir/foo`, but File node is `dir/foo.js`; `findByFilePathSuffix` never matches. Port `probeWithExtensions` + ladder `['.ts','.tsx','.js','.jsx','.mjs','.cjs','/index.ts',...]` against our existing `getGitCandidateFiles()` Set.
2. **No tsconfig path-aliases** — `@/foo`/`~/foo` emitted raw → dropped. Port `loadTsConfigs` (monorepo deepest-first) + `matchTsAlias`/`applyTsAlias` + the **`posix.normalize` leading-`./` strip** (#214 — the load-bearing detail; create-next-app `"@/*":["./*"]` otherwise drops every alias edge).
Also add a `require()` regex pass (CJS coverage; tree-sitter `import_statement` misses it).
Additive: only resolves things currently unresolved → cannot regress existing edges.

### W4 — Import-evidence resolution for CALLS/REFERENCES (codegraph + graphify) — M, medium risk
Fixes the bulk of the **1476 fixable** short-name calls/refs. Thread a per-file `localName → {source, exportedName}` import map into `resolver.js resolveTarget`; add a method-call branch:
- graphify Tier-A: resolve a short-name call **only** when it matches an imported alias AND maps to exactly one node (EXTRACTED).
- codegraph receiver-type inference (`matchMethodCall`): infer `obj.method` receiver type from field decls / imports, then `resolveMethodOnType` by FQN-suffix; alias-narrow duplicated simple names via the file's imports (#314).
Guardrails (both refs insist): emit only on **unique** candidate; keep `provenance:'INFERRED'`/`'AMBIGUOUS'`; never let a doc node satisfy a code call. **False-positive risk** is real → gate by confidence + proximity, measure against the `fixable:*` scoreboard (must not inflate wrong edges).

### W5 — TS/JS LSP provider (agent-code-intel) — M, medium risk — the semantic backstop
We **already** ported the LSP plumbing: `code-intel/lsp-client.js`, `ingest/code-intel/importer.js` (`provenance:'CODE_INTEL'`), the evidence contract in `code_intel_live.js`. **Only `cpp-clangd` is wired.** Add `code-intel/providers/ts-tsserver.js` mirroring `cpp-clangd.js` (typescript-language-server `--stdio`), register in `cli/code-intel-cmd.js`, feed the existing importer. This resolves the CALLS that pure name-matching (W4) can't disambiguate — semantic ground truth. Use a `resolveServer` precedence chain (env → project `node_modules/.bin` → bundled → PATH) like agent-code-intel `languages/common.js`.

### W6 — Hermes + Claude Code dual-runtime (agent-code-intel pattern) — M
Requirement: must run under **both** Hermes and Claude Code. agent-code-intel serves MCP + Pi + CLI from one `executeToolCore(name,args,runtime)` + thin per-host shims. Our `code_intel_live.js` verbs already export in this shape; need (a) one runtime-neutral dispatcher, (b) a Hermes shim alongside the Claude-Code MCP `server.js` registration, keeping arg/return schema identical. Pair with agent-code-intel's `resolveServer` chain so the LSP path has no PATH assumptions across runtimes.

### W7 — packet.js skeletonize-before-drop (codegraph #564/#569) — S→M, low risk
`clampToBudget` currently **drops** whole tail sections. Adapt the philosophy (size to the answer, not the cap): Tier-1 collapse list items sharing a directory prefix into one summary line (`12 anchors under src/auth/* (+3 more)`); Tier-2 keep header+count (`TESTS: 8 omitted (over budget)`) instead of deleting; Tier-3 drop only as last rail. Never drop the section containing the packet `target`. Stays a presentation primitive (respects the locked packet rule).

### Secondary (defer / opportunistic)
- **Worktree mismatch notice** (codegraph `sync/worktree.ts`) — S. If run inside a git worktree lacking its own `.aify-graph/`, we silently serve the parent graph. Prepend a one-line notice.
- **Circular-import detection** (graphify `find_import_cycles`) — S→M. New analysis verb; bounded `simple_cycles`, rotation-dedup. New agent-facing insight, not an edge fix.
- **Two-hash manifest** (graphify AST vs semantic) — S→M. Lets the LLM intelligence layer re-run only on content-changed files.
- **Louvain semantic batching** (understand-anything) — L, defer. Helps LLM intelligence layer, not structural edges; new `graphology` dep (Hermes-compat unverified).
- **Self-bundling bootstrap** (agent-code-intel `bin/bootstrap.js`) — M/L. "Just works" plugin install for both runtimes.

## Licensing
- codegraph / understand-anything = **MIT**; graphify = **Apache-2.0** (corrected 2026-08-19 from a wrong "MIT" record; Apache-2.0 adds notice/attribution obligations MIT does not)
- all three → may copy with attribution; but type shapes differ (TS/Python vs our JS+SQLite) so **reimplement heuristics**, don't copy files. `lru-cache.ts` is the only copy-verbatim candidate. Keep `ATTRIBUTION.md` updated.
- agent-code-intel = **UNLICENSED / private (BLEI-internal)** → **do NOT copy source**. Reimplement patterns only (we already do — "reference parity" comments).

## Recommended sequence
1. **Wave A (mechanical, zero/near-zero risk):** W1 windowsHide + W2 `-z`. Land immediately, with tests.
2. **Wave B (additive resolution):** W3 IMPORTS probing+aliases. Measure `fixable:*` drop.
3. **Wave C (higher leverage, guarded):** W4 CALLS import-evidence — TDD against scoreboard, INFERRED provenance.
4. **Wave D (architectural):** W6 Hermes dual-runtime + W5 TS LSP provider (semantic backstop). 
5. **Wave E (polish):** W7 packet skeletonize + secondary items.
