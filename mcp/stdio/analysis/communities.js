import createGraph from 'ngraph.graph';
import * as leiden from 'ngraph.leiden';

/**
 * Run Leiden community detection on the graph stored in SQLite.
 * Reads nodes + edges, builds an ngraph, runs Leiden, writes
 * community_id back to each node row.
 *
 * Returns { communities: number, assignments: Map<nodeId, communityId> }
 *
 * Why Leiden and not Louvain: graphify (the design inspiration) uses
 * Leiden; Leiden gives strictly better partition quality than Louvain
 * — guaranteed well-connected communities and modestly higher
 * modularity on typical code graphs. ngraph.leiden (anvaka, MIT) is a
 * maintained JS port that drops into ngraph.graph with no native deps.
 */
export function detectCommunities(db) {
  const nodes = db.all('SELECT id, type, label FROM nodes');
  const edges = db.all('SELECT from_id, to_id, relation, confidence FROM edges');

  if (nodes.length === 0) return { communities: 0, assignments: new Map() };

  const g = createGraph();

  for (const n of nodes) {
    g.addNode(n.id, { type: n.type, label: n.label });
  }

  // Undirected, deduped edges — leiden treats weights as symmetric and
  // a duplicated link is a self-inflicted weight boost. The key combines
  // the two endpoints in sorted order so A→B and B→A collapse.
  const seen = new Set();
  for (const e of edges) {
    if (!g.hasNode(e.from_id) || !g.hasNode(e.to_id)) continue;
    if (e.from_id === e.to_id) continue;
    const key = e.from_id < e.to_id
      ? `${e.from_id}|${e.to_id}`
      : `${e.to_id}|${e.from_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.addLink(e.from_id, e.to_id, { weight: e.confidence ?? 1.0 });
  }

  if (g.getNodesCount() < 2 || g.getLinksCount() === 0) {
    return { communities: 0, assignments: new Map() };
  }

  // Leiden. Deterministic random seed keeps clusters stable across runs
  // when the graph itself hasn't changed — important so community_id
  // doesn't churn in every brief on every index.
  const result = leiden.detectClusters(g, { random: seededRandom(42) });

  const assignments = new Map();
  g.forEachNode((node) => {
    assignments.set(node.id, result.getClass(node.id));
  });

  const updateExtra = db.raw.prepare('UPDATE nodes SET extra = ? WHERE id = ?');
  const readExtra = db.raw.prepare('SELECT extra FROM nodes WHERE id = ?');
  const txn = db.raw.transaction((pairs) => {
    for (const [nodeId, communityId] of pairs) {
      const row = readExtra.get(nodeId);
      if (!row) continue;
      const extra = JSON.parse(row.extra || '{}');
      extra.community_id = communityId;
      updateExtra.run(JSON.stringify(extra), nodeId);
    }
  });
  txn([...assignments]);

  return {
    communities: new Set(assignments.values()).size,
    assignments,
  };
}

// Deterministic seeded PRNG (mulberry32) so repeated indexes of an
// unchanged graph produce identical community_ids. ngraph.leiden accepts
// any function returning floats in [0, 1).
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

/**
 * Get community summary: for each community, list the top members by edge count.
 */
export function communitySummary(db, topPerCommunity = 5) {
  const rows = db.all(`
    SELECT n.id, n.label, n.type, n.file_path, json_extract(n.extra, '$.community_id') AS community_id,
           (SELECT count(*) FROM edges e WHERE e.to_id = n.id) AS fan_in
    FROM nodes n
    WHERE json_extract(n.extra, '$.community_id') IS NOT NULL
    ORDER BY community_id, fan_in DESC
  `);

  const groups = new Map();
  for (const r of rows) {
    const cid = r.community_id;
    if (!groups.has(cid)) groups.set(cid, []);
    const members = groups.get(cid);
    if (members.length < topPerCommunity) {
      members.push({ label: r.label, type: r.type, file_path: r.file_path, fan_in: r.fan_in });
    }
  }

  return groups;
}
