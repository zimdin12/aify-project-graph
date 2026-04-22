import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';

const HUB_NOISE = new Set([
  'get', 'set', 'run', 'init', 'test', 'close', 'open', 'read', 'write',
  'json', 'print', 'log', 'parse', 'constructor',
]);

function trustLine(dirtyCount) {
  if (dirtyCount > 100) return `TRUST WEAK — ${dirtyCount} unresolved edges in graph`;
  if (dirtyCount > 0) return `TRUST OK — ${dirtyCount} unresolved edges in graph`;
  return 'TRUST STRONG — 0 unresolved edges';
}

function normalizePath(path) {
  if (!path || path === '.') return '';
  return path.replace(/\\/g, '/');
}

function dedupeFiles(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.file || seen.has(entry.file)) continue;
    seen.add(entry.file);
    out.push(entry);
  }
  return out;
}

export function buildOnboard(db, { path = '.', top_k = 6, dirtyCount = 0 }) {
  const prefix = normalizePath(path);
  const pattern = prefix ? `${prefix}%` : '%';

  const fileCount = db.get(
    `SELECT COUNT(*) AS c FROM nodes WHERE type = 'File' AND file_path LIKE $pattern`,
    { pattern },
  ).c;
  if (fileCount === 0) {
    return prefix
      ? `NO SCOPE matching "${path}". Try graph_module_tree(path=".") to browse available paths.`
      : 'NO FILES indexed.';
  }

  const symbolCount = db.get(
    `SELECT COUNT(*) AS c
     FROM nodes
     WHERE file_path LIKE $pattern
       AND type NOT IN ('File', 'Module', 'Directory', 'Document', 'Config')`,
    { pattern },
  ).c;

  const entries = db.all(
    `SELECT label, type, file_path, start_line
     FROM nodes
     WHERE type IN ('Entrypoint', 'Route') AND file_path LIKE $pattern
     ORDER BY type, label
     LIMIT $limit`,
    { pattern, limit: top_k },
  );
  const docs = db.all(
    `SELECT label, file_path
     FROM nodes
     WHERE type = 'Document' AND file_path LIKE $pattern
     ORDER BY CASE WHEN label = 'README.md' THEN 0 ELSE 1 END, label
     LIMIT $limit`,
    { pattern, limit: top_k },
  );
  const hotFiles = db.all(
    `SELECT n.file_path AS file, COUNT(DISTINCT e.rowid) AS degree
     FROM nodes n
     LEFT JOIN edges e ON (e.from_id = n.id OR e.to_id = n.id)
     WHERE n.file_path LIKE $pattern
       AND n.type NOT IN ('File', 'Module', 'Directory', 'Document', 'Config')
     GROUP BY n.file_path
     ORDER BY degree DESC, n.file_path
     LIMIT $limit`,
    { pattern, limit: top_k },
  );
  const hubs = db.all(
    `SELECT n.label, n.type, n.file_path, COUNT(e.from_id) AS fan_in
     FROM nodes n
     JOIN edges e ON e.to_id = n.id
     WHERE n.file_path LIKE $pattern
       AND n.type IN ('Function', 'Method', 'Class', 'Interface', 'Type', 'Route', 'Entrypoint')
     GROUP BY n.id
     ORDER BY fan_in DESC, n.label
     LIMIT 50`,
    { pattern },
  ).filter((row) => !HUB_NOISE.has(row.label)).slice(0, top_k);
  const tests = db.all(
    `SELECT n.file_path AS file, COUNT(*) AS coverage
     FROM edges e
     JOIN nodes n ON n.id = e.from_id
     JOIN nodes t ON t.id = e.to_id
     WHERE e.relation = 'TESTS'
       AND t.file_path LIKE $pattern
     GROUP BY n.file_path
     ORDER BY coverage DESC, n.file_path
     LIMIT $limit`,
    { pattern, limit: top_k },
  );

  const readOrder = dedupeFiles([
    ...docs.map((doc) => ({ file: doc.file_path, reason: 'high-level overview document' })),
    ...entries.map((entry) => ({ file: entry.file_path, reason: `${entry.type.toLowerCase()} entry flow` })),
    ...hotFiles.map((file) => ({ file: file.file, reason: `${file.degree} graph connections` })),
    ...tests.map((test) => ({ file: test.file, reason: `${test.coverage} coverage edge${test.coverage === 1 ? '' : 's'}` })),
  ]).slice(0, top_k);

  const lines = [];
  lines.push(`ONBOARD ${path}`);
  lines.push(`SCOPE ${fileCount} file(s), ${symbolCount} symbol(s)`);
  lines.push(trustLine(dirtyCount));
  if (entries.length > 0) {
    lines.push('ENTRY POINTS');
    entries.forEach((entry) => {
      lines.push(`- ${entry.label} ${(entry.type ?? 'unknown').toLowerCase()} ${entry.file_path}:${entry.start_line}`);
    });
  }
  if (hotFiles.length > 0) {
    lines.push('KEY FILES');
    hotFiles.forEach((file) => {
      lines.push(`- ${file.file} — ${file.degree} graph connection${file.degree === 1 ? '' : 's'}`);
    });
  }
  if (hubs.length > 0) {
    lines.push('HUB SYMBOLS');
    hubs.forEach((hub) => {
      lines.push(`- ${hub.label} ${(hub.type ?? 'unknown').toLowerCase()} ${hub.file_path} ${hub.fan_in} incoming`);
    });
  }
  lines.push('START HERE');
  readOrder.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.file} — ${item.reason}`);
  });
  if (tests.length > 0) {
    lines.push('TEST ANCHORS');
    tests.forEach((test) => {
      lines.push(`- ${test.file} — ${test.coverage} coverage edge${test.coverage === 1 ? '' : 's'}`);
    });
  }

  return lines.join('\n');
}

export async function graphOnboard({ repoRoot, path = '.', top_k = 6 }) {
  await ensureFresh({ repoRoot });
  const graphDir = join(repoRoot, '.aify-graph');
  const { manifest } = await loadManifest(graphDir);
  const { trust: dirtyCount } = getUnresolvedCounts(manifest);
  const db = openDb(join(graphDir, 'graph.sqlite'));
  try {
    return buildOnboard(db, { path, top_k, dirtyCount });
  } finally {
    db.close();
  }
}
