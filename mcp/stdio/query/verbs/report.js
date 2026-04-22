import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { communitySummary } from '../../analysis/communities.js';

// Filter out noise from report output
const NOISE_LABELS = new Set([
  'requirements.txt', 'package-lock.json', 'yarn.lock', '.gitignore',
  '.eslintrc', '.prettierrc', 'tsconfig.json', '.editorconfig',
]);
const NOISE_ENTRY_PATTERNS = [/^index\.(css|html)$/i, /^__init__\.py$/];

function isNoisyEntry(label) {
  return NOISE_ENTRY_PATTERNS.some(p => p.test(label));
}

function isNoisyDoc(label) {
  return NOISE_LABELS.has(label);
}

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

    // Hub symbols (most incoming edges, excluding common names)
    const hubs = db.all(
      `SELECT n.label, n.type, n.file_path, count(e.from_id) AS fan_in
       FROM nodes n JOIN edges e ON e.to_id = n.id
       WHERE n.type IN ('Function', 'Method', 'Class', 'Interface')
       AND e.relation IN ('CALLS', 'REFERENCES')
       AND n.label NOT IN ('close','open','read','write','get','set','json',
         'log','print','send','parse','init','run','test','str','int','len',
         '__init__','__str__','__repr__','raise_for_status','toString')
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
      if (!isNoisyEntry(e.label)) {
        lines.push(`ENTRY ${e.label} ${e.file_path}:${e.start_line}`);
      }
    }

    for (const d of dirs) {
      lines.push(`DIR ${d.label} ${d.children} children`);
    }

    for (const d of docs) {
      if (!isNoisyDoc(d.label)) {
        lines.push(`DOC ${d.label} ${d.file_path}`);
      }
    }

    for (const h of hubs) {
      lines.push(`HUB ${h.label} ${h.type.toLowerCase()} ${h.file_path} ${h.fan_in} incoming`);
    }

    // Community summary (Leiden clusters)
    const communities = communitySummary(db);
    if (communities.size > 0) {
      lines.push(`COMMUNITIES ${communities.size} detected`);
      let clusterCount = 0;
      for (const [cid, members] of communities) {
        if (clusterCount >= 10) break;
        const memberStr = members.map(m => `${m.label}(${(m.type ?? 'unknown').toLowerCase()})`).join(', ');
        lines.push(`  CLUSTER ${cid}: ${memberStr}`);
        clusterCount++;
      }
    }

    // Token budget enforcement
    const TOKEN_BUDGET = 1500;
    const estimateTokens = (text) => Math.ceil(text.length / 4);
    let output = lines.join('\n');
    if (estimateTokens(output) > TOKEN_BUDGET) {
      // Truncate from the bottom: communities first, then dirs, then entries
      const sections = ['  CLUSTER', 'DIR ', 'ENTRY '];
      for (const prefix of sections) {
        while (estimateTokens(lines.join('\n')) > TOKEN_BUDGET) {
          const idx = lines.findLastIndex(l => l.startsWith(prefix));
          if (idx === -1) break;
          lines.splice(idx, 1);
        }
      }
      lines.push('TRUNCATED — output exceeded token budget');
      output = lines.join('\n');
    }

    return output;
  } finally {
    db.close();
  }
}
