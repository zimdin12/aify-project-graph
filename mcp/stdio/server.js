#!/usr/bin/env node
// Self-heal platform-mismatched better-sqlite3 before any DB-dependent
// imports load. Import for side effects only — it throws if unrecoverable.
import './preflight-native.js';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { graphStatus } from './query/verbs/status.js';
import { graphIndex } from './query/verbs/index.js';
import { graphWatch } from './query/verbs/watch.js';
import { graphLookup } from './query/verbs/lookup.js';
import { graphWhereis } from './query/verbs/whereis.js';
import { graphCallers } from './query/verbs/callers.js';
import { graphCallees } from './query/verbs/callees.js';
import { graphNeighbors } from './query/verbs/neighbors.js';
import { graphModuleTree } from './query/verbs/module_tree.js';
import { graphImpact } from './query/verbs/impact.js';
import { graphSummary } from './query/verbs/summary.js';
import { graphHealth } from './query/verbs/health.js';
import { graphConsequences } from './query/verbs/consequences.js';
import { graphExplainDiff } from './query/verbs/explain_diff.js';
import { graphReport } from './query/verbs/report.js';
import { graphPath } from './query/verbs/path.js';
import { graphDashboard } from './query/verbs/dashboard.js';
import { graphSearch } from './query/verbs/search.js';
import { graphFile } from './query/verbs/file.js';
import { graphShader } from './query/verbs/shader.js';
import { graphPreflight } from './query/verbs/preflight.js';
import { graphChangePlan } from './query/verbs/change_plan.js';
import { graphOnboard } from './query/verbs/onboard.js';
import { graphTour } from './query/verbs/tour.js';
import { graphPull } from './query/verbs/pull.js';
import { graphFind } from './query/verbs/find.js';
import { graphPacket } from './query/verbs/packet.js';
import { graphTrace } from './query/verbs/trace.js';
import { graphExplore } from './query/verbs/explore.js';
import { graphCollectCodeIntel } from './query/verbs/collect_code_intel.js';
import {
  graphOverview,
  graphHotspots,
  graphCycles,
  graphDigest,
} from './query/verbs/analytics_verbs.js';
import { checkRequestSize, MAX_MCP_LINE_BYTES } from './security/request-size.js';
import { findSensitivePathArg } from './security/sensitive-paths.js';
import { SERVER_INSTRUCTIONS } from './server-instructions.js';
import { shutdownAllSessions } from './code-intel/live.js';
import {
  codeIntelDiagnostics,
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
  codeIntelSymbols
} from './query/verbs/code_intel_live.js';
import { codeIntelReplay } from './query/verbs/code_intel_replay.js';
import { codeIntelAnalyze } from './query/verbs/code_intel_analyze.js';
import { codeIntelHierarchy } from './query/verbs/code_intel_hierarchy.js';

