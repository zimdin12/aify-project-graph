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

const TOOLS = [
  // ── Administrative ───────────────────────────────────────────
  {
    name: 'graph_status',
    handler: graphStatus,
    description: 'Check if graph is indexed. Returns JSON: {indexed, nodes, edges, commit, dirtyFiles, unresolvedEdges, dirtyEdgeCount}. Use to verify the graph is ready before querying.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'graph_index',
    handler: graphIndex,
    description: 'Build or rebuild the graph. Auto-runs on first query if needed. Use force=true to rebuild from scratch (clears stale data). Returns {indexed, nodes, edges, commit}.',
    schema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', default: false, description: 'Force full rebuild from scratch' },
      },
    },
  },
  {
    name: 'graph_dashboard',
    handler: graphDashboard,
    description: 'Open interactive graph browser in a web browser. Returns {url, port}. Click nodes to inspect, search symbols, filter by type, trace paths visually.',
    schema: {
      type: 'object',
      properties: {
        port: { type: 'integer', description: 'Port to listen on (auto-picks if omitted)' },
      },
    },
  },

  // ── Discovery ────────────────────────────────────────────────
  {
    name: 'graph_report',
    handler: graphReport,
    description: 'Full project orientation in one call. Returns: REPO stats, LANGS breakdown, ENTRY points, DIR structure, DOC list, HUB symbols (most-referenced), COMMUNITIES (clustered subsystems). Call this FIRST on any unfamiliar repo.',
    schema: {
      type: 'object',
      properties: {
        top_k: { type: 'integer', default: 20, description: 'Max items per category' },
      },
    },
  },
  {
    name: 'graph_search',
    handler: graphSearch,
    description: 'Fuzzy search for symbols by partial name. Supports filtering by type (Function, Class, Method, etc.) and file path prefix. Returns NODE lines. Use when you don\'t know the exact symbol name.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial symbol name to search (e.g. "UserCont" finds "UserController")' },
        kind: { type: 'string', enum: ['code', 'all'], default: 'code', description: 'code=functions/classes only (default), all=include docs/dirs/configs' },
        type: { type: 'string', description: 'Filter by node type: Function, Method, Class, Interface, Type, Test, File, Route, Entrypoint' },
        file: { type: 'string', description: 'Filter by file path prefix (e.g. "src/auth" only searches in src/auth/)' },
        limit: { type: 'integer', default: 20, description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_whereis',
    handler: graphWhereis,
    description: 'Find exactly where a symbol is defined. Returns NODE lines with file:line. Use expand=true to also get top incoming/outgoing edges (replaces graph_summary).',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Exact symbol name (function, class, method, etc.)' },
        limit: { type: 'integer', default: 5, description: 'Max matches if name is ambiguous' },
        expand: { type: 'boolean', default: false, description: 'Include top 3 incoming + 3 outgoing edges (like graph_summary)' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_module_tree',
    handler: graphModuleTree,
    description: 'Show directory + file + symbol hierarchy under a path. Like "ls -R" but with symbol details. Returns NODE lines sorted by path.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.', description: 'Directory path to explore (e.g. "src/auth", "service/routers")' },
        depth: { type: 'integer', default: 2, description: 'How deep to recurse (1=files only, 2=files+symbols)' },
        top_k: { type: 'integer', default: 30, description: 'Max nodes to return' },
      },
    },
  },

  // ── File-level ───────────────────────────────────────────────
  {
    name: 'graph_file',
    handler: graphFile,
    description: 'Everything about one file in a single call: what it defines, imports, who calls into it, what it calls out, and which tests cover it. Replaces chaining whereis + callers + callees for each symbol.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (e.g. "service/db.py", "src/auth/token.ts"). Partial match supported.' },
        top_k: { type: 'integer', default: 20, description: 'Max items per section' },
      },
      required: ['path'],
    },
  },

  // ── Analysis ─────────────────────────────────────────────────
  {
    name: 'graph_preflight',
    handler: graphPreflight,
    description: 'One-shot edit safety check. Shows: location, callers, impact, test coverage, trust signal, and a SAFE/REVIEW/CONFIRM decision recommendation. MUST call before editing any symbol with non-trivial fan-in. Replaces chaining whereis + callers + impact + summary.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol you are about to edit' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_callers',
    handler: graphCallers,
    description: 'Who calls this symbol? Returns EDGE lines ranked by: depth ASC, confidence DESC, test proximity, fan-in. Use `file` to scope results to a specific directory.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name to find callers of' },
        depth: { type: 'integer', default: 1, description: 'Hop depth (1=direct callers, 2=callers of callers, etc.)' },
        top_k: { type: 'integer', default: 10, description: 'Max edges to return' },
        file: { type: 'string', description: 'Filter: only show callers from this directory (e.g. "service/routers")' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_callees',
    handler: graphCallees,
    description: 'What does this symbol call? Returns EDGE lines. Use `file` to scope results to a specific directory.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name to find callees of' },
        depth: { type: 'integer', default: 1, description: 'Hop depth' },
        top_k: { type: 'integer', default: 10, description: 'Max edges to return' },
        file: { type: 'string', description: 'Filter: only show callees in this directory' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_neighbors',
    handler: graphNeighbors,
    description: 'All connections around a symbol — calls, references, imports, extends, tests, mentions, etc. Filter by edge_types to narrow. Use for exploring unknown symbols.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name to explore' },
        edge_types: { type: 'array', items: { type: 'string' }, default: [], description: 'Filter: CALLS, REFERENCES, IMPORTS, EXTENDS, IMPLEMENTS, USES_TYPE, TESTS, MENTIONS, INVOKES, CONTAINS, DEFINES. Empty = all.' },
        depth: { type: 'integer', default: 1, description: 'Hop depth' },
        top_k: { type: 'integer', default: 20, description: 'Max edges' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_impact',
    handler: graphImpact,
    description: 'Deep drill-down for blast radius analysis. Walks CALLS + REFERENCES + USES_TYPE + TESTS edges transitively. For quick edit safety checks, prefer graph_preflight. Returns EDGE lines showing the blast radius.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to analyze impact of' },
        depth: { type: 'integer', default: 3, description: 'Transitive depth (1=direct dependents, 3=3 hops out)' },
        top_k: { type: 'integer', default: 30, description: 'Max impact edges to return' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_path',
    handler: graphPath,
    description: 'Trace execution path as a readable story. "What happens when handleRequest runs?" Returns indented PATH tree. mode="execution" (default) follows only INVOKES+CALLS; mode="dependency" also follows TESTS+REFERENCES.',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Starting symbol to trace from' },
        direction: { type: 'string', enum: ['out', 'in'], default: 'out', description: 'out=forward (what does it call), in=backward (what calls it)' },
        depth: { type: 'integer', default: 5, description: 'Max trace depth' },
        top_k: { type: 'integer', default: 3, description: 'Max branches per node shown (explores wider, trims at render)' },
        mode: { type: 'string', enum: ['execution', 'dependency'], default: 'execution', description: 'execution=INVOKES+CALLS only, dependency=all edge types' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graph_summary',
    handler: graphSummary,
    description: 'Compact digest of a single symbol: type, file:line, top 3 incoming + 3 outgoing edges. (Backward compat — prefer graph_whereis with expand=true)',
    schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name to summarize' },
      },
      required: ['symbol'],
    },
  },
];

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
        tools: TOOLS.map(t => ({
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
    const tool = TOOLS.find(t => t.name === name);
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
