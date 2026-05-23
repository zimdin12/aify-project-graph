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
import { graphReport } from './query/verbs/report.js';
import { graphPath } from './query/verbs/path.js';
import { graphDashboard } from './query/verbs/dashboard.js';
import { graphSearch } from './query/verbs/search.js';
import { graphFile } from './query/verbs/file.js';
import { graphPreflight } from './query/verbs/preflight.js';
import { graphChangePlan } from './query/verbs/change_plan.js';
import { graphOnboard } from './query/verbs/onboard.js';
import { graphPull } from './query/verbs/pull.js';
import { graphFind } from './query/verbs/find.js';
import { graphPacket } from './query/verbs/packet.js';
import { graphCollectCodeIntel } from './query/verbs/collect_code_intel.js';
import { checkRequestSize, MAX_MCP_LINE_BYTES } from './security/request-size.js';
import { findSensitivePathArg } from './security/sensitive-paths.js';
import {
  codeIntelDiagnostics,
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
  codeIntelSymbols
} from './query/verbs/code_intel_live.js';
import { codeIntelReplay } from './query/verbs/code_intel_replay.js';
import { codeIntelAnalyze } from './query/verbs/code_intel_analyze.js';

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
    description: 'Compact one-shot agent prompt packet for a feature or task. For feature/task targets, reads overlay (functionality.json + tasks.json) + brief.json directly — no ensureFresh, no SQL, sub-millisecond static path. Bare symbol targets may use one budgeted consequences lookup to map symbol→feature. Returns fixed-schema markdown: TASK/FEATURE → MODE → STATUS → FEATURES → SNAPSHOT → READ FIRST → CONTRACTS → TESTS → RISKS → LIVE. mode=verify is a post-edit decision packet and does not require target — pass files[]/since instead. Target: <500-900 tokens. Use INSTEAD of stringing graph_pull + graph_consequences + tasks/functionality.json reads when you just need the action-bearing context to start work. Pass mode=orient|plan|debug|review|audit|verify to shape section caps and risk hints. Pass live=true to opt into the slower live-enrichment path.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'feature:<id> | task:<id> | bare id | bare symbol (not required for mode=verify)' },
        mode: { type: 'string', enum: ['orient', 'plan', 'debug', 'review', 'audit', 'verify'], default: 'orient', description: 'Workflow mode. Shapes section caps and risk hints without changing the underlying graph truth. verify = post-edit decision packet (changed files, diagnostics, freshness, SOURCE_REQUIRED).' },
        budget: { type: 'integer', default: 800, description: 'Token budget for the rendered packet (section caps + final clamp).' },
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
    description: 'Live per-file diagnostics. Drives clangd directly (no collect/import round-trip). Batch-warms requested files (one longer warm-up on a cold session). Per-file wait defaults to 3000ms so cold clangd does not return empty first-call diagnostics. Returns {status, files:[{file,freshness,diagnostics}], diagnostics:[{file,severity,message,range}], telemetry:{diagnosticsWaitMs,...}, noValueAdded?}. noValueAdded is only set when every file is explicitly stale/timeout, never on unknown. Use after editing C++ to check for errors without running a build.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', default: 'cpp' },
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
    description: 'Live symbol-aware references at a file:line:col position. Symbol-aware via clangd (NOT text search). Returns {status, freshness, result_state, warmedFiles, references[] (compat, full LSP shape), referenceLocations[] (non-declaration callsites only), definitionLocations[] (declaration entries split out), evidence:{ready,degraded,cause,confidence,fallback,exhaustive,warnings}, telemetry, noValueAdded? (deprecated compat shim)}. CONTRACT: trust absence claims ("no callers", "dead code") ONLY when evidence.exhaustive===true. Degraded causes: cold_index|timeout|unsupported|definition_only|stale_index|unknown — read evidence.fallback for the recovery action. Pass warmupFiles[] (known callers, headers) when background-index is disabled and cross-TU resolution is needed.',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', default: 'cpp' },
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
        language: { type: 'string', default: 'cpp' },
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
        language: { type: 'string', default: 'cpp' },
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
        language: { type: 'string', default: 'cpp' },
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
        language: { type: 'string', default: 'cpp' },
        file: { type: 'string' }
      },
      required: ['file']
    },
  },
  {
    name: 'graph_collect_code_intel',
    handler: graphCollectCodeIntel,
    description: 'Run a code-intel provider (e.g. cpp-clangd) and import the resulting v0.2 collection into the local graph. Public action verb — agents and bridge UI both call this. Never auto-runs; explicit only. Returns the v0.2 collection envelope (status, errors, records). On success the collection is imported and immediately visible to graph_health.codeIntel, graph_pull(layers:["code_intel"]), graph_change_plan ranking, and packet EVIDENCE blocks. Use after touching code that needs compiler-backed precision (C++ templates, virtual dispatch, macros).',
    schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Language to collect for (e.g. "cpp"). Provider is selected per language.' },
        scope: { type: 'string', enum: ['changed', 'files', 'all'], default: 'changed', description: 'Collection scope. "changed" derives files from `since`; "files" uses explicit files[]; "all" enumerates from compile_commands.json.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Explicit files to collect (repo-relative). Required when scope="files".' },
        since: { type: 'string', description: 'Git ref for "changed" scope; collects files modified since this ref.' },
        operations: { type: 'array', items: { type: 'string', enum: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'] }, description: 'Operations to run. Defaults to [definitions, references, diagnostics].' },
      },
      required: ['language'],
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
    name: 'graph_search',
    handler: graphSearch,
    description: 'Partial-name symbol search with optional type and file filters. Prefer graph_whereis for exact names.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial symbol name.' },
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
    description: 'Incoming execution edges for a symbol. Includes CALLS, INVOKES, PASSES_THROUGH.',
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
    description: 'Transitive blast radius for a symbol across calls, refs, and tests.',
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
    description: 'Readable path trace from a symbol. execution=CALLS/INVOKES/PASSES_THROUGH; dependency=broader.',
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

// Full profile still keeps all 21 verbs callable, but the tools/list surface
// hides the low-value legacy orient aliases that briefs replaced. This trims
// passive manifest tax without breaking scripts that call them by name.
const HIDDEN_FULL_TOOL_NAMES = new Set([
  'graph_lookup',
  'graph_summary',
  'graph_report',
  'graph_onboard',
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
  ['graph_module_tree', 'Directory → feature roll-up. Use to see repo layout in graph form.'],
]);

function projectToShortDescription(tool) {
  const short = SHORT_DESCRIPTIONS.get(tool.name);
  return short ? { ...tool, description: short } : tool;
}

function resolveToolset(argv = process.argv.slice(2), env = process.env) {
  const arg = argv.find(token => token.startsWith('--toolset='));
  if (arg) return arg.slice('--toolset='.length);
  const envProfile = (env.AIFY_GRAPH_PROFILE || '').trim();
  return envProfile || 'full';
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
  return TOOLS
    .filter(tool => !HIDDEN_FULL_TOOL_NAMES.has(tool.name))
    .map(projectToShortDescription);
}

const ACTIVE_TOOLSET = resolveToolset();
const ACTIVE_TOOLS = TOOLS;
const LISTED_TOOLS = selectListedTools(ACTIVE_TOOLSET);
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
      const repoRoot = args?.repo ?? process.cwd();
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
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}. Run graph_index() to refresh — line numbers may drift.`;
          }
        } catch {
          // best-effort — never block a verb on staleness detection
        }
      }
      let text;
      if (typeof result === 'string') {
        text = stalenessWarning ? `WARNING: ${stalenessWarning}\n\n${result}` : result;
      } else {
        const wrapped = stalenessWarning ? { _warnings: [stalenessWarning], ...result } : result;
        text = JSON.stringify(wrapped, null, 2);
      }
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `ERROR [${name}]: ${err.message}` }], isError: true } });
    }
    return;
  }

  if (req.id) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
  }
});