const TOOLS = [
  // ── Administrative ───────────────────────────────────────────
  {
    name: 'graph_status',
    handler: graphStatus,
    description: 'Return graph status: indexed, counts, dirty files, unresolved edges, schemaVersion. See docs/schema-versions.md for schemaVersion meaning.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'graph_index',
    handler: graphIndex,
    description: 'Build or rebuild the graph. force=true does a full rebuild.',
    schema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false, description: 'Full rebuild from scratch.' },
      },
    },
  },
  {
    name: 'graph_watch',
    handler: graphWatch,
    description: 'Native file watcher (FSEvents/inotify/ReadDirectoryChangesW) with debounced auto-reindex. enable=true starts; enable=false stops; omit to read current state. Edits coalesce into one trailing graph_index() call per debounce window (default 1500ms). WSL /mnt/* disabled by default. Returns {status, reason, running, debounceMs, lastRunAt, lastError, eventsQueued}. Explicit verb only — no auto-enable.',
    schema: {
      type: 'object',
      properties: {
        enable: { type: 'boolean', description: 'true to start, false to stop, omit to read current state.' },
        debounceMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Override the default 1500ms debounce window for coalescing burst events into a single reindex.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'graph_health',
    handler: graphHealth,
    description: 'Single-call "is the graph usable right now?" check. Aggregates indexed state, trust level, unresolved-edge count, staleness (indexed commit vs HEAD), and overlay validity into one summary string + structured fields. Use at session start instead of stringing graph_status + graph_index + brief.plan.md parsing.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'graph_packet',
    handler: graphPacket,
    description: 'PRIMARY for task/feature/symbol context — prefer over stringing graph_pull + graph_consequences. Compact one-shot agent prompt packet for a feature or task. For feature/task targets, reads overlay (functionality.json + tasks.json) + brief.json directly — no ensureFresh, no SQL, sub-millisecond static path. Bare symbol targets use one budgeted consequences lookup to map symbol→feature; a symbol that is known to the graph but maps to no feature (or is ambiguous) degrades to a compact SYMBOL packet (DEFINED IN / CANDIDATES + read-next pointers) instead of erroring. Returns fixed-schema markdown: TASK/FEATURE → MODE → STATUS → FEATURES → SNAPSHOT → READ FIRST → CONTRACTS → TESTS → RISKS → LIVE. mode=verify is a post-edit decision packet and does not require target — pass files[]/since instead. Target: <500-900 tokens. Use INSTEAD of stringing graph_pull + graph_consequences + tasks/functionality.json reads when you just need the action-bearing context to start work. Pass mode=orient|plan|debug|review|audit|verify to shape section caps and risk hints. Pass live=true to opt into the slower live-enrichment path.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'feature:<id> | task:<id> | bare id | bare symbol (not required for mode=verify)' },
        mode: { type: 'string', enum: ['orient', 'plan', 'debug', 'review', 'audit', 'verify'], default: 'orient', description: 'Workflow mode. Shapes section caps and risk hints without changing the underlying graph truth. verify = post-edit decision packet (changed files, diagnostics, freshness, SOURCE_REQUIRED).' },
        budget: { type: 'integer', description: 'Token budget for the rendered packet. Omit for a repo-size-adaptive default (bigger repos → bigger budget); set to override.' },
        live: { type: 'boolean', default: false, description: 'Opt into live enrichment block (slower; lands fully in M3 with readOnly verb mode).' },
        since: { type: 'string', description: 'verify mode: git ref to diff against for changed files.' },
        files: { type: 'array', items: { type: 'string' }, description: 'verify mode: explicit changed files (repo-relative).' },
        audited: { type: 'boolean', default: false, description: 'verify mode: change touches audited code; surface SOURCE_REQUIRED warning.' },
        analyze: { type: 'boolean', default: false, description: 'verify mode: also run bounded C++ analyzer/build evidence for files[] via code_intel_analyze.' },
        analyzeMode: { type: 'string', enum: ['clang-tidy', 'compile'], default: 'clang-tidy', description: 'verify mode analyzer flavor when analyze=true.' },
        analyzeTimeoutMs: { type: 'integer', minimum: 1, maximum: 600000, default: 120000, description: 'verify mode analyzer timeout when analyze=true.' },
      },
    },
  },
  // ── Bounded live code-intel verbs (Plan #6) ─────────────────
  // Drive clangd live for atomic C++ questions during inner-loop editing.
  // No collect/import round-trip. Fast, bounded JSON responses. Use these
  // instead of `graph_collect_code_intel` when the agent just needs the
  // answer to one symbol or one file question.
  {
    name: 'code_intel_diagnostics',
    handler: codeIntelDiagnostics,
    description: 'Live per-file diagnostics. Drives the language server (clangd / typescript-language-server / pyright, by file extension) directly — no collect/import round-trip. Batch-warms requested files (one longer warm-up on a cold session). Per-file wait defaults to 3000ms so cold clangd does not return empty first-call diagnostics. Returns {status, files:[{file,freshness,diagnostics}], diagnostics:[{file,severity,message,range}], telemetry:{diagnosticsWaitMs,...}, noValueAdded?}. noValueAdded is only set when every file is explicitly stale/timeout, never on unknown. Use after editing C++ to check for errors without running a build.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files to check.' },
        diagnosticsWaitMs: { type: 'integer', minimum: 0, maximum: 30000, default: 3000, description: 'Per-file wait for a fresh diagnostics publish. Raise for very cold/large projects; 0 = best-effort no-wait.' },
        warmupMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Override the post-open settle. Omit to auto-pick (longer when the session is cold, short when warm).' }
      },
      required: ['files']
    },
  },
  {
    name: 'code_intel_references',
    handler: codeIntelReferences,
    description: 'Live symbol-aware references at a file:line:col position. Symbol-aware via the language server — clangd (C/C++), typescript-language-server (TS/JS), or pyright (Python), auto-selected by file extension; NOT text search. Returns {status, freshness, result_state, warmedFiles, references[] (compat, full LSP shape), referenceLocations[] (non-declaration callsites only), definitionLocations[] (declaration entries split out), evidence:{ready,degraded,cause,confidence,fallback,exhaustive,warnings}, telemetry, noValueAdded? (deprecated compat shim)}. CONTRACT: trust absence claims ("no callers", "dead code") ONLY when evidence.exhaustive===true. Degraded causes: cold_index|timeout|unsupported|definition_only|stale_index|unknown — read evidence.fallback for the recovery action. Pass warmupFiles[] (known callers, headers) when background-index is disabled and cross-TU resolution is needed.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        file: { type: 'string', description: 'Repo-relative file containing the symbol.' },
        line: { type: 'integer', minimum: 1, description: '1-based line number.' },
        col: { type: 'integer', minimum: 1, default: 1, description: '1-based column number.' },
        warmupFiles: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files to open before the references query so clangd considers them as candidate callers.' },
        warmupMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Override the post-open settle. Omit to auto-pick (longer when the session is cold, short when warm).' },
        waitForReadyMs: { type: 'integer', minimum: 0, maximum: 30000, default: 0, description: 'Optional inline wait for LSP indexing readiness before the semantic request; returns freshness fresh/stale/unknown.' }
      },
      required: ['file', 'line']
    },
  },
  {
    name: 'code_intel_definitions',
    handler: codeIntelDefinitions,
    description: 'Live definitions across TUs for a symbol at a position. Pass warmupFiles[] when the definition lives in a TU clangd has not seen yet (background-index disabled). Returns {status, freshness, warmedFiles, definitions[], evidence:{ready,degraded,cause,confidence,fallback,exhaustive,warnings}, telemetry, noValueAdded? (deprecated compat shim)}. CONTRACT: evidence.exhaustive===true means this is THE definition (no degraded cause masking a missing one). Degraded causes: cold_index|timeout|stale_index|unknown.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        file: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        col: { type: 'integer', minimum: 1, default: 1 },
        warmupFiles: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files to open before the definitions query for cross-TU resolution.' },
        warmupMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Override the post-open settle. Omit to auto-pick (longer when the session is cold, short when warm).' },
        waitForReadyMs: { type: 'integer', minimum: 0, maximum: 30000, default: 0, description: 'Optional inline wait for LSP indexing readiness before the semantic request; returns freshness fresh/stale/unknown.' }
      },
      required: ['file', 'line']
    },
  },
  {
    name: 'code_intel_hover',
    handler: codeIntelHover,
    description: 'Live hover content (type signature + docstring) at a position. Pass warmupFiles[] when the declaration lives in a TU clangd has not seen yet. Returns {status, freshness, warmedFiles, hover:{content,range,provenance,confidence}, telemetry, noValueAdded?}.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        file: { type: 'string' },
        line: { type: 'integer', minimum: 1 },
        col: { type: 'integer', minimum: 1, default: 1 },
        warmupFiles: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files to open before the hover query for cross-TU declaration resolution.' },
        warmupMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Override the post-open settle. Omit to auto-pick (longer when the session is cold, short when warm).' },
        waitForReadyMs: { type: 'integer', minimum: 0, maximum: 30000, default: 0, description: 'Optional inline wait for LSP indexing readiness before the semantic request; returns freshness fresh/stale/unknown.' }
      },
      required: ['file', 'line']
    },
  },
  {
    name: 'code_intel_replay',
    handler: codeIntelReplay,
    description: 'Query parent-session-collected v0.2 facts WITHOUT spawning clangd. For subagents (or any context) that should read evidence the parent imported via graph_collect_code_intel rather than re-running the language server. Reads only. Filters by collectionId/symbol/file/kind/limit. Provenance tagged CODE_INTEL_REPLAY so callers know the answer is replayed, not live. Returns {status, collectionId, result_state, records, summary, provenance}. Per reference a3f0fde parent-session pattern.',
    schema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', default: 'latest', description: 'Collection to query. "latest" picks the most recent import.' },
        symbol: { type: 'string', description: 'Filter by qname or symbolId (e.g. "ns::foo(int)").' },
        file: { type: 'string', description: 'Filter by repo-relative file.' },
        kind: { type: 'string', enum: ['references', 'definitions', 'hover', 'diagnostics', 'symbols', 'all'], default: 'all' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 20 }
      },
    },
  },
  {
    name: 'code_intel_analyze',
    handler: codeIntelAnalyze,
    description: 'Bounded C++ analyzer/build evidence for explicit files. Runs clang-tidy or a compile_commands.json syntax check; never scans the whole repo by default. Returns {status, mode, files, diagnostics:[{file,line,col,severity,message,provenance}], summary, telemetry}. Use after clangd when you need analyzer/build facts beyond plain LSP.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        mode: { type: 'string', enum: ['clang-tidy', 'compile'], default: 'clang-tidy' },
        files: { type: 'array', items: { type: 'string' }, description: 'Explicit repo-relative C/C++ files to analyze. Required; broad scans are intentionally unsupported.' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 600000, default: 120000 }
      },
      required: ['files']
    },
  },
  {
    name: 'code_intel_symbols',
    handler: codeIntelSymbols,
    description: 'Live document symbol outline for one file. Returns {status, file, symbols:[{name,kind,range,selectionRange}]}. Use to scan a file structure without reading it.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        file: { type: 'string' }
      },
      required: ['file']
    },
  },
  {
    name: 'code_intel_hierarchy',
    handler: codeIntelHierarchy,
    description: 'Live CALL HIERARCHY + TYPE HIERARCHY (clangd / typescript-language-server / pyright, by file extension) — the "who calls this (transitively) / who overrides this virtual / what subtypes exist" answer that flat references cannot give. kind=callers|callees walks prepareCallHierarchy → incoming/outgoing to depth (default 2) as an indented TREE with file:line per hop; kind=subtypes|supertypes walks type hierarchy (virtual-override / inheritance sets). Resolves the symbol via explicit file+line(+col) OR a bare symbol name through the graph. In INDEXED mode (default) it WAITS for clangd index-ready so the tree is exhaustive; in BOUNDED mode (APG_CLANGD_MODE=bounded) it skips the wait. Returns {status, kind, anchor, mode, indexReady, tree, treeText (indented, each hop marked [lsp✓]), trust (TRUST: lsp-verified (index-ready) vs lsp-partial (NOT ready — may undercount)), evidence:{ready,degraded,cause,confidence,exhaustive,fallback,warnings}, telemetry}. CONTRACT: trust "no overriders"/"no transitive callers" ONLY when evidence.exhaustive===true. Output is depth/breadth-capped with a "TRUNCATED — N more" tail. Use for C++ virtual dispatch + fn-pointer hubs where the static graph undercounts.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Optional — auto-inferred from the file extension (.cpp/.h→cpp, .ts/.tsx/.js→typescript, .py→python); explicit value wins. Servers (clangd/typescript-language-server/pyright) are bundled; the host needs no LSP config.' },
        kind: { type: 'string', enum: ['callers', 'callees', 'subtypes', 'supertypes'], description: 'callers/callees → call hierarchy; subtypes/supertypes → type/override hierarchy.' },
        file: { type: 'string', description: 'Repo-relative file containing the symbol (with line; alternative to symbol).' },
        line: { type: 'integer', minimum: 1, description: '1-based line of the symbol.' },
        col: { type: 'integer', minimum: 1, default: 1, description: '1-based column of the symbol token.' },
        symbol: { type: 'string', description: 'Bare symbol name; resolved to file:line via the graph when file+line are omitted.' },
        depth: { type: 'integer', minimum: 1, maximum: 5, default: 2, description: 'How many hops to walk (transitive depth). Capped at 5.' },
        breadthCap: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'Max children rendered per node.' },
        totalCap: { type: 'integer', minimum: 1, maximum: 1000, default: 200, description: 'Hard ceiling on total tree nodes.' },
        waitForReadyMs: { type: 'integer', minimum: 0, maximum: 600000, description: 'INDEXED-mode index-readiness wait budget; omit to use APG_CLANGD_INDEX_WAIT_MS (default 90000).' }
      },
      required: ['kind']
    },
  },
  {
    name: 'graph_collect_code_intel',
    handler: graphCollectCodeIntel,
    description: 'Run a code-intel provider (e.g. cpp-clangd) and import the resulting v0.2 collection into the local graph. Public action verb — agents and bridge UI both call this. Never auto-runs; explicit only. Returns the v0.2 collection envelope (status, errors, records). On success the collection is imported and immediately visible to graph_health.codeIntel, graph_pull(layers:["code_intel"]), and graph_packet EVIDENCE blocks. Use after touching code that needs compiler-backed precision (C++ templates, virtual dispatch, macros). COLD-START: the first collect on a fresh clangd index is time-budgeted (default ~40s) and may return status:"partial" with session.budgetExhausted=true and a resume note — the index now persists, so just call graph_collect_code_intel AGAIN to continue/complete (the warm run is fast). language is optional: inferred from files[] extensions or repo markers (.cpp/.h → cpp/clangd, .ts/.tsx/.js → typescript/typescript-language-server, .py → python/pyright; tsconfig.json / pyproject.toml / compile_commands.json detected for scope=all), else defaults to "cpp". Python is never provably exhaustive (dynamic dispatch) — its records are a verified floor.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Language to collect for: "cpp" | "typescript" | "javascript" | "python". Provider auto-selected (cpp-clangd / ts-langserver / pyright). Optional — inferred from files[] extensions or repo markers (tsconfig/pyproject/compile_commands) when omitted, else "cpp".' },
        scope: { type: 'string', enum: ['changed', 'files', 'all'], default: 'changed', description: 'Collection scope. "changed" derives files from `since`; "files" uses explicit files[]; "all" enumerates from compile_commands.json.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Explicit files to collect (repo-relative). Required when scope="files".' },
        since: { type: 'string', description: 'Git ref for "changed" scope; collects files modified since this ref.' },
        operations: { type: 'array', items: { type: 'string', enum: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'] }, description: 'Operations to run. Defaults to [definitions, references, diagnostics].' },
        budgetMs: { type: 'integer', minimum: 1, maximum: 600000, description: 'Total wall-clock budget for this collect (default 40000, or APG_COLLECT_BUDGET_MS). On a COLD clangd index the call returns status:"partial" with session.budgetExhausted=true + a resume note instead of blocking past the MCP host timeout; the index now persists, so a second collect runs warm/fast. Set higher to wait longer for the cold index.' },
      },
    },
  },
  {
    name: 'graph_consequences',
    handler: graphConsequences,
    description: 'Cross-layer traversal: "what breaks if I touch X?" Input: symbol name OR file path. Output: contracts potentially affected, features touching this symbol, open tasks on those features, adjacent tests, last-touched git history, risk flags. Use BEFORE planning a non-trivial change — it produces the grounding set an editor-agent actually needs. Flagship verb for cross-cutting planning and pre-edit safety checks.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Symbol name or repo-relative file path.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'graph_explain_diff',
    handler: graphExplainDiff,
    description: 'Explain an EXISTING change/diff (reverse of graph_consequences). Keyed on a git range — NOT a symbol. Input: range (e.g. "main...HEAD", "HEAD~3", "<sha>~1..<sha>") OR staged=true OR files[]; defaults to uncommitted working-tree changes. Output: CHANGED (files → symbols the diff touched), AFFECTED 1-hop (callers/dependents grouped by file, [lsp✓] where clangd-verified), LAYERS (architecture layers the change spans — cross-layer = higher risk), RISK (labeled heuristic score: cross-layer × fan-out × contract/test signals), TESTS (adjacent coverage). Carries the LSP-vs-heuristic trust banner. Use when reviewing/triaging a PR or an already-made change to see its blast radius. Pass overlay=true to also emit .aify-graph/diff-overlay.json for the dashboard blast-radius highlight.',
    schema: {
      type: 'object',
      properties: {
        range: { type: 'string', description: 'Git rev range understood by `git diff` — "main...HEAD", "HEAD~3", "<sha>~1..<sha>", a bare sha, etc. Omit for working-tree (uncommitted) changes.' },
        staged: { type: 'boolean', default: false, description: 'Explain the staged (index) diff instead of working tree. Ignored when range or files[] is given.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Explicit repo-relative changed-file list. Overrides range/staged/working-tree resolution.' },
        overlay: { type: 'boolean', default: false, description: 'Also write .aify-graph/diff-overlay.json ({changedNodeIds, affectedNodeIds}) for the dashboard blast-radius highlight (P2-2).' },
        top_k: { type: 'integer', default: 30, description: 'Max affected-file groups returned.' },
      },
    },
  },
  {
    name: 'graph_dashboard',
    handler: graphDashboard,
    description: 'Open the interactive graph browser. Returns {url, port}.',
    schema: {
      type: 'object',
      properties: {
        port: { type: 'integer', description: 'Port to listen on.' },
      },
    },
  },

  // ── Discovery ────────────────────────────────────────────────
  {
    name: 'graph_lookup',
    handler: graphLookup,
    description: 'Legacy exact symbol lookup. Returns file:line citations. Prefer graph_whereis for richer exact-name results.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Exact symbol name.' },
        limit: { type: 'integer', default: 5, description: 'Max matches.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_report',
    handler: graphReport,
    description: 'Repo orientation: stats, entrypoints, hubs, communities. Use first on unfamiliar repos.',
    schema: {
      type: 'object',
      properties: {
        top_k: { type: 'integer', default: 20, description: 'Max items per section.' },
      },
    },
  },
  {
    name: 'graph_digest',
    handler: graphDigest,
    description: 'PRIMARY repo orientation. Token-budgeted PROJECT DIGEST — the dashboard\'s whole analytic value in ~1-2k tokens: layers/communities, god-node hotspots, shader-binding + provenance %, tightest import cycles, community bridges. The ONE analytics front door — composes graph_overview/graph_hotspots/graph_cycles. Call FIRST to orient on an unfamiliar repo.',
    schema: {
      type: 'object',
      properties: {
        budget: { type: 'integer', default: 6000, description: 'Approx character budget (~budget/4 tokens). Trailing sections drop first under budget.' },
      },
    },
  },
  {
    name: 'graph_overview',
    handler: graphOverview,
    description: 'Cluster map: communities (Leiden) → architecture-layer → top-dir, with node counts, top symbols by degree, and aggregated inter-cluster edges. The legible front door at repo scale.',
    schema: {
      type: 'object',
      properties: {
        top_k: { type: 'integer', default: 12, description: 'Max clusters to show (largest first).' },
      },
    },
  },
  {
    name: 'graph_hotspots',
    handler: graphHotspots,
    description: 'God nodes: top-N symbols by in+out degree (with file + type + noise denylist). The high-blast-radius symbols to approach carefully.',
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 15, description: 'Max hotspots.' },
      },
    },
  },
  {
    name: 'graph_cycles',
    handler: graphCycles,
    description: 'File-level import/include CYCLES (tightest first), via Tarjan SCC + bounded simple-cycle enumeration with rotation-dedup. Honestly reports "none found" when the import graph is acyclic.',
    schema: {
      type: 'object',
      properties: {
        max_len: { type: 'integer', default: 5, description: 'Max cycle length to enumerate (bounded to cap search).' },
        top_k: { type: 'integer', default: 20, description: 'Max cycles to return.' },
      },
    },
  },
  {
    name: 'graph_search',
    handler: graphSearch,
    description: 'Symbol search. mode="lexical" (default) = partial-name match; mode="semantic" = find code by MEANING (needs an embeddings sidecar — opt-in; degrades to lexical + a hint when absent). Prefer graph_whereis for exact names.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial symbol name, or a natural-language description in semantic mode.' },
        mode: { type: 'string', enum: ['lexical', 'semantic'], default: 'lexical', description: 'lexical = name match; semantic = embedding similarity (find by meaning).' },
        kind: { type: 'string', enum: ['code', 'all'], default: 'code', description: 'code or all node kinds.' },
        type: { type: 'string', description: 'Optional node type filter.' },
        file: { type: 'string', description: 'Optional file path prefix.' },
        limit: { type: 'integer', default: 20, description: 'Max results.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_whereis',
    handler: graphWhereis,
    description: 'Exact symbol definition lookup. Prefer this for known names. Use expand=true for top incoming/outgoing edges.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Exact symbol name.' },
        limit: { type: 'integer', default: 5, description: 'Max matches.' },
        expand: { type: 'boolean', default: false, description: 'Include top incoming/outgoing edges.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_module_tree',
    handler: graphModuleTree,
    description: 'Directory/file/symbol tree under a path.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Repo-relative directory path.' },
        depth: { type: 'integer', default: 2, description: 'Tree depth.' },
        top_k: { type: 'integer', default: 30, description: 'Max nodes.' },
      },
    },
  },

  // ── File-level ───────────────────────────────────────────────
  {
    name: 'graph_file',
    handler: graphFile,
    description: 'One-file digest: definitions, imports, callers, callees, tests.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path or prefix.' },
        top_k: { type: 'integer', default: 20, description: 'Max items per section.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'graph_shader',
    handler: graphShader,
    description: 'C++<->GLSL shader-binding bridge: descriptor binding table, C++ loaders, GLSL includes, heuristic binding contract. Static (no clangd).',
    schema: {
      type: 'object',
      properties: {
        shader: { type: 'string', description: 'Shader file path or basename (e.g. "cas.comp.glsl"). Omit to list shaders that have bindings.' },
        binding: { type: 'string', description: "Optional 'set.binding' (e.g. '0.1') or bare binding number to focus on one binding." },
        top_k: { type: 'integer', default: 40, description: 'Max items per section.' },
      },
    },
  },
  {
    name: 'graph_change_plan',
    handler: graphChangePlan,
    description: 'Change brief for a symbol: risk, callers, deps, tests, read order.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to change.' },
        top_k: { type: 'integer', default: 6, description: 'Max recommendations.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_onboard',
    handler: graphOnboard,
    description: 'Onboarding brief for a repo or subtree: entrypoints, key files, hubs, tests, read order.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Repo-relative path.' },
        top_k: { type: 'integer', default: 6, description: 'Max items per section.' },
      },
    },
  },
  {
    name: 'graph_tour',
    handler: graphTour,
    description: 'Ordered "explore this codebase in N steps" tour: entrypoints → archetype regions (Physics/Rendering/…) → hotspots → cross-subsystem flows. Read top-to-bottom, then drill with graph_packet. focus narrows to one subsystem.',
    schema: {
      type: 'object',
      properties: {
        steps: { type: 'integer', default: 8, description: 'Max number of tour steps.' },
        focus: { type: 'string', description: 'Narrow the tour to one archetype/subsystem (e.g. "physics", "rendering").' },
      },
    },
  },

  // ── Analysis ─────────────────────────────────────────────────
  {
    name: 'graph_preflight',
    handler: graphPreflight,
    description: 'Edit safety check: location, callers, impact, tests, trust, decision.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to edit.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_callers',
    handler: graphCallers,
    description: 'Incoming execution edges for a symbol. Includes CALLS, INVOKES, PASSES_THROUGH. For transitive + LSP-exhaustive results use code_intel_hierarchy.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Target symbol.' },
        depth: { type: 'integer', default: 1, description: 'Hop depth.' },
        top_k: { type: 'integer', default: 10, description: 'Max edges.' },
        file: { type: 'string', description: 'Optional file or dir prefix.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_callees',
    handler: graphCallees,
    description: 'Outgoing execution edges for a symbol. Includes CALLS, INVOKES, PASSES_THROUGH.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Source symbol.' },
        depth: { type: 'integer', default: 1, description: 'Hop depth.' },
        top_k: { type: 'integer', default: 10, description: 'Max edges.' },
        file: { type: 'string', description: 'Optional file or dir prefix.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_neighbors',
    handler: graphNeighbors,
    description: 'Nearby edges for a symbol, optionally filtered by edge type.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to explore.' },
        edge_types: { type: 'array', items: { type: 'string' }, default: [], description: 'Optional edge type filter.' },
        depth: { type: 'integer', default: 1, description: 'Hop depth.' },
        top_k: { type: 'integer', default: 20, description: 'Max edges.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_impact',
    handler: graphImpact,
    description: 'Transitive blast radius for a symbol across calls, refs, and tests. For transitive + LSP-exhaustive results use code_intel_hierarchy.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to analyze.' },
        depth: { type: 'integer', default: 3, description: 'Transitive depth.' },
        top_k: { type: 'integer', default: 30, description: 'Max edges.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_path',
    handler: graphPath,
    description: 'Readable path trace from a symbol. execution=CALLS/INVOKES/PASSES_THROUGH; dependency=broader. For transitive + LSP-exhaustive results use code_intel_hierarchy.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Start symbol.' },
        direction: { type: 'string', enum: ['out', 'in'], default: 'out', description: 'Trace forward or backward.' },
        depth: { type: 'integer', default: 5, description: 'Max path depth.' },
        top_k: { type: 'integer', default: 3, description: 'Max branches per node.' },
        mode: { type: 'string', enum: ['execution', 'dependency'], default: 'execution', description: 'execution or dependency mode.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_trace',
    handler: graphTrace,
    description: 'PRIMARY for "show me the whole call path from A to B" — the entire trace in ONE call, each hop\'s BODY inlined verbatim (cat -n, treat as already Read; do NOT re-Read shown files). BFS the call graph (CALLS/INVOKES/PASSES_THROUGH) + follows OVERRIDDEN_BY to bridge C++ virtual dispatch; dynamic-dispatch hops annotated [virtual/override — INFERRED], clangd-verified hops marked [lsp✓]. Capped at max_hops (a confident-but-wrong long trace is worse than none). On FAILURE (no static path — the chain usually broke at dynamic dispatch) it does NOT 404: it inlines BOTH endpoint bodies + their callers/callees + the destination file\'s other top-level functions (where the missing hop usually lives). Ambiguous names paired by path-proximity. Use INSTEAD of repeated graph_callees/graph_path + Read calls to follow a flow.',
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source symbol (Class::method / Namespace::Class::method / bare name).' },
        to: { type: 'string', description: 'Destination symbol to reach.' },
        max_hops: { type: 'integer', default: 7, description: 'Max BFS hops (1-15). Longer traces are rejected rather than guessed.' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'graph_explore',
    handler: graphExplore,
    description: 'PRIMARY for "show me the source of these N symbols" — returns Read-equivalent verbatim source for a BAG of symbol/file names in ONE budget-capped call, grouped by file, cat -n line numbers, "treat as already Read" framing. Do NOT re-Read the files it shows. Input is a list of names (NOT a question). Repo-size-scaled budget; caps files/symbols and emits a "TRUNCATED — N more (narrow your list)" tail when over budget; large repos also get a compact RELATIONSHIPS section among the requested symbols. Use INSTEAD of N separate Read calls when you just need to see several symbols\' bodies. For the full call PATH between two symbols use graph_trace.',
    schema: {
      type: 'object',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: 'Bag of symbol and/or file names to bundle verbatim.' },
        max_files: { type: 'integer', description: 'Optional cap on the number of file groups returned (clamped to the repo-size tier cap).' },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'graph_summary',
    handler: graphSummary,
    description: 'Compact symbol digest. Prefer graph_whereis(expand=true).',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to summarize.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_pull',
    handler: graphPull,
    description: 'Cross-layer pull for a node (file, feature, symbol, or task). Default layers: code+functionality+tasks+activity. Opt-in layers: docs (MENTIONS edges), relations (direct graph neighbors — callers/callees/imports/cross-feature inputs-outputs), transitive (feature-only: closure of depends_on up and/or down + anchored files for each). For transitive, pass direction="downstream"|"upstream"|"both" (default both).',
    schema: {
      type: 'object',
      properties: {
        node: { type: 'string', description: 'File path, feature id, symbol name, or task id.' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['code', 'functionality', 'tasks', 'docs', 'activity', 'relations', 'transitive'] },
          description: 'Optional layer filter. Defaults to code+functionality+tasks+activity.',
        },
        direction: {
          type: 'string',
          enum: ['downstream', 'upstream', 'both'],
          description: 'For transitive layer: walk direction. Default both.',
        },
      },
      required: ['node'],
    },
  },
  {
    name: 'graph_find',
    handler: graphFind,
    description: 'Cross-layer disambiguator: one query returns matches across code + features + tasks + docs in one ranked response. Use when you want to know "what does X refer to across layers?" — NOT as an rg replacement for text search (rg is faster for pure code text).',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term.' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['code', 'features', 'tasks', 'docs'] },
          description: 'Optional layer filter. Defaults to all four.',
        },
        limit: { type: 'integer', default: 10, description: 'Max hits per layer + flat top-N.' },
        fresh: { type: 'boolean', default: false, description: 'Run ensureFresh before searching (slower, catches uncommitted changes).' },
      },
      required: ['query'],
    },
  },
];

