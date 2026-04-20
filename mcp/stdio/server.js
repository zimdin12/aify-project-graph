#!/usr/bin/env node
// Self-heal platform-mismatched better-sqlite3 before any DB-dependent
// imports load. Import for side effects only — it throws if unrecoverable.
import './preflight-native.js';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { graphStatus } from './query/verbs/status.js';
import { graphIndex } from './query/verbs/index.js';
import { graphWhereis } from './query/verbs/whereis.js';
import { graphCallers } from './query/verbs/callers.js';
import { graphCallees } from './query/verbs/callees.js';
import { graphNeighbors } from './query/verbs/neighbors.js';
import { graphModuleTree } from './query/verbs/module_tree.js';
import { graphImpact } from './query/verbs/impact.js';
import { graphSummary } from './query/verbs/summary.js';
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

// Lean profile (v2, 2026-04-19): trimmed from 5 → 3 verbs after the
// cross-language A/B validation showed 14/14 lean-MCP runs across 4
// languages and 2 task shapes made zero MCP calls. See
// docs/dogfood/ab-results-2026-04-19-a2-cross-repo.md.
//
// Dropped:
//   graph_report   — static brief artifacts replace it for orient tasks
//   graph_callers  — failed routing even on plan prompts that asked for callers
//
// Kept — these three represent graph-monopoly surfaces (questions rg and
// shell can't answer cheaply) where a live verb may still earn routing on
// the right prompt shape. Hidden verbs remain callable via tools/call for
// scripts that explicitly request them by name.
const LEAN_TOOL_NAMES = new Set([
  'graph_impact',
  'graph_path',
  'graph_change_plan',
]);

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

function selectListedTools(toolset) {
  if (toolset === 'lean') {
    return TOOLS.filter(tool => LEAN_TOOL_NAMES.has(tool.name));
  }
  return TOOLS;
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
    try {
      const repoRoot = args?.repo ?? process.cwd();
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
      let stalenessWarning = null;
      if (name !== 'graph_status' && name !== 'graph_index' && result && typeof result === 'object') {
        try {
          const { getHeadCommit } = await import('./freshness/git.js');
          const { loadManifest } = await import('./freshness/manifest.js');
          const graphDir = path.join(repoRoot, '.aify-graph');
          const [{ manifest }, head] = await Promise.all([
            loadManifest(graphDir),
            getHeadCommit(repoRoot).catch(() => null),
          ]);
          if (manifest?.commit && head && manifest.commit !== head) {
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}. Run graph_index() to refresh.`;
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
