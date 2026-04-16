import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { communitySummary } from '../../analysis/communities.js';

export async function graphReport({ repoRoot, top_k = 20 }) {
  await ensureFresh({ repoRoot });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const totalNodes = db.get('SELECT count(*) AS c FROM nodes').c;
    const totalEdges = db.get('SELECT count(*) AS c FROM edges').c;
    const totalFiles = db.get("SELECT count(*) AS c FROM nodes WHERE type = 'File'").c;

    // Language breakdown
    const langs = db.all(
      `SELECT language, count(*) AS c FROM nodes
       WHERE type = 'File' AND language != ''
       GROUP BY language ORDER BY c DESC LIMIT 10`
    );

    // Entry points
    const entries = db.all(
      `SELECT label, file_path, start_line FROM nodes
       WHERE type IN ('Entrypoint', 'Route')
       ORDER BY type, label LIMIT $limit`,
      { limit: top_k }
    );

    // Top directories
    const dirs = db.all(
      `SELECT n.label, count(e.to_id) AS children FROM nodes n
       LEFT JOIN edges e ON e.from_id = n.id AND e.relation = 'CONTAINS'
       WHERE n.type = 'Directory'
       GROUP BY n.id ORDER BY children DESC LIMIT 10`
    );

    // Hub symbols (most incoming edges)
    const hubs = db.all(
      `SELECT n.label, n.type, n.file_path, count(e.from_id) AS fan_in
       FROM nodes n JOIN edges e ON e.to_id = n.id
       WHERE n.type IN ('Function', 'Method', 'Class', 'Interface')
       AND e.relation IN ('CALLS', 'REFERENCES')
       GROUP BY n.id ORDER BY fan_in DESC LIMIT 10`
    );

    // Documents
    const docs = db.all(
      `SELECT label, file_path FROM nodes WHERE type = 'Document' LIMIT 5`
    );

    // Build report lines
    const lines = [];
    lines.push(`REPO ${totalFiles} files, ${totalNodes} nodes, ${totalEdges} edges`);

    if (langs.length) {
      const langStr = langs.map(l => `${l.language} (${l.c})`).join(', ');
      lines.push(`LANGS ${langStr}`);
    }

    for (const e of entries) {
      lines.push(`ENTRY ${e.label} ${e.file_path}:${e.start_line}`);
    }

    for (const d of dirs) {
      lines.push(`DIR ${d.label} ${d.children} children`);
    }

    for (const d of docs) {
      lines.push(`DOC ${d.label} ${d.file_path}`);
    }

    for (const h of hubs) {
      lines.push(`HUB ${h.label} ${h.type.toLowerCase()} ${h.file_path} ${h.fan_in} incoming`);
    }

    // Community summary (Louvain clusters)
    const communities = communitySummary(db);
    if (communities.size > 0) {
      lines.push(`COMMUNITIES ${communities.size} detected`);
      for (const [cid, members] of communities) {
        const memberStr = members.map(m => `${m.label}(${m.type.toLowerCase()})`).join(', ');
        lines.push(`  CLUSTER ${cid}: ${memberStr}`);
      }
    }

    return lines.join('\n');
  } finally {
    db.close();
  }
}