// 2026-04-26: every tool accepts an optional `repo` arg that overrides
// the MCP server's process.cwd(). Handler at line 536 already routes it
// to repoRoot; we only need to declare it in JSON Schema so agents can
// discover and pass it. Critical for sessions launched from a non-repo
// cwd (home dir, scratch dir) where every live verb otherwise returns
// trust=missing. Found by 2026-04-26 echoes A/B test contamination.
const REPO_ARG_SCHEMA = {
  type: 'string',
  description: 'Optional absolute path to the target repo. Use when the MCP server was not launched from inside the repo (e.g. from your home dir). Defaults to the server\'s process.cwd().',
};
for (const tool of TOOLS) {
  if (!tool.schema) tool.schema = { type: 'object', properties: {} };
  if (!tool.schema.properties) tool.schema.properties = {};
  if (!tool.schema.properties.repo) tool.schema.properties.repo = REPO_ARG_SCHEMA;
}

// Lean profile (v3, 2026-04-22): redesigned from the old impact/path/plan
// trio after the combined v1+v2 Codex + Claude bench feedback showed:
// - `graph_consequences` was the consistently highest-rated live planning verb
// - `graph_pull` carried the overlay-dependent wins briefs couldn't answer alone
// - `graph_change_plan` was the only old lean verb with repeat positives
// Evidence: docs/dogfood/ab-results-2026-04-20-cross-tester.md and manager's
// v1+v2 lean-half post-mortem notes. Hidden verbs remain callable via tools/call.
// Note: lean grew 3→5 across two refinements to the 2026-04-25 v2
// upgrade plan. graph_packet is the new flagship one-shot primitive
// (feature/task targets read overlay+brief directly, no ensureFresh/no SQL;
// bare-symbol fallback may do one budgeted mapping lookup); change_plan
// stays visible until packet is measured as a full substitute;
// graph_health was added (M4a alignment) because the skill heavily
// recommends it as the fastest health check and it was previously
// callable but not visible — discoverability mismatch surfaced by
// the validation gate.
const LEAN_TOOL_NAMES = new Set([
  'graph_packet',
  'graph_consequences',
  'graph_pull',
  'graph_change_plan',
  'graph_health',
  // Review-fix #7: graph_watch is the agent-facing primitive for enabling
  // the file-watcher → auto-reindex hook (Plan #18 A). Hiding it from the
  // lean profile's tools/list would make every lean-runtime agent unable
  // to discover the verb even though it's the documented opt-in path.
  'graph_watch',
]);

