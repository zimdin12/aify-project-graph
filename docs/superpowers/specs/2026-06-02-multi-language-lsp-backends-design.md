# Multi-Language LSP Backends — Design

**Date:** 2026-06-02
**Status:** approved (scoping via AskUserQuestion)
**Goal:** Extend the clangd-only "trust spine" (compiler-verified `code_intel_*` verbs + `LSP_VERIFIED` graph edges) to **TypeScript/JavaScript** and **Python**, so those repos get the same ground-truth references / hierarchy / diagnostics / `[lsp✓]` caller edges that C++ has today.

## Context: what already exists

Two layers, very different maturity:

1. **Tree-sitter extraction** (`ingest/languages/`) — ALREADY supports python, javascript, typescript, +others. Heuristic graph (`CALLS`/`IMPORTS`/symbols) already works on these repos.
2. **LSP trust spine** (`code-intel/`) — **C++/clangd only.** Powers the live `code_intel_*` verbs and the `graph_collect_code_intel` → `LSP_VERIFIED` edge path.

The `LspClient` (`code-intel/lsp-client.js`) is a **generic, capability-aware LSP JSON-RPC client** — not clangd-specific. Only the *session resolver* (`getLiveSession`, `if (language === 'cpp')`), the *collection provider registry* (`PROVIDER_BY_LANGUAGE = { cpp }`), and the *exhaustiveness gate* (`computeCompileDbCoverage`) are C++-bound.

## Decisions

- **Both languages, full parity** (live verbs + `LSP_VERIFIED` collection edges).
- **Shared groundwork first**, then both backends.
- **Provisioning: bundle the LSP servers as plugin npm deps** (`pyright`, `typescript-language-server`, `typescript`). Zero user install; resolver prefers project-local, then plugin-local, then PATH. The MCP server owns the LSP subprocess lifecycle — **the host (Claude Code / Hermes) needs no LSP configuration**; `.mcp.json` is unchanged. C++ keeps detect-or-guide (clangd isn't npm-installable).
- **Language is inferred from the file extension** in the live verbs (`.ts/.tsx/.js/.jsx → typescript`, `.py → python`, `.c/.cc/.cpp/.h… → cpp`) so agents don't have to pass `language`. Explicit `language` still wins.

## Architecture

### Backend registry (`code-intel/backends.js`, new)
A descriptor per language, replacing the hardcoded cpp branches:
```
{
  language,                       // 'cpp' | 'typescript' | 'python'
  spawnFor(projectRoot) -> {command,args}|null,
  coldTimeoutMs,
  computeCoverage({projectRoot, env}) -> { complete, reason, foreignToolchain?, unityUnexpanded?, kind } | null,
  providerName,                   // collection provider key
}
```
- `getLiveSession` looks up the backend by language and calls `spawnFor`.
- A `resolveNodeBin(name, projectRoot)` util resolves a binary: project `node_modules/.bin` → plugin `node_modules/.bin` → PATH.

### Coverage / exhaustiveness strategy (per language)
The honest "is this caller set exhaustive / safe to delete?" rule differs:
- **cpp** → existing `computeCompileDbCoverage` (compile-DB foreign/unity gate).
- **typescript** → `tsconfig.json` (or `jsconfig.json`) found → `complete:true`; none found → `complete:false` (loose mode, references undercount across untyped boundaries). `kind:'tsconfig'`.
- **python** → ALWAYS `complete:false` with a duck-typing caveat (`getattr`/dynamic dispatch/monkeypatching mean a static caller set is a floor, never provably exhaustive). `kind:'python_dynamic'`. This is the honest verdict — Python earns "lsp-partial — verify", not "safe to delete".

A `computeCoverage({ language, projectRoot, env })` dispatcher routes to the strategy; the verbs call it instead of `computeCompileDbCoverage` directly (cpp behavior byte-identical).

### Collection engine (`code-intel/providers/lsp-collect.js`, new, shared)
Factor the language-agnostic collection loop (documentSymbol → per-symbol definition/references/hover + per-file diagnostics → v0.2 records) out of cpp-clangd. Parameterized by `{ language, providerName, providerVersion, freshnessBasis, enumerateFiles, coverage }`. The cpp provider keeps its compile-DB enumeration + unity/foreign handling; ts/python providers supply a glob-based file enumeration over their extensions.

### Providers
- `providers/ts-langserver.js` — `typescript-language-server --stdio`; freshnessBasis `tsconfig_hash` (or `mtime` fallback); enumerate `.ts/.tsx/.js/.jsx` minus `node_modules`/dist.
- `providers/pyright.js` — `pyright-langserver --stdio`; freshnessBasis `mtime`; enumerate `.py` minus venv/site-packages.
Registered in `PROVIDER_BY_LANGUAGE` and the live-verb collect path.

### Readiness
clangd readiness keys on `$/progress`/`indexingEnded`. tsserver/pyright don't emit the same index-idle signal, so per-backend readiness = "target file opened AND first diagnostics published" (the parse-ready signal already implemented for the cold-prepare fix). Good enough for an honest freshness verdict; both servers analyze on-open.

## Error / honesty contract
- Missing server binary → `language_server_missing` with the resolution chain + `npm i` hint (bundle should prevent this).
- TS without tsconfig / Python always → degraded `partial_compile_db_coverage`-style cause (renamed generically `partial_index_coverage`) so the existing trust banners + `evidence.exhaustive=false` flow unchanged.
- No new false-exhaustive surface: the same coverage gate now feeds all three languages.

## Out of scope (this cut)
- Go/Rust/Java LSP backends (gopls/rust-analyzer/jdtls) — the registry makes them cheap follow-ons.
- Cross-language call edges (TS→ C++ FFI etc.).
- Incremental/watch-mode collection.

## Testing
- Unit: backend registry resolution, `resolveNodeBin` order, per-language coverage strategy verdicts, language inference from extension.
- Fake-LSP integration: the existing `fake-lsp-server.mjs` already speaks generic LSP — reuse it to drive ts/python live verbs + a collection, asserting records + `LSP_VERIFIED` edges + the per-language coverage banner.
- Real-server tests gated behind availability (like `cpp-clangd-real.test.js`): skip when the bundled binary can't start.
