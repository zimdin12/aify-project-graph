# Code-intel provider contract (v0.2)

This document is the human-readable companion to the JSON Schemas:

- `docs/schemas/code-intel-record.v0.2.schema.json` — single record.
- `docs/schemas/code-intel-collection.v0.2.schema.json` — provider response envelope.

A code-intel provider is any tool that emits a v0.2 collection envelope from a structured collection request. APG ships `cpp-clangd` (Plan #2) and a `fixture` provider for tests. The contract is provider-neutral; SCIP/LSIF importers and analyzer-based providers must conform to the same boundary.

## Wire shape

A provider response is a single JSON object validated by `code-intel-collection.v0.2.schema.json`. Records inside `records[]` validate against `code-intel-record.v0.2.schema.json`.

Required envelope fields: `schema_version`, `collectionId`, `provider`, `providerVersion`, `projectRoot`, `session`, `operations`, `status`, `records`.

Required record fields: `schema_version`, `collectionId`, `kind`, `language`. `definition`, `reference`, and `call` records additionally require `symbolId` and `qname`. `diagnostic` records additionally require `file`, `severity`, and `message`.

## Identity and traceability

Every record carries `collectionId` so imported facts trace back to the provider run that produced them. `symbolId` is the provider-stable identifier (e.g., a clangd USR). `qname` includes the disambiguating signature where the language requires it (`ns::foo(int)` rather than `ns::foo`). `language` is required so multi-language consumers can dispatch by record.

## Path normalization

Every path in the response, JSONL records, and error fields is **repo-relative and forward-slash normalized** against `projectRoot`. Enforcement is on the provider side — the importer rejects records that violate the rule. APG ships `mcp/stdio/ingest/code-intel/paths.js` as the canonical helper.

## Status taxonomy

**Roll-up `status`:** `ok | partial | error`. `partial` is never permitted to collapse into `ok` or `error`; consumers must read per-operation status.

**Per-operation `operations.<op>.status`:** `ok | partial | not_collected | unsupported`. `partial` carries `count` and `notCollectedFiles[]`. `not_collected` carries `reason`. `unsupported` indicates the provider does not support the operation for the requested language.

**Error codes (closed set):** `provider_missing`, `compile_db_missing`, `language_unsupported`, `wrapper_failed`, `language_server_missing`, `language_server_timeout`, `internal_error`. Every error includes a `hint` string suitable for surfacing in `debug | verify | audit` packets.

## Three-state result distinction

Records carry `result_state` ∈ {`found`, `not_found_after_retry`, `not_collected`}. Consumers must distinguish all three; "no records returned" is not equivalent to any single state. Symbol-aware reference queries that come back empty on a capable target trigger one warm-and-retry pass before being persisted as `not_found_after_retry`. Empty results on a non-capable target persist as `not_collected` with a `reason`.

## Confidence

Records carry `confidence` ∈ {`high`, `medium`, `low`}. Direct call references and definitions are `high`. Virtual-call, template-instantiation, and macro-expansion contexts are at most `medium`. Text-search-derived inferences are `low` and tagged `provenance: INFERRED`, never `CODE_INTEL`. Providers may emit confidence directly or APG derives it deterministically from `(kind, context, provider)`.

## Freshness

`session.freshnessBasis` ∈ {`git_commit`, `file_mtime`, `compile_db_hash`, `unknown`} and `session.freshnessValue` together describe what the provider's freshness is anchored to. Plan #3 (graph merge + freshness) consumes these to render `code_intel=fresh|stale|partial` in briefs and packets.

## Wrapper expectations

A provider invoked through the APG wrapper command (`apg code-intel <subcommand>`, with `aify-code-intel` as PATH shim) must:

- resolve underlying tool paths project-local → bundled → global;
- exit non-zero with `wrapper_failed` rather than silently downgrading when the underlying language server is missing;
- support a `doctor` subcommand reporting tool versions and prerequisite state;
- batch-warm same-language files before diagnostic collection.

These requirements are validated in Plan #2 (C++ clangd provider).

## v1 vs v2 scope

**v1 (this contract):** capabilities, request/response, per-operation status, JSONL output, wrapper expectations, error codes, three-state results, freshness basis.

**v2 (deferred):** cross-provider deduplication (clangd + SCIP for the same fact), incremental collection deltas, multi-language session in one provider call, streaming partial results during long collections.

## Backwards compatibility

The v0.1 schema (`docs/schemas/code-intel-record.schema.json`) and the existing `d7bf17a` import path remain functional. The importer dispatches by detecting the v0.2 envelope shape (`schema_version: "0.2"` + `collectionId` + `records[]`). v0.1 callers are not affected by Plan #1.

## Wrapper CLI usage

```text
apg code-intel doctor [<language>]
apg code-intel collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>] [--since <ref>] [--operations definitions,references,diagnostics] [--json]
```

```text
apg code-intel serve-lsp <language>
```

`aify-code-intel` is a thin PATH shim that forwards to `apg code-intel` for hosts that need a top-level executable (e.g. Claude `.lsp.json`, Pi `.pi-lsp.json`).

`doctor` checks the per-language language-server binary and reports installed/missing with a fix hint. `collect` runs a provider and prints either a structured human-readable status (default) or the v0.2 collection JSON (`--json`).

`serve-lsp <language>` is a thin LSP relay — spawns the underlying language server (e.g. clangd for `cpp`) and pipes stdio between the host and the language server. APG owns the resolution chain (project-local → bundled → global) and emits explicit error exits (`language_unsupported` = 2, `language_server_missing` = 3) instead of silent downgrades. Mirrors `agent-code-intel serve-lsp <lang>` so hosts can target one stable command name regardless of which wrapper is installed.

**Downstream project templates** (drop in the root of a C++ project that uses APG):

- `docs/integrations/lsp.json.example` → copy as `.lsp.json` for Claude Code native LSP routing through `aify-code-intel serve-lsp cpp`.
- `docs/integrations/mcp.json.example` → copy as `.mcp.json` to expose APG's MCP server (graph_packet, graph_collect_code_intel, …) to Claude per-repo.
- `docs/integrations/pi-lsp.json.example` → copy as `.pi-lsp.json` for Pi native LSP routing through the same wrapper.