// DEFAULT profile (P4-1, 2026-05-31): the ACTUAL default `tools/list` surface
// when no `--toolset`/AIFY_GRAPH_PROFILE is set. The Hermes tech-lead's
// finish-line point: ~40 verbs is fine as an EXPERT/full API but too many as
// the agent's DEFAULT affordance — agents under-pick from big lists. So we GATE
// the listing (not delete the verbs): the default surface is the ~15 intent
// verbs an agent actually reaches for. `full` becomes an explicit opt-in that
// lists everything (minus HIDDEN_FULL). Every verb here AND every verb not here
// stays CALLABLE via tools/call regardless of profile — gating = listing only.
//
// The set is Hermes-TL's list, refined: the primary cross-layer planning verbs
// (packet/pull/consequences), the traversal verbs (callers/impact/trace/
// explore), diff explanation, the ONE analytics front door (digest), locators
// (search/whereis), the health check, and the code-intel front (collect +
// references + hierarchy). Everything else (callees/neighbors/path/shader/file/
// onboard/status/index/watch/dashboard/overview/hotspots/cycles/change_plan/
// preflight/module_tree/report/summary/lookup + the code_intel long-tail) stays
// callable but unlisted by default.
const DEFAULT_TOOL_NAMES = new Set([
  'graph_packet',
  'graph_pull',
  'graph_consequences',
  'graph_callers',
  'graph_impact',
  'graph_trace',
  'graph_explore',
  'graph_explain_diff',
  'graph_digest',
  'graph_search',
  'graph_whereis',
  'graph_health',
  'graph_collect_code_intel',
  'code_intel_references',
  'code_intel_hierarchy',
  // Listed so managed workers can SELF-REFRESH a stale graph. The 2026-06-01
  // Sand Castle A/B found a stale graph is worse than none for workers who get
  // the read verbs but not graph_index — they couldn't act on the "run
  // graph_index" staleness warning because it wasn't in their surface.
  'graph_index',
  // Listed so "open/show me the graph" is ONE verb call ({url,port}, keeps
  // serving) instead of agents hand-rolling a server launcher when the verb was
  // unlisted (2026-06 field report).
  'graph_dashboard',
]);

