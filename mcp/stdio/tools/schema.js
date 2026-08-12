// THE MCP TOOL SCHEMA — 42 declarations, extracted from server.js.
//
// 614 lines of the 1394 in server.js were this one declarative array sitting beside the
// dispatcher. Moving it changes no code path: server.js imports TOOLS back and every handler
// binding is identical.
//
// ⚠ IT IS NOT "PURE DATA", AND THE PROPOSAL SAYING SO WAS WRONG. The literal carries 42
// `handler:` references, so 34 import statements moved WITH it — this module is what now
// knows every verb implementation, and server.js imports the result. That is arguably the
// better arrangement, but it is coupling, not data movement, and the refactor proposal claimed
// "no inbound or outbound coupling" until it was audited.
//
// ✓ Cycle risk verified before the move, not assumed: no module reachable from these imports
// imports mcp/stdio/server.js. 152 modules traversed transitively, with the offender predicate
// separately proven able to fire before the null result was accepted.
//
// ★ tools/list bills EVERY session and ~80% of it is this schema. Keeping it in its own module
// makes that cost visible and measurable instead of buried mid-dispatcher.

import { graphStatus } from '../query/verbs/status.js';
import { graphIndex } from '../query/verbs/index.js';
import { graphWatch } from '../query/verbs/watch.js';
import { graphLookup } from '../query/verbs/lookup.js';
import { graphWhereis } from '../query/verbs/whereis.js';
import { graphCallers } from '../query/verbs/callers.js';
import { graphCallees } from '../query/verbs/callees.js';
import { graphNeighbors } from '../query/verbs/neighbors.js';
import { graphModuleTree } from '../query/verbs/module_tree.js';
import { graphImpact } from '../query/verbs/impact.js';
import { graphSummary } from '../query/verbs/summary.js';
import { graphHealth } from '../query/verbs/health.js';
import { graphConsequences } from '../query/verbs/consequences.js';
import { graphExplainDiff } from '../query/verbs/explain_diff.js';
import { graphReport } from '../query/verbs/report.js';
import { graphPath } from '../query/verbs/path.js';
import { graphDashboard } from '../query/verbs/dashboard.js';
import { graphSearch } from '../query/verbs/search.js';
import { graphFile } from '../query/verbs/file.js';
import { graphShader } from '../query/verbs/shader.js';
import { graphPreflight } from '../query/verbs/preflight.js';
import { graphChangePlan } from '../query/verbs/change_plan.js';
import { graphOnboard } from '../query/verbs/onboard.js';
import { graphTour } from '../query/verbs/tour.js';
import { graphPull } from '../query/verbs/pull.js';
import { graphFind } from '../query/verbs/find.js';
import { graphPacket } from '../query/verbs/packet.js';
import { graphTrace } from '../query/verbs/trace.js';
import { graphExplore } from '../query/verbs/explore.js';
import { graphCollectCodeIntel } from '../query/verbs/collect_code_intel.js';
import {
  graphOverview,
  graphHotspots,
  graphCycles,
  graphDigest,
} from '../query/verbs/analytics_verbs.js';
import {
  codeIntelDiagnostics,
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
  codeIntelSymbols
} from '../query/verbs/code_intel_live.js';
import { codeIntelReplay } from '../query/verbs/code_intel_replay.js';
import { codeIntelAnalyze } from '../query/verbs/code_intel_analyze.js';
import { codeIntelHierarchy } from '../query/verbs/code_intel_hierarchy.js';

