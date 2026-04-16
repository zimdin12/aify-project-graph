import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * Run Louvain community detection on the graph stored in SQLite.
 * Reads nodes + edges, builds a graphology graph, runs Louvain,
 * writes community_id back to each node row.
 *
 * Returns { communities: number, assignments: Map<nodeId, communityId> }
 */
export function detectCommunities(db) {
  const nodes = db.all('SELECT id, type, label FROM nodes');
  const edges = db.all('SELECT from_id, to_id, relation, confidence FROM edges');

  if (nodes.length === 0) return { communities: 0, assignments: new Map() };

  const g = new Graph({ type: 'undirected', allowSelfLoops: false });

  // Add nodes
  for (const n of nodes) {
    if (!g.hasNode(n.id)) {
      g.addNode(n.id, { type: n.type, label: n.label });
    }
  }

  // Add edges (undirected for community detection)
  for (const e of edges) {
    if (g.hasNode(e.from_id) && g.hasNode(e.to_id) && e.from_id !== e.to_id) {
      try {
        g.addEdge(e.from_id, e.to_id, {
          weight: e.confidence ?? 1.0,
        });
      } catch {
        // Skip duplicate edges (graphology throws on duplicates in undirected mode)
      }
    }
  }

  if (g.order < 2 || g.size === 0) {
    return { communities: 0, assignments: new Map() };
  }

  // Run Louvain
  const communities = louvain(g, { resolution: 1.0 });

  // Write community_id back to SQLite
  const update = db.raw.prepare('UPDATE nodes SET extra = json_set(extra, \'$.community_id\', ?) WHERE id = ?');
  const updateCommunity = db.raw.prepare('UPDATE nodes SET extra = ? WHERE id = ?');

  const txn = db.raw.transaction((assignments) => {
    for (const [nodeId, communityId] of Object.entries(assignments)) {
      // Store community_id in the extra JSON field
      const row = db.raw.prepare('SELECT extra FROM nodes WHERE id = ?').get(nodeId);
      if (row) {
        const extra = JSON.parse(row.extra || '{}');
        extra.community_id = communityId;
        updateCommunity.run(JSON.stringify(extra), nodeId);
      }
    }
  });
  txn(communities);

  // Count unique communities
  const uniqueCommunities = new Set(Object.values(communities)).size;

  return {
    communities: uniqueCommunities,
    assignments: new Map(Object.entries(communities)),
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
