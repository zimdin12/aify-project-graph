import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderPath } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';

const ROOT_TYPE_PRIORITY = new Map([
  ['Entrypoint', 0],
  ['Route', 1],
  ['Function', 2],
  ['Method', 3],
  ['Test', 4],
  ['Class', 5],
  ['Interface', 6],
  ['Type', 7],
  ['Variable', 8],
  ['Symbol', 9],
  ['External', 10],
  ['Module', 11],
  ['File', 12],
  ['Document', 13],
  ['Config', 14],
  ['Directory', 15],
  ['Schema', 16],
]);

const EDGE_PRIORITY = new Map([
  ['PASSES_THROUGH', 0],
  ['INVOKES', 1],
  ['CALLS', 2],
  ['TESTS', 3],
  ['REFERENCES', 4],
]);

const MODE_RELATIONS = {
  execution: ['PASSES_THROUGH', 'INVOKES', 'CALLS'],
  dependency: ['PASSES_THROUGH', 'INVOKES', 'CALLS', 'TESTS', 'REFERENCES'],
};

export async function graphPath({ repoRoot, symbol, direction = 'out', depth = 5, top_k = 3, mode = 'execution' }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const sources = resolveSymbol(db, symbol);
    if (sources.length === 0) return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
    const ambiguity = buildAmbiguousMatchMessage(symbol, sources);
    if (ambiguity) return ambiguity;

    const root = selectBestRoot(sources);
    const relations = MODE_RELATIONS[mode] ?? MODE_RELATIONS.execution;
    const explorationWidth = Math.max(top_k * 4, 12);
    const path = buildPaths(db, root, {
      direction,
      maxDepth: depth,
      explorationWidth,
      relations,
      visited: new Set(),
    });

    if (!path) return `NO PATHS from "${symbol}". The symbol may be a leaf node with no outgoing calls. Try graph_neighbors(symbol="${symbol}") to see all connections.`;
    return renderPath(trimPaths([path], top_k));
  } finally {
    db.close();
  }
}

export function selectBestRoot(nodes) {
  return [...nodes].sort((a, b) => {
    const typeDelta = rootPriority(a.type) - rootPriority(b.type);
    if (typeDelta !== 0) return typeDelta;

    const confidenceDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confidenceDelta !== 0) return confidenceDelta;

    const fileDelta = (a.file_path ?? '').length - (b.file_path ?? '').length;
    if (fileDelta !== 0) return fileDelta;

    return (a.start_line ?? 0) - (b.start_line ?? 0);
  })[0];
}

function rootPriority(type) {
  return ROOT_TYPE_PRIORITY.get(type) ?? 999;
}

function edgePriority(relation) {
  return EDGE_PRIORITY.get(relation) ?? 999;
}

function sortConnections(rows) {
  return [...rows].sort((a, b) => {
    const relationDelta = edgePriority(a.relation) - edgePriority(b.relation);
    if (relationDelta !== 0) return relationDelta;

    const edgeConfidenceDelta = (b.edge_confidence ?? 0) - (a.edge_confidence ?? 0);
    if (edgeConfidenceDelta !== 0) return edgeConfidenceDelta;

    const nodeTypeDelta = rootPriority(a.node_type) - rootPriority(b.node_type);
    if (nodeTypeDelta !== 0) return nodeTypeDelta;

    const nodeConfidenceDelta = (b.node_confidence ?? 0) - (a.node_confidence ?? 0);
    if (nodeConfidenceDelta !== 0) return nodeConfidenceDelta;

    return (a.label ?? '').localeCompare(b.label ?? '');
  });
}

export function trimPaths(paths, topK) {
  return paths.map((path) => ({
    ...path,
    children: trimPaths((path.children ?? []).slice(0, topK), topK),
  }));
}

function collectPathNodeIds(path, out = new Set()) {
  if (!path) return out;
  if (path.id) out.add(path.id);
  for (const child of path.children ?? []) {
    collectPathNodeIds(child, out);
  }
  return out;
}

function pruneShadowedChildren(children = []) {
  const kept = [];
  const descendantIds = new Set();

  for (const child of children) {
    if (child.id && descendantIds.has(child.id)) {
      continue;
    }

    kept.push(child);
    collectPathNodeIds(child, descendantIds);
  }

  return kept;
}

export function buildPaths(db, node, {
  direction,
  maxDepth,
  explorationWidth,
  relations,
  visited,
}) {
  const nodeId = node.node_id ?? node.id;
  if (!nodeId || maxDepth <= 0 || visited.has(nodeId)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const result = {
    id: nodeId,
    symbol: node.label,
    file: node.file_path,
    line: node.start_line,
    confidence: node.confidence ?? node.node_confidence ?? 1.0,
    children: [],
  };

  const relFilter = relations.map((_, index) => `$rel${index}`).join(', ');
  const relParams = Object.fromEntries(relations.map((relation, index) => [`rel${index}`, relation]));
  const edges = direction === 'out'
    ? db.all(
        `SELECT n.id AS node_id, n.label, n.type AS node_type, n.file_path, n.start_line,
                n.confidence AS node_confidence, e.relation, e.confidence AS edge_confidence,
                e.provenance AS edge_provenance
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.from_id = $id AND e.relation IN (${relFilter})
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: nodeId, limit: explorationWidth, ...relParams }
      )
    : db.all(
        `SELECT n.id AS node_id, n.label, n.type AS node_type, n.file_path, n.start_line,
                n.confidence AS node_confidence, e.relation, e.confidence AS edge_confidence,
                e.provenance AS edge_provenance
         FROM edges e JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id = $id AND e.relation IN (${relFilter})
         ORDER BY e.confidence DESC LIMIT $limit`,
        { id: nodeId, limit: explorationWidth, ...relParams }
      );

  for (const edge of sortConnections(edges)) {
    const child = buildPaths(db, edge, {
      direction,
      maxDepth: maxDepth - 1,
      explorationWidth,
      relations,
      visited: nextVisited,
    });

    if (child) {
      child.provenance = edge.edge_provenance ?? 'EXTRACTED';
      result.children.push(child);
      continue;
    }

    result.children.push({
      symbol: edge.label,
      file: edge.file_path,
      line: edge.start_line,
      confidence: edge.node_confidence ?? edge.edge_confidence ?? 0.9,
      provenance: edge.edge_provenance ?? 'EXTRACTED',
      children: [],
    });
  }

  result.children = pruneShadowedChildren(result.children);
  return result;
}
