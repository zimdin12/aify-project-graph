#!/usr/bin/env node
// Side-by-side Louvain vs Leiden bench on an existing .aify-graph.
// Computes modularity (Newman-Girvan formula) for both partitions on
// the SAME adjacency, so the comparison is apples-to-apples — not
// two different graph builders.
//
// Usage: node scripts/communities-bench.mjs [<repoRoot>]
// Outputs JSON lines to stdout. No dependency installs; expects
// graphology, graphology-communities-louvain, ngraph.graph, and
// ngraph.leiden to be importable.

import { openDb } from '../mcp/stdio/storage/db.js';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import createGraph from 'ngraph.graph';
import * as leiden from 'ngraph.leiden';

const repoRoot = process.argv[2] || '.';
const db = openDb(`${repoRoot}/.aify-graph/graph.sqlite`);

try {
  const nodes = db.all('SELECT id FROM nodes');
  const rawEdges = db.all('SELECT from_id, to_id, confidence FROM edges');

  // Build de-duplicated undirected edge list (both algorithms expect this).
  const seen = new Set();
  const edges = [];
  for (const e of rawEdges) {
    if (e.from_id === e.to_id) continue;
    if (!nodes.some) {} // noop to silence linter
    const key = e.from_id < e.to_id ? `${e.from_id}|${e.to_id}` : `${e.to_id}|${e.from_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a: e.from_id, b: e.to_id, w: e.confidence ?? 1.0 });
  }

  console.log(JSON.stringify({
    event: 'graph-stats',
    nodes: nodes.length,
    rawEdges: rawEdges.length,
    uniqueEdges: edges.length,
  }));

  // ---- Louvain ----
  const gL = new Graph({ type: 'undirected', allowSelfLoops: false });
  for (const n of nodes) gL.addNode(n.id);
  for (const e of edges) {
    try { gL.addEdge(e.a, e.b, { weight: e.w }); } catch {}
  }
  const tL0 = Date.now();
  const louvainAssign = louvain(gL, { resolution: 1.0 });
  const tLouvain = Date.now() - tL0;
  const louvainSizes = sizeDistribution(Object.values(louvainAssign));
  const louvainMod = modularity(edges, (id) => louvainAssign[id]);
  console.log(JSON.stringify({
    event: 'louvain',
    elapsedMs: tLouvain,
    communities: new Set(Object.values(louvainAssign)).size,
    modularity: louvainMod,
    topSizes: louvainSizes.slice(0, 10),
    singletons: louvainSizes.filter(n => n === 1).length,
  }));

  // ---- Leiden (modularity quality, default) ----
  const runLeiden = (opts, label) => {
    const gN = createGraph();
    for (const n of nodes) gN.addNode(n.id);
    for (const e of edges) gN.addLink(e.a, e.b, { weight: e.w });
    const t0 = Date.now();
    const res = leiden.detectClusters(gN, { random: seededRandom(42), ...opts });
    const elapsed = Date.now() - t0;
    const assign = {};
    gN.forEachNode((n) => { assign[n.id] = res.getClass(n.id); });
    const sizes = sizeDistribution(Object.values(assign));
    const mod = modularity(edges, (id) => assign[id]);
    console.log(JSON.stringify({
      event: label,
      elapsedMs: elapsed,
      communities: new Set(Object.values(assign)).size,
      modularity: mod,
      topSizes: sizes.slice(0, 10),
      singletons: sizes.filter(n => n === 1).length,
    }));
    return { mod, sizes };
  };

  const leidenDefault = runLeiden({}, 'leiden-modularity');
  const leidenCPM1 = runLeiden({ quality: 'cpm', resolution: 0.01 }, 'leiden-cpm-0.01');
  const leidenCPM5 = runLeiden({ quality: 'cpm', resolution: 0.001 }, 'leiden-cpm-0.001');

  // ---- Delta ----
  const best = [leidenDefault.mod, leidenCPM1.mod, leidenCPM5.mod].indexOf(
    Math.max(leidenDefault.mod, leidenCPM1.mod, leidenCPM5.mod),
  );
  const labels = ['leiden-modularity', 'leiden-cpm-0.01', 'leiden-cpm-0.001'];
  console.log(JSON.stringify({
    event: 'delta',
    louvain_modularity: louvainMod,
    leiden_default_modularity: leidenDefault.mod,
    best_leiden_variant: labels[best],
    best_leiden_modularity: [leidenDefault.mod, leidenCPM1.mod, leidenCPM5.mod][best],
    verdict: leidenDefault.mod > louvainMod ? 'leiden better (default)' : 'louvain modularity higher',
  }));
} finally {
  db.close();
}

function sizeDistribution(assignments) {
  const sizes = new Map();
  for (const cid of assignments) sizes.set(cid, (sizes.get(cid) ?? 0) + 1);
  return [...sizes.values()].sort((a, b) => b - a);
}

// Newman-Girvan modularity Q = 1/(2m) Σᵢⱼ [Aᵢⱼ − kᵢkⱼ/(2m)] δ(cᵢ,cⱼ)
// Computed directly on the shared edge list so both partitions are
// measured on identical adjacency — apples to apples.
function modularity(edges, classOf) {
  let m = 0;
  const degree = new Map();
  for (const e of edges) {
    const w = e.w ?? 1;
    m += w;
    degree.set(e.a, (degree.get(e.a) ?? 0) + w);
    degree.set(e.b, (degree.get(e.b) ?? 0) + w);
  }
  if (m === 0) return 0;
  let q = 0;
  for (const e of edges) {
    if (classOf(e.a) !== classOf(e.b)) continue;
    const w = e.w ?? 1;
    const ki = degree.get(e.a) ?? 0;
    const kj = degree.get(e.b) ?? 0;
    // Edge contributes 2× (undirected), minus expected-under-null.
    q += 2 * (w - (ki * kj) / (2 * m));
  }
  // Self-loop case — intra-community sum already included; divide by 2m.
  q /= 2 * m;
  return Number(q.toFixed(4));
}

function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