// Full profile still keeps EVERY verb callable by name, but the tools/list
// surface hides the redundant + long-tail verbs so the listed set reads as ONE
// coherent product instead of a 37-verb salience wall (R2 cohesion fix). Hidden
// verbs are still invokable via tools/call — this trims the passive manifest
// tax only. Three buckets:
//   1. Legacy locator aliases briefs replaced (lookup, summary, report).
//   2. Planning verbs redundant with graph_packet modes — change_plan +
//      preflight share computeDecision with packet's verify/plan paths.
//   3. Analytics long-tail — graph_digest is the ONE analytics front door and
//      composes overview/hotspots/cycles; the rest stay callable but unlisted.
//      module_tree (directory roll-up) folds in here as long-tail orientation.
//   4. Replay/analyze code-intel long-tail — the live code_intel_* primaries
//      (references/definitions/hover/symbols/diagnostics/hierarchy) are the
//      coherent front; replay (parent-session reads) + analyze (clang-tidy/
//      build) are specialist follow-ups.
const HIDDEN_FULL_TOOL_NAMES = new Set([
  'graph_lookup',
  'graph_summary',
  'graph_report',
  'graph_change_plan',
  'graph_preflight',
  'graph_module_tree',
  'graph_overview',
  'graph_hotspots',
  'graph_cycles',
  'code_intel_replay',
  'code_intel_analyze',
]);

