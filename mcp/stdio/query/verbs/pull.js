// graph_pull — canonical cross-layer precision verb.
//
// Given a node identifier (file path, feature id, symbol name, or task id)
// returns everything connected across layers: code graph neighbors +
// containing features + related tasks + recent commits + test/risk anchors.
//
// Selective `layers` param so callers don't explode context when they
// only need part of the picture. Default is compact cross-layer summary.
//
// Not a replacement for graph_impact/graph_path/graph_callers — those
// still exist for tight precision queries within the code layer. This
// verb is for "give me everything about X."

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { loadFunctionality, featuresForFile } from '../../overlay/loader.js';

const ALL_LAYERS = ['code', 'functionality', 'tasks', 'docs', 'activity'];
const DEFAULT_LAYERS = ['code', 'functionality', 'tasks', 'activity'];

function detectNodeKind(db, node) {
  if (!node) return { kind: 'unknown' };
  // Task id heuristic: uppercase-prefix + hyphen + alphanumeric (CU-123, T-45)
  if (/^[A-Z]{1,5}-\w{2,}$/.test(node)) return { kind: 'task' };
  // File path: has a slash or ends in a known extension
  if (/\//.test(node) || /\.(js|ts|py|php|cpp|h|go|rs|rb|java|md|json)$/i.test(node)) {
    return { kind: 'file', value: node };
  }
  // Check db for symbol
  const sym = db.get(
    `SELECT label, type, file_path, start_line FROM nodes
     WHERE label = $node AND type IN ('Function','Method','Class','Interface','Type')
     LIMIT 1`, { node });
  if (sym) return { kind: 'symbol', value: sym };
  // Check if it matches a feature id (caller must pass overlay features; we
  // can't resolve here without loading overlay separately).
  return { kind: 'unknown', value: node };
}

function loadTasksSafe(repoRoot) {
  const p = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')).tasks || [];
  } catch { return []; }
}

function recentCommitsForFile(repoRoot, filePath, limit = 5) {
  try {
    const out = execFileSync('git',
      ['-C', repoRoot, 'log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', String(limit), '--', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').filter(Boolean).map(l => {
      const [sha, date, subject] = l.split('|');
      return { sha, date, subject };
    });
  } catch { return []; }
}

// ---------- per-kind pulls ----------

function pullFile({ db, filePath, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'file', path: filePath }, layers: {} };

  if (layers.has('code')) {
    const fileNode = db.get(
      `SELECT id, label, file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: filePath });
    if (!fileNode) {
      out.layers.code = { error: 'file not in graph', path: filePath };
    } else {
      const symbols = db.all(
        `SELECT label, type, start_line FROM nodes
         WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
         ORDER BY start_line LIMIT 20`, { p: filePath });
      out.layers.code = { file: filePath, symbols };
    }
  }

  if (layers.has('functionality')) {
    const matchedIds = featuresForFile(features, filePath);
    out.layers.functionality = {
      features: matchedIds,
      orphan: matchedIds.length === 0,
    };
  }

  if (layers.has('tasks')) {
    const matched = allTasks.filter(t =>
      (t.files_hint || []).includes(filePath)
      || (t.features || []).some(fid => featuresForFile(features, filePath).includes(fid))
    );
    out.layers.tasks = matched.slice(0, 10).map(t => ({ id: t.id, title: t.title, status: t.status, features: t.features }));
  }

  if (layers.has('activity')) {
    out.layers.activity = recentCommitsForFile(repoRoot, filePath, 5);
  }

  return out;
}

function pullFeature({ db, featureId, features, allTasks, repoRoot, layers }) {
  const feature = features.find(f => f.id === featureId);
  if (!feature) return { node: { kind: 'feature', id: featureId }, error: 'feature not found in functionality.json' };
  const out = { node: { kind: 'feature', id: featureId, label: feature.label, description: feature.description }, layers: {} };

  if (layers.has('code')) {
    // Files matched by this feature's anchors
    const hits = [];
    for (const glob of feature.anchors.files) {
      const rows = db.all(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 15`, { g: glob });
      for (const r of rows) if (!hits.includes(r.file_path)) hits.push(r.file_path);
    }
    const symbols = db.all(
      `SELECT label, type, file_path, start_line FROM nodes
       WHERE label IN (${feature.anchors.symbols.map((_, i) => `$s${i}`).join(',') || "''"})
       AND type IN ('Function','Method','Class','Interface','Type')`,
      Object.fromEntries(feature.anchors.symbols.map((s, i) => [`s${i}`, s]))
    );
    out.layers.code = { files: hits.slice(0, 15), symbols };
  }

  if (layers.has('functionality')) {
    out.layers.functionality = {
      depends_on: feature.depends_on,
      related_to: feature.related_to,
      dependents: features.filter(f => f.depends_on.includes(featureId)).map(f => f.id),
    };
  }

  if (layers.has('tasks')) {
    const matched = allTasks.filter(t => (t.features || []).includes(featureId));
    out.layers.tasks = matched.slice(0, 10).map(t => ({ id: t.id, title: t.title, status: t.status }));
  }

  if (layers.has('activity')) {
    // Walk feature's file anchors, get recent commits touching any of them.
    try {
      const globs = feature.anchors.files.filter(g => !g.includes('**')); // skip ** for subprocess arg safety
      if (globs.length > 0) {
        const args = ['-C', repoRoot, 'log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', '8', '--', ...globs];
        const raw = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        out.layers.activity = raw.trim().split('\n').filter(Boolean).map(l => {
          const [sha, date, subject] = l.split('|');
          return { sha, date, subject };
        });
      } else {
        out.layers.activity = [];
      }
    } catch { out.layers.activity = []; }
  }

  if (layers.has('docs')) {
    out.layers.docs = feature.anchors.docs;
  }

  return out;
}