export const TOOLS = [
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
    description: 'FIRST CALL of any session: "can I trust what this graph is about to tell me?" Replaces graph_status + graph_index + brief parsing. Reports trust level, staleness (indexed commit vs HEAD), unresolved-edge counts WITH the rule that filtered them (trustBasis), code-intel coverage over an explicitly NAMED denominator (lspVerifiedPctDenominator — edges no backend can check and edges git does not track are excluded from both sides), and up to 3 ranked next actions — EMPTY on a healthy repo, which is what makes a populated list mean something. Also reports which BUILD is answering (server.commit) and whether it is behaviourally stale. SCOPE: a weak/empty-spine verdict constrains GRAPH-backed verbs only — the live code_intel_* verbs query the language server directly. For a delete decision read evidence.exhaustive on code_intel_references, not this summary.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'graph_packet',
    handler: graphPacket,
    description: 'ORIENTATION packet for a task/feature/symbol — use when you do NOT yet have a precise question. If you already know what you are asking ("what breaks if I change X" -> graph_consequences, "who calls X" -> code_intel_references), call that verb instead; this is not a mandatory first step. Prefer over stringing graph_pull + graph_consequences when you are still forming the question. Compact one-shot agent prompt packet for a feature or task. For feature/task targets, reads overlay (functionality.json + tasks.json) + brief.json directly — no ensureFresh, no SQL, sub-millisecond static path. Bare symbol targets use one budgeted consequences lookup to map symbol→feature; a symbol that is known to the graph but maps to no feature (or is ambiguous) degrades to a compact SYMBOL packet (DEFINED IN / CANDIDATES + read-next pointers) instead of erroring. Returns fixed-schema markdown: TASK/FEATURE → MODE → STATUS → FEATURES → SNAPSHOT → READ FIRST → CONTRACTS → TESTS → RISKS → LIVE. mode=verify is a post-edit decision packet and does not require target — pass files[]/since instead. Target: <500-900 tokens. Use INSTEAD of stringing graph_pull + graph_consequences + tasks/functionality.json reads when you just need the action-bearing context to start work. Pass mode=orient|plan|debug|review|audit|verify to shape section caps and risk hints. Pass live=true to opt into the slower live-enrichment path.',
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
    description: 'Compiler-backed "who references this symbol", asked of the LIVE language server — the only verb whose answer can support a delete or rename decision. Bounded and budgeted. ★ READ evidence BEFORE CONCLUDING: exhaustive:true means an absence of callers is real; degraded:true with a cause (definition_only, cold index) means the index could not answer, and ZERO REFERENCES IS THEN NOT EVIDENCE OF NO CALLERS. On one measured C++ project EVERY not-found result was definition_only and none were true absences, so treat degraded as uninformative rather than negative — check your own repo with graph_health.refsNotFoundBreakdown. Unaffected by graph staleness, because it asks the language server rather than the snapshot. ON A COLD SESSION pass waitForReadyMs (e.g. 25000) — otherwise a CORRECT answer comes back UNATTESTED (degraded:true, cause stale_index, exhaustive:false) and cannot license a deletion.',
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
    description: 'Transitive call hierarchy (callers/callees) or type hierarchy (subtypes/supertypes) from the live language server, walked to a bounded depth. Requires kind. Use for "who ultimately reaches this" or "what overrides this virtual" — questions a single hop cannot answer. ★ READ evidence: as with code_intel_references, an empty result carrying degraded:true means cross-TU resolution failed, NOT that nothing calls it. Depth and breadth are capped and truncation is always reported. ON A COLD SESSION pass waitForReadyMs — a cold call can return empty or unattested even when the answer exists.',
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
    description: 'Run a compiler/LSP-backed collection (clangd for C++) and import it as [lsp✓] verified edges. ★ THIS CALL DELETES DATA: a COMPLETE collect supersedes and DISCARDS the prior collection for the same provider. A PARTIAL collect does not. If the current collection is the only copy of evidence you care about, back up .aify-graph first. EXPLICIT ONLY — never auto-runs. Use after touching code that needs compiler precision (C++ templates, virtual dispatch, macros), or when graph_health reports an empty trust spine. RESUMES: a cold first run is time-budgeted and returns status:"partial" — that is NOT a failure, call it again until index.filesTotal is 0. An explicit files[] scope deliberately does NOT resume. language is inferred from files/repo markers, default cpp; Python is never provably exhaustive. Every result carries its own coverage floor (positionGuessSkipped, refsTruncatedSymbols) and next-step hints — read them rather than reading a percentage as a rate.',
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
    description: '"What breaks if I touch X?" — cross-layer blast radius for a symbol or file: contracts, features, open tasks, adjacent tests, co-consumer files, recent history, risk flags. Use BEFORE planning a non-trivial change. ★ READ field_provenance BEFORE ACTING: every field is labelled observed (from graph structure — callers, importers, documents_mentioning) or inferred (from the curated feature/task overlay, only as fresh as overlay_age_days). An absent INFERRED entry is NOT evidence of absence. Lists carry {items,total,truncated} — check truncated before treating one as complete. Returns a portable RECEIPT (pins + replay args + a named disconfirming test) so a second agent can validate or refute the claim without re-deriving it; pass receipt:"full" for per-claim provenance.',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Symbol name or repo-relative file path.' },
        receipt: {
          type: 'string',
          enum: ['head', 'full'],
          description: 'Receipt detail. Default "head" — pins + replay args + the disconfirming test, enough to VALIDATE the claim or hand it to another agent. "full" adds the per-claim provenance list and roughly DOUBLES the response; ask for it only when comparing claim-by-claim without replaying.',
        },
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
    description: 'Incoming execution edges for a symbol (CALLS, INVOKES, PASSES_THROUGH) from the STORED graph. ★ HEURISTIC BY DEFAULT: tree-sitter extraction UNDERCOUNTS C++ virtual and cross-TU dispatch — on one measured project it found half the calling files. Use it as a LEAD, never as evidence of completeness; for a delete decision use code_intel_references and read evidence.exhaustive. Each file:line is the CALLER FUNCTION\'s declaration, not the call site — edges are function-granular. Promoted to [lsp✓] where a code-intel collection has verified the edge.',
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
    description: 'Cross-layer pull for a node (file, feature, symbol, or task). Default layers: code+functionality+tasks+activity. Opt-in layers: docs (MENTIONS edges), relations (direct graph neighbors — callers/callees/imports/cross-feature inputs-outputs, PLUS recompile_surface: the bounded TRANSITIVE include closure for a file, with per-hop counts and — critically for a delete decision — terminated:true meaning the walk ran out of includers, distinguished from truncated/depth_capped meaning the number is a FLOOR; imported_by is hop 1 only and is the wrong answer to "what must I rebuild" when the includers are themselves headers), transitive (feature-only: closure of depends_on up and/or down + anchored files for each). For transitive, pass direction="downstream"|"upstream"|"both" (default both).',
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
        receipt: {
          type: 'string',
          enum: ['head', 'full'],
          description: 'Receipt detail. Default "head" — pins + replay args + the disconfirming test, which is everything needed to VALIDATE a claim or hand it to another agent. Pass "full" only when you need the per-claim provenance list; it is ~4x larger.',
        },
        overlayQuality: {
          type: 'boolean',
          description: 'Include the repo-level overlay_quality block (feature/task curation stats). Default false — it is repo state, not node state, and graph_health reports it once. Only useful when diagnosing why anchors are missing.',
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