// Tier B — kept visible in `tools/list` but with a one-line description in
// place of the full prose. Agents can still discover them by name, and the
// short form cuts the manifest token tax on verbs that are useful but rarely
// the first reach. Full descriptions are used whenever the tool is actually
// invoked; this only shapes the listing.
const SHORT_DESCRIPTIONS = new Map([
  ['graph_search',      'Fuzzy symbol search. Use when the exact name is unknown.'],
  ['graph_health',      'Graph trust + dirty-edge breakdown. Run to assess indexing quality.'],
  ['graph_file',        'Whole-file digest (symbols + exports). Use when briefs do not cover the file.'],
]);

function projectToShortDescription(tool) {
  const short = SHORT_DESCRIPTIONS.get(tool.name);
  return short ? { ...tool, description: short } : tool;
}

function resolveToolset(argv = process.argv.slice(2), env = process.env) {
  // Precedence: explicit --toolset wins, then AIFY_GRAPH_PROFILE env, then the
  // focused `default` profile (P4-1). `full` is now an explicit opt-in — the
  // bare default surface is the ~15-verb intent set, not the whole API. The
  // games' .mcp.json (which passes no --toolset) gets the focused default;
  // that is intentional.
  const arg = argv.find(token => token.startsWith('--toolset='));
  if (arg) return arg.slice('--toolset='.length);
  const envProfile = (env.AIFY_GRAPH_PROFILE || '').trim();
  return envProfile || 'default';
}

// APG_MCP_TOOLS — comma-separated env allowlist (codegraph's pattern). When
// set, it restricts the LISTED tools to EXACTLY that set, intersected with
// whatever the resolved profile would have shown — for A/B ablation studies.
// Tools omitted by the allowlist are truly absent from tools/list but stay
// CALLABLE via tools/call (gating = listing only). Unknown names are ignored.
// Empty/whitespace-only → no restriction. Example:
//   APG_MCP_TOOLS=graph_packet,graph_pull,graph_consequences
function parseToolsAllowlist(env = process.env) {
  const raw = (env.APG_MCP_TOOLS || '').trim();
  if (!raw) return null;
  const names = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return names.length ? new Set(names) : null;
}

function defaultOutputMode(toolset, env = process.env) {
  if ((env.AIFY_GRAPH_OUTPUT || '').trim()) return env.AIFY_GRAPH_OUTPUT;
  return toolset === 'lean' ? 'compact' : '';
}

const CODE_INTEL_TOOL_NAMES = new Set([
  'code_intel_diagnostics',
  'code_intel_references',
  'code_intel_definitions',
  'code_intel_hover',
  'code_intel_symbols',
  'code_intel_hierarchy',
  'code_intel_replay',
  'code_intel_analyze',
  'graph_collect_code_intel',
  'graph_packet',
  'graph_health'
]);

function selectListedTools(toolset) {
  if (toolset === 'lean') {
    return TOOLS.filter(tool => LEAN_TOOL_NAMES.has(tool.name));
  }
  if (toolset === 'code-intel') {
    return TOOLS.filter(tool => CODE_INTEL_TOOL_NAMES.has(tool.name));
  }
  if (toolset === 'full') {
    return TOOLS
      .filter(tool => !HIDDEN_FULL_TOOL_NAMES.has(tool.name))
      .map(projectToShortDescription);
  }
  // `default` (and any unrecognized profile name) → the focused intent set.
  // Short descriptions still apply so the listed set stays tight.
  return TOOLS
    .filter(tool => DEFAULT_TOOL_NAMES.has(tool.name))
    .map(projectToShortDescription);
}

// Apply the APG_MCP_TOOLS allowlist (if set) as a final listing filter on top
// of the profile selection. Restricts what tools/list shows; never changes
// what tools/call can invoke.
function applyAllowlist(listed, allowlist) {
  if (!allowlist) return listed;
  return listed.filter(tool => allowlist.has(tool.name));
}

const ACTIVE_TOOLSET = resolveToolset();
const ACTIVE_TOOLS = TOOLS;
const TOOLS_ALLOWLIST = parseToolsAllowlist();
const LISTED_TOOLS = applyAllowlist(selectListedTools(ACTIVE_TOOLSET), TOOLS_ALLOWLIST);
const DEFAULT_OUTPUT_MODE = defaultOutputMode(ACTIVE_TOOLSET);
if (DEFAULT_OUTPUT_MODE) {
  process.env.AIFY_GRAPH_OUTPUT = DEFAULT_OUTPUT_MODE;
}

