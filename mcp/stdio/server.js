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

const TOOLS = [
  {
    name: 'graph_status', handler: graphStatus,
    description: 'Check if the graph is indexed, node/edge counts, commit, dirty files, trust signals.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'graph_index', handler: graphIndex,
    description: 'Build or incrementally rebuild the graph. force=true for full rebuild.',
    schema: { type: 'object', properties: { force: { type: 'boolean', default: false } }, additionalProperties: false },
  },
  {
    name: 'graph_whereis', handler: graphWhereis,
    description: 'Resolve a symbol name to its definition location (file:line).',
    schema: { type: 'object', properties: { symbol: { type: 'string' }, limit: { type: 'integer', default: 5 } }, required: ['symbol'] },
  },
  {
    name: 'graph_callers', handler: graphCallers,
    description: 'Find what calls a given symbol. Returns compact NODE/EDGE lines.',
    schema: { type: 'object', properties: { symbol: { type: 'string' }, depth: { type: 'integer', default: 1 }, top_k: { type: 'integer', default: 10 } }, required: ['symbol'] },
  },
  {
    name: 'graph_callees', handler: graphCallees,
    description: 'Find what a given symbol calls. Returns compact NODE/EDGE lines.',
    schema: { type: 'object', properties: { symbol: { type: 'string' }, depth: { type: 'integer', default: 1 }, top_k: { type: 'integer', default: 10 } }, required: ['symbol'] },
  },
  {
    name: 'graph_neighbors', handler: graphNeighbors,
    description: 'Generic 1-hop expansion around a node, filterable by edge type.',
    schema: { type: 'object', properties: { node: { type: 'string' }, edge_types: { type: 'array', items: { type: 'string' }, default: [] }, depth: { type: 'integer', default: 1 }, top_k: { type: 'integer', default: 20 } }, required: ['node'] },
  },
  {
    name: 'graph_module_tree', handler: graphModuleTree,
    description: 'Show directory/file/symbol hierarchy under a path.',
    schema: { type: 'object', properties: { path: { type: 'string', default: '.' }, depth: { type: 'integer', default: 2 }, top_k: { type: 'integer', default: 30 } } },
  },
  {
    name: 'graph_impact', handler: graphImpact,
    description: 'Transitive downstream impact analysis: what breaks if this symbol changes? Includes tests.',
    schema: { type: 'object', properties: { symbol: { type: 'string' }, depth: { type: 'integer', default: 3 }, top_k: { type: 'integer', default: 30 } }, required: ['symbol'] },
  },
  {
    name: 'graph_summary', handler: graphSummary,
    description: 'Compact digest of a single node: signature, top incoming/outgoing edges, related tests.',
    schema: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] },
  },
  {
    name: 'graph_report', handler: graphReport,
    description: 'Full project orientation digest: directory layout, languages, entry points, routes, docs, hub symbols.',
    schema: { type: 'object', properties: { top_k: { type: 'integer', default: 20 } } },
  },
  {
    name: 'graph_path', handler: graphPath,
    description: 'Trace execution path as a readable story. "What happens if I enter this function?"',
    schema: { type: 'object', properties: { from: { type: 'string' }, direction: { type: 'string', enum: ['out', 'in'], default: 'out' }, depth: { type: 'integer', default: 5 }, top_k: { type: 'integer', default: 3 } }, required: ['from'] },
  },
  {
    name: 'graph_dashboard', handler: graphDashboard,
    description: 'Start a local web dashboard to visually browse the project graph. Returns URL.',
    schema: { type: 'object', properties: { port: { type: 'integer' } } },
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
        serverInfo: { name: 'aify-project-graph', version: '0.0.1' },
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
      const result = await tool.handler({ ...args, repoRoot });
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true } });
    }
    return;
  }

  // Unknown method
  if (req.id) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
  }
});
