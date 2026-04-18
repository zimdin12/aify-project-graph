#!/usr/bin/env node
import readline from 'node:readline';
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

const TOOLS = [
  // ── Administrative ───────────────────────────────────────────
  {
    name: 'graph_status',
    handler: graphStatus,
    description: 'Return graph status: indexed, counts, dirty files, unresolved edges.',
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
];

const LEAN_TOOL_NAMES = new Set([
  'graph_impact',
  'graph_callers',
  'graph_path',
  'graph_report',
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
  try { req = JSON.parse(line); } catch { return; }

  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
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

  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
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
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
