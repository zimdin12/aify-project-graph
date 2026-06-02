# Multi-Language LSP Backends — Implementation Plan

> Execute phase by phase, tests + commit each. Spec: `docs/superpowers/specs/2026-06-02-multi-language-lsp-backends-design.md`.

**Goal:** TS/JS + Python join C++ on the LSP trust spine (live `code_intel_*` verbs + `LSP_VERIFIED` collection edges), LSP servers bundled as plugin deps.

## Phase 0 — Shared groundwork
- **0.1** `code-intel/node-bin.js`: `resolveNodeBin(name, projectRoot)` → project `node_modules/.bin` → plugin root `node_modules/.bin` → PATH. Unit test the order.
- **0.2** `code-intel/backends.js`: backend registry `{ language, spawnFor, coldTimeoutMs, providerName }` for cpp (move `cppSpawnFor` ref), typescript, python. `getBackend(language)`, `inferLanguage(file)`.
- **0.3** `code-intel/coverage.js`: `computeCoverage({ language, projectRoot, env })` dispatcher. cpp→`computeCompileDbCoverage` (unchanged), typescript→tsconfig strategy, python→dynamic caveat. Unit-test each verdict.
- **0.4** `live.js`: replace `if (language === 'cpp')` with `getBackend(language)` lookup. cpp path byte-identical.
- **0.5** Verbs (`code_intel_live.js`, `code_intel_hierarchy.js`): infer language from file ext when caller didn't pass one; call `computeCoverage({language,...})` instead of `computeCompileDbCoverage`. cpp behavior unchanged (regression-tested by existing suite).
- Commit.

## Phase 1 — TypeScript/JS backend
- **1.1** package.json: add `typescript-language-server` + `typescript` deps. `npm install`.
- **1.2** `providers/lsp-collect.js`: extract the shared collection loop from cpp-clangd (documentSymbol→def/refs/hover→records + diagnostics), parameterized.
- **1.3** `providers/ts-langserver.js`: spawnFor via `resolveNodeBin('typescript-language-server')` + `--stdio`; glob enumerate `.ts/.tsx/.js/.jsx` (skip node_modules/dist/build); freshnessBasis tsconfig hash or mtime; `collect()` via lsp-collect. Register `typescript: 'ts-langserver'`.
- **1.4** Wire backend.spawnFor + PROVIDER_BY_LANGUAGE + live-verb collect inference for typescript.
- **1.5** Tests: fake-LSP-driven references/hierarchy/collect for a tiny TS fixture; coverage strategy (tsconfig present/absent); real-server test gated on availability.
- Commit.

## Phase 2 — Python backend
- **2.1** package.json: add `pyright`. `npm install`.
- **2.2** `providers/pyright.js`: spawnFor via `resolveNodeBin('pyright-langserver')` + `--stdio`; glob `.py` (skip venv/.venv/site-packages/__pycache__); freshnessBasis mtime; `collect()` via lsp-collect. Register `python: 'pyright'`.
- **2.3** Coverage strategy already returns the dynamic caveat (Phase 0.3) — assert the verbs degrade Python to non-exhaustive.
- **2.4** Tests: fake-LSP Python fixture; python coverage always-partial verdict; real pyright test gated on availability.
- Commit.

## Phase 3 — Install / integration / docs
- **3.1** Confirm bundled binaries resolve from plugin `node_modules/.bin` post-install (resolver test + a doctor check).
- **3.2** Update `code-intel/cli/code-intel-cmd.js` doctor to report all three backends + resolution chains.
- **3.3** Update entry skills (claude-code, hermes, +codex/cursor) + server-instructions: code_intel_* / graph_collect_code_intel now support typescript + python; note Python's honest partial verdict; no host LSP config needed (bundled).
- **3.4** Full suite green; sync live claude-code skill; commit; push.

## Risks / honesty
- tsserver/pyright readiness isn't index-idle like clangd → use parse-ready (first diagnostics). Acceptable; documented.
- Python is rarely provably exhaustive — surfaced as `partial_index_coverage`, never "safe to delete". This is correct, not a defect.
- Bundle size grows (pyright ships a copy of TS). Acceptable per the provisioning decision.