const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

rl.on('line', async (line) => {
  // Plan #21 — input-size cap. Refuse oversize lines BEFORE JSON.parse
  // forces a giant string allocation. Returns a JSON-RPC structured
  // error rather than process.exit per senior-dev's lock.
  const oversize = checkRequestSize(line);
  if (oversize) { send(oversize); return; }

  let req;
  try {
    req = JSON.parse(line);
  } catch {
    // JSON-RPC 2.0 §4.2 — respond with -32700 Parse error so clients
    // waiting on a matching id don't hang until their own timeout.
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!req || typeof req !== 'object') {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }

  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'aify-project-graph', version: '0.1.0' },
        // P1-1 — intent-routed playbook. MCP hosts inject this into the agent
        // system prompt once/session; single source of truth in
        // server-instructions.js.
        instructions: SERVER_INSTRUCTIONS,
      },
    });
    return;
  }

  if (req.method === 'notifications/initialized') return;

  if (req.method === 'tools/list') {
    send({
      jsonrpc: '2.0', id: req.id,
      result: {
        tools: LISTED_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.schema,
        })),
      },
    });
    return;
  }

  if (req.method === 'resources/list') {
    // Expose static briefs + overlay artifacts as MCP resources so clients
    // can auto-pull them at session start instead of requiring manual paste.
    // URIs are aify:// so there's no ambiguity with arbitrary file reads.
    const repoRoot = process.cwd();
    const aifyDir = path.join(repoRoot, '.aify-graph');
    const candidates = [
      { file: 'brief.agent.md',   name: 'Project brief (agent prompt substrate)',  desc: 'Dense key/value orientation. Paste into system/user prompt for orient-shaped sessions. ~300-700 tokens (size varies with public-API surface).', mime: 'text/markdown' },
      { file: 'brief.onboard.md', name: 'Project brief (onboarding variant)',      desc: 'Stripped brief for new-to-this-repo sessions. ~250 tokens.', mime: 'text/markdown' },
      { file: 'brief.plan.md',    name: 'Project brief (plan variant)',            desc: 'Features + open tasks by feature + feature-tagged recent commits + risks. For change-planning sessions. ~310 tokens.', mime: 'text/markdown' },
      { file: 'brief.md',         name: 'Project brief (human readable)',          desc: 'Full human-readable brief. ~500 tokens.', mime: 'text/markdown' },
      { file: 'brief.json',       name: 'Project brief (machine-readable)',        desc: 'JSON equivalent for scripts.', mime: 'application/json' },
      { file: 'functionality.json', name: 'Functionality overlay (L2)',            desc: 'User-curated feature map: features + symbol/file/route/doc anchors. Validated against code graph on each regen.', mime: 'application/json' },
      { file: 'tasks.json',       name: 'Task overlay (L3)',                       desc: 'External task tracker snapshot with feature attribution. Written by the graph-map-tasks skill.', mime: 'application/json' },
    ];
    const resources = [];
    for (const c of candidates) {
      const p = path.join(aifyDir, c.file);
      if (fs.existsSync(p)) {
        resources.push({
          uri: `aify://${c.file}`,
          name: c.name,
          description: c.desc,
          mimeType: c.mime,
        });
      }
    }
    send({ jsonrpc: '2.0', id: req.id, result: { resources } });
    return;
  }

  if (req.method === 'resources/read') {
    const { uri } = req.params || {};
    if (!uri || !uri.startsWith('aify://')) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `invalid resource uri: ${uri}` } });
      return;
    }
    const fileName = uri.slice('aify://'.length);
    // Whitelist the filenames we expose — never read arbitrary aify:// URIs.
    const allowed = new Set([
      'brief.agent.md', 'brief.onboard.md', 'brief.plan.md',
      'brief.md', 'brief.json',
      'functionality.json', 'tasks.json',
    ]);
    if (!allowed.has(fileName)) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `resource not exposed: ${fileName}` } });
      return;
    }
    const p = path.join(process.cwd(), '.aify-graph', fileName);
    if (!fs.existsSync(p)) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `resource not found: ${fileName}. Run graph indexing + graph-brief.mjs first.` } });
      return;
    }
    try {
      const text = fs.readFileSync(p, 'utf8');
      const mime = fileName.endsWith('.json') ? 'application/json' : 'text/markdown';
      send({ jsonrpc: '2.0', id: req.id, result: { contents: [{ uri, mimeType: mime, text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: `failed to read ${fileName}: ${err.message}` } });
    }
    return;
  }

  if (req.method === 'tools/call') {
    // Guard against missing/non-object params — avoids unhandled rejection
    // when a malformed client sends tools/call without params. Found in
    // 2026-04-20 round-2 audit.
    const { name, arguments: args } = req.params || {};
    if (!name) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'Invalid params: missing tool name' } });
      return;
    }
    const tool = ACTIVE_TOOLS.find(t => t.name === name);
    if (!tool) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `unknown tool: ${name}` } });
      return;
    }

    // Plan #21 — sensitive-path gate. Refuse tool calls whose path-
    // shaped args (repo/repoRoot/projectRoot/file/files[]/etc.) resolve
    // under denylisted system or credential directories. Paths are
    // canonicalized via realpath before checking so symlinks can't
    // bypass. Returns a structured error envelope; caller sees the
    // exact arg name + reason so they can adjust the request.
    const sensitive = findSensitivePathArg(args);
    if (sensitive) {
      send({ jsonrpc: '2.0', id: req.id, error: {
        code: -32602,
        message: `Invalid params: argument '${sensitive.arg}' targets a sensitive path`,
        data: { arg: sensitive.arg, blockedPrefix: sensitive.matched, reason: sensitive.reason },
      }});
      return;
    }

    try {
      let repoRoot = args?.repo ?? process.cwd();
      // P5-5: worktree redirect. If the server runs inside an ephemeral linked
      // git worktree that has no `.aify-graph` of its own, redirect graph
      // resolution to the MAIN working tree's root (where the durable graph
      // lives) so we neither serve a vanishing graph nor clobber the parent
      // checkout's. Only redirects when an explicit `repo` arg was NOT given
      // (an explicit path is authoritative). A one-line notice is prepended to
      // the verb output. Opt-out: APG_NO_WORKTREE_REDIRECT=1.
      let worktreeNotice = null;
      if (!args?.repo) {
        try {
          const { resolveGraphRoot } = await import('./freshness/git.js');
          const wt = resolveGraphRoot(repoRoot);
          if (wt.redirected) {
            worktreeNotice = `running in a git worktree (${repoRoot}); graph resolved from the main checkout at ${wt.root}.`;
            repoRoot = wt.root;
          } else if (wt.isWorktree) {
            worktreeNotice = `running in a git worktree (${repoRoot}); using this worktree's own .aify-graph (the main checkout's graph was not redirected).`;
          }
        } catch { /* best-effort — never block a verb on worktree detection */ }
      }
      // Loud, actionable error when the resolved repoRoot has no .aify-graph
      // AND no explicit repo arg was passed. Surfaced because the
      // 2026-04-26 echoes A/B test found agents silently retrying live
      // verbs 15+ times when the parent CC was launched from a non-repo
      // directory (e.g. home dir). Prevents the trust=missing retry storm.
      try {
        const { existsSync } = await import('node:fs');
        const path = await import('node:path');
        const graphDir = path.join(repoRoot, '.aify-graph');
        if (!args?.repo && !existsSync(graphDir)) {
          send({ jsonrpc: '2.0', id: req.id, result: {
            content: [{ type: 'text', text: [
              `ERROR: no .aify-graph in MCP cwd "${repoRoot}".`,
              ``,
              `The MCP server was launched from a directory that has no graph.`,
              `Two ways to fix:`,
              `  1. Pass repo="<absolute-path-to-target-repo>" in the tool args (works from any cwd).`,
              `  2. Restart Claude Code / Codex / OpenCode from inside the target repo`,
              `     so the MCP server's process.cwd() points at it.`,
              ``,
              `If the target repo has no graph yet, run /graph-build-all from it first.`,
            ].join('\n') }],
          } });
          return;
        }
      } catch { /* defensive: fall through to normal handler */ }
      // Normalize param names: accept both 'symbol' and 'node'/'from' for backwards compat
      const normalized = { ...args, repoRoot };
      if (args?.node && !args?.symbol) normalized.symbol = args.node;
      if (args?.from && !args?.symbol) normalized.symbol = args.from;
      // Clamp numeric params to safe ranges
      if (normalized.depth != null) normalized.depth = Math.min(Math.max(Number(normalized.depth) || 1, 1), 10);
      if (normalized.top_k != null) normalized.top_k = Math.min(Math.max(Number(normalized.top_k) || 10, 1), 200);
      if (normalized.limit != null) normalized.limit = Math.min(Math.max(Number(normalized.limit) || 20, 1), 100);
      // Opt-in self-heal: when APG_AUTO_REINDEX is set, refresh a stale graph
      // BEFORE the handler reads it, so managed workers (who can't call
      // graph_index) stop getting false-empty results. OFF by default — no
      // surprise latency; warn-by-default behavior below is unchanged when off.
      if (name !== 'graph_index' && name !== 'graph_status') {
        try {
          const { autoReindexEnabled } = await import('./freshness/auto-reindex.js');
          if (autoReindexEnabled(process.env.APG_AUTO_REINDEX)) {
            const { getHeadCommit } = await import('./freshness/git.js');
            const { loadManifest } = await import('./freshness/manifest.js');
            const graphDir = path.join(repoRoot, '.aify-graph');
            const [{ manifest }, head] = await Promise.all([
              loadManifest(graphDir),
              getHeadCommit(repoRoot).catch(() => null),
            ]);
            if (manifest?.commit && head && manifest.commit !== head) {
              const { ensureFresh } = await import('./freshness/orchestrator.js');
              await ensureFresh({ repoRoot });
            }
          }
        } catch { /* best-effort: fall through, the post-handler warning still fires */ }
      }
      const result = await tool.handler(normalized);
      // Staleness warning: if graph is indexed but manifest commit lags HEAD,
      // surface a warning in the response so agents don't silently act on stale
      // data. Skip for graph_status / graph_index (they already show the facts).
      // Computed for every result type — previously gated on object-returning
      // verbs only, which let string-returning verbs (graph_change_plan,
      // graph_path, graph_packet) silently emit stale line numbers. Fix from
      // 2026-04-26 echoes A-v2 bench: agent nearly cited stale lines because
      // HEAD moved mid-run and string verbs gave no drift signal.
      let stalenessWarning = null;
      if (name !== 'graph_status' && name !== 'graph_index') {
        try {
          const { getHeadCommit } = await import('./freshness/git.js');
          const { loadManifest } = await import('./freshness/manifest.js');
          const graphDir = path.join(repoRoot, '.aify-graph');
          const [{ manifest }, head] = await Promise.all([
            loadManifest(graphDir),
            getHeadCommit(repoRoot).catch(() => null),
          ]);
          if (manifest?.commit && head && manifest.commit !== head) {
            const { commitsBehindHead } = await import('./query/verbs/read_freshness.js');
            const n = commitsBehindHead(repoRoot, manifest.commit, head);
            const behind = n != null ? ` (${n} commit${n === 1 ? '' : 's'} behind)` : '';
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}${behind}. Run graph_index() to refresh, or set APG_AUTO_REINDEX=1 for auto-refresh — line numbers may drift.`;
          }
        } catch {
          // best-effort — never block a verb on staleness detection
        }
      }
      // P5-5: fold the worktree notice into the same warning channel as the
      // staleness warning so read verbs surface it without a new field shape.
      const notices = [];
      if (worktreeNotice) notices.push(worktreeNotice);
      if (stalenessWarning) notices.push(stalenessWarning);
      let text;
      if (typeof result === 'string') {
        const prefix = notices.map((n) => `WARNING: ${n}`).join('\n');
        text = prefix ? `${prefix}\n\n${result}` : result;
      } else {
        const wrapped = notices.length ? { _warnings: notices, ...result } : result;
        text = JSON.stringify(wrapped, null, 2);
      }
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `ERROR [${name}]: ${err.message}` }], isError: true } });
    }
    return;
  }

  if (req.id != null) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
  }
});

// ── Server lifecycle / shutdown ────────────────────────────────────────────
//
// Audit 2026-06-12 (3 agents, mirrors codegraph 0b1a2ee): the only wired event
// used to be rl.on('line'). With no stdin close/error or signal handling, when
// the MCP host closed stdin (the standard stdio shutdown signal) live LSP
// SESSIONS (spawned clangd/tsserver/pyright children) kept the event loop alive
// — the server lingered and leaked language-server children on every host exit.
//
// On stdin CLOSE we only TEAR DOWN the long-lived LSP children (which is what
// pins the loop) and then let Node exit NATURALLY once any in-flight verb
// handlers have written their replies. We must NOT process.exit() here: the
// line handler is async, so a hard exit on close would race mid-flight handlers
// and truncate their stdout responses (and process.exit can drop buffered pipe
// writes). A broken stdin/stdout pipe or a signal, by contrast, means the host
// is already gone and we cannot drain/reply — there we exit after best-effort
// teardown so we neither linger nor crash on a dead pipe.
let shuttingDown = false;
async function teardownSessions() {
  try { await shutdownAllSessions(); } catch { /* best-effort teardown */ }
}
async function gracefulExit(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await teardownSessions();
  process.exit(code);
}
rl.on('close', () => { teardownSessions(); });
process.stdin.on('error', () => { gracefulExit(0); });
process.stdout.on('error', () => { gracefulExit(0); });
process.on('SIGINT', () => { gracefulExit(0); });
process.on('SIGTERM', () => { gracefulExit(0); });
// Borrow (codegraph #855): a truly-unexpected error must EXIT cleanly (after
// tearing down LSP children), not orphan/spin the process at 100% CPU. Verb
// handlers already catch their own errors and return isError; these are the
// last-resort net for everything else. Note them on stderr first.
process.on('uncaughtException', (err) => {
  try { process.stderr.write(`[aify-project-graph] uncaughtException: ${err?.stack ?? err}\n`); } catch { /* ignore */ }
  gracefulExit(1);
});
process.on('unhandledRejection', (reason) => {
  try { process.stderr.write(`[aify-project-graph] unhandledRejection: ${reason?.stack ?? reason}\n`); } catch { /* ignore */ }
  gracefulExit(1);
});