function pullSymbol({ db, sym, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'symbol', label: sym.label, type: sym.type, file: sym.file_path, line: sym.start_line }, layers: {} };

  if (layers.has('code')) {
    const callers = db.all(
      `SELECT DISTINCT fn.label, fn.file_path, fn.start_line
       FROM edges e JOIN nodes fn ON fn.id = e.from_id
       WHERE e.to_id IN (SELECT id FROM nodes WHERE label = $l)
         AND e.relation IN ('CALLS','REFERENCES','USES_TYPE')
       LIMIT 8`, { l: sym.label });
    out.layers.code = { callers, file: sym.file_path };
  }

  if (layers.has('functionality')) {
    const matched = features.filter(f => f.anchors.symbols.includes(sym.label) || featuresForFile([f], sym.file_path).length > 0);
    out.layers.functionality = { features: matched.map(f => f.id) };
  }

  if (layers.has('tasks')) {
    const matched = allTasks.filter(t =>
      (t.title || '').toLowerCase().includes(sym.label.toLowerCase())
      || (t.files_hint || []).includes(sym.file_path)
    );
    out.layers.tasks = matched.slice(0, 10).map(t => ({ id: t.id, title: t.title, status: t.status }));
  }

  if (layers.has('activity')) {
    out.layers.activity = recentCommitsForFile(repoRoot, sym.file_path, 5);
  }

  return out;
}

function pullTask({ taskId, features, allTasks, repoRoot, layers }) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return { node: { kind: 'task', id: taskId }, error: 'task not found in tasks.json' };
  const out = { node: { kind: 'task', id: task.id, title: task.title, status: task.status, url: task.url }, layers: {} };

  if (layers.has('functionality')) {
    out.layers.functionality = {
      features: task.features || [],
      feature_labels: (task.features || []).map(fid => features.find(f => f.id === fid)?.label).filter(Boolean),
    };
  }

  if (layers.has('code')) {
    out.layers.code = { files: task.files_hint || [] };
  }

  if (layers.has('activity')) {
    try {
      const raw = execFileSync('git',
        ['-C', repoRoot, 'log', `--grep=${task.id}`, '--pretty=format:%h|%ad|%s', '--date=short', '-n', '8'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      out.layers.activity = raw.trim().split('\n').filter(Boolean).map(l => {
        const [sha, date, subject] = l.split('|');
        return { sha, date, subject };
      });
    } catch { out.layers.activity = []; }
  }

  return out;
}

// ---------- main ----------

export async function graphPull({ repoRoot, node, layers }) {
  if (!node) return 'ERROR: node parameter is required (file path, feature id, symbol name, or task id)';
  await ensureFresh({ repoRoot });

  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const layerSet = new Set(
    Array.isArray(layers) && layers.length > 0
      ? layers.filter(l => ALL_LAYERS.includes(l))
      : DEFAULT_LAYERS
  );

  try {
    const overlay = loadFunctionality(repoRoot);
    const allTasks = loadTasksSafe(repoRoot);
    const features = overlay.features;

    // Resolve node kind. Try feature id first (cheap exact match).
    const featureMatch = features.find(f => f.id === node);
    if (featureMatch) {
      const result = pullFeature({ db, featureId: node, features, allTasks, repoRoot, layers: layerSet });
      return JSON.stringify(result, null, 2);
    }
    // Task id?
    const taskMatch = allTasks.find(t => t.id === node);
    if (taskMatch) {
      const result = pullTask({ taskId: node, features, allTasks, repoRoot, layers: layerSet });
      return JSON.stringify(result, null, 2);
    }
    // File or symbol?
    const detected = detectNodeKind(db, node);
    if (detected.kind === 'file') {
      const result = pullFile({ db, filePath: detected.value, features, allTasks, repoRoot, layers: layerSet });
      return JSON.stringify(result, null, 2);
    }
    if (detected.kind === 'symbol') {
      const result = pullSymbol({ db, sym: detected.value, features, allTasks, repoRoot, layers: layerSet });
      return JSON.stringify(result, null, 2);
    }
    return JSON.stringify({
      node: { kind: 'unresolved', value: node },
      error: 'could not resolve as feature id, task id, file path, or symbol',
      hint: 'try graph_whereis(symbol=...) or graph_search(query=...) to find the right node identifier',
    }, null, 2);
  } finally {
    db.close();
  }
}
