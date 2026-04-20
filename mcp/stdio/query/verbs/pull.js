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

// Layer inventory:
//   code          — file/symbol neighborhood (files, symbols, callers)
//   functionality — feature membership, dependents
//   tasks         — tasks referencing this node
//   docs          — Documents that MENTION this node (via MENTIONS edges)
//   activity      — recent git commits
//   relations     — DIRECT graph neighbors (OPT-IN). Compact, local.
//                   symbol:  { callers, callees }
//                   file:    { imports, imported_by, defines }
//                   feature: { inputs, outputs } cross-feature-boundary, rolled up
//   transitive    — CLOSURE blast radius for features (OPT-IN, heavier).
//                   transitive_{dependencies,dependents} + {upstream,downstream}_files
//                   Separated from relations per dev review: truncation-prone,
//                   trust-sensitive, different tuning.
// Every capped list carries { items, total, truncated, limit } metadata.
const ALL_LAYERS = ['code', 'functionality', 'tasks', 'docs', 'activity', 'relations', 'transitive'];
const DEFAULT_LAYERS = ['code', 'functionality', 'tasks', 'activity'];

function detectNodeKind(db, node) {
  if (!node) return { kind: 'unknown' };
  // Task id heuristic: any alphanumeric prefix + hyphen + id (CU-123, eng-42,
  // GH-1234). Kept broad because task exact match against tasks.json already
  // runs before this fallback — the heuristic only matters when tasks.json
  // is stale or missing the id.
  if (/^[A-Za-z]{1,5}-\w{2,}$/.test(node)) return { kind: 'task' };
  // File path: has a slash or ends in a known extension — but only if it
  // actually exists as a File node. Otherwise fall through so a path-shaped
  // string doesn't shadow a real symbol lookup.
  const looksFileish = /\//.test(node) || /\.(js|ts|py|php|cpp|h|go|rs|rb|java|md|json)$/i.test(node);
  if (looksFileish) {
    const fileHit = db.get(
      `SELECT file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: node });
    if (fileHit) return { kind: 'file', value: node };
  }
  // Symbol lookup
  const sym = db.get(
    `SELECT id, label, type, file_path, start_line FROM nodes
     WHERE label = $node AND type IN ('Function','Method','Class','Interface','Type')
     LIMIT 1`, { node });
  if (sym) return { kind: 'symbol', value: sym };
  return { kind: 'unknown', value: node };
}

// Helper: attach { total, truncated, limit } metadata to a capped collection
// so callers know when they're seeing a summary vs complete results.
function capped(items, limit) {
  const total = items.length;
  const truncated = total > limit;
  return { items: items.slice(0, limit), total, truncated, limit };
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

// ---------- relations helpers (opt-in layer) ----------

// Symbol-level direct neighbors: callers + callees resolved by id (precision,
// not just label — matches the dev-review fix applied to code layer in f8feb6c).
function relationsForSymbol(db, sym, limit = 10) {
  const callersRaw = db.all(
    `SELECT DISTINCT fn.label, fn.type, fn.file_path, fn.start_line, e.relation
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     WHERE e.to_id = $id
       AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE')
     LIMIT 100`, { id: sym.id });
  const calleesRaw = db.all(
    `SELECT DISTINCT tn.label, tn.type, tn.file_path, tn.start_line, e.relation
     FROM edges e
     JOIN nodes tn ON tn.id = e.to_id
     WHERE e.from_id = $id
       AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE')
     LIMIT 100`, { id: sym.id });
  return {
    callers: capped(callersRaw, limit),
    callees: capped(calleesRaw, limit),
  };
}

// File-level direct neighbors: imports + imported_by + defines.
// Per dev review: skip `initializers` and `used_by` — too easy to overclaim
// without a precise language-neutral definition.
function relationsForFile(db, filePath, limit = 10) {
  // imports: files THIS file imports
  const importsRaw = db.all(
    `SELECT DISTINCT tn.file_path
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE fn.file_path = $p
       AND e.relation = 'IMPORTS'
       AND tn.file_path IS NOT NULL
       AND tn.file_path != $p
     LIMIT 50`, { p: filePath });
  // imported_by: files that IMPORT this file
  const importedByRaw = db.all(
    `SELECT DISTINCT fn.file_path
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE tn.file_path = $p
       AND e.relation = 'IMPORTS'
       AND fn.file_path IS NOT NULL
       AND fn.file_path != $p
     LIMIT 50`, { p: filePath });
  // defines: top symbols defined in this file
  const definesRaw = db.all(
    `SELECT label, type, start_line FROM nodes
     WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
     ORDER BY start_line LIMIT 50`, { p: filePath });
  return {
    imports: capped(importsRaw.map(r => r.file_path), limit),
    imported_by: capped(importedByRaw.map(r => r.file_path), limit),
    defines: capped(definesRaw, limit),
  };
}

// Feature-level cross-boundary neighbors, rolled up by feature.
// inputs  = OTHER features whose symbols call into THIS feature's anchored symbols
// outputs = OTHER features whose symbols are called by THIS feature's anchored symbols
// "External" = no feature match for the other side.
function relationsForFeature(db, feature, features, limit = 10) {
  const symbols = feature.anchors.symbols || [];
  if (symbols.length === 0) {
    return { inputs: capped([], limit), outputs: capped([], limit) };
  }
  const symParams = Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]));
  const placeholders = symbols.map((_, i) => `$s${i}`).join(',');

  // Callers (edges INTO this feature's symbols)
  const incoming = db.all(
    `SELECT DISTINCT fn.label AS caller_label, fn.file_path AS caller_file,
            e.relation, tn.label AS target_label
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE tn.label IN (${placeholders})
       AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE')
       AND fn.file_path IS NOT NULL`,
    symParams);
  // Callees (edges FROM this feature's symbols)
  const outgoing = db.all(
    `SELECT DISTINCT fn.label AS source_label, tn.label AS callee_label,
            tn.file_path AS callee_file, e.relation
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE fn.label IN (${placeholders})
       AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE')
       AND tn.file_path IS NOT NULL
       AND tn.file_path != ''`,
    symParams);

  // Roll up by the OTHER feature (or "external" if not in any feature)
  const inputTally = new Map(); // featureId -> { feature_id, count, evidence }
  const outputTally = new Map();

  const classify = (filePath, ownFeatureId) => {
    const matches = featuresForFile(features, filePath);
    const foreign = matches.filter(id => id !== ownFeatureId);
    return foreign.length > 0 ? foreign[0] : 'external';
  };

  for (const row of incoming) {
    const otherFeature = classify(row.caller_file, feature.id);
    if (otherFeature === feature.id) continue; // internal, skip
    if (!inputTally.has(otherFeature)) {
      inputTally.set(otherFeature, { feature: otherFeature, count: 0, sample: [] });
    }
    const entry = inputTally.get(otherFeature);
    entry.count++;
    if (entry.sample.length < 2) {
      entry.sample.push(`${row.caller_label}@${row.caller_file} → ${row.target_label}`);
    }
  }
  for (const row of outgoing) {
    const otherFeature = classify(row.callee_file, feature.id);
    if (otherFeature === feature.id) continue;
    if (!outputTally.has(otherFeature)) {
      outputTally.set(otherFeature, { feature: otherFeature, count: 0, sample: [] });
    }
    const entry = outputTally.get(otherFeature);
    entry.count++;
    if (entry.sample.length < 2) {
      entry.sample.push(`${row.source_label} → ${row.callee_label}@${row.callee_file}`);
    }
  }

  const sortTally = (tally) =>
    [...tally.values()].sort((a, b) => b.count - a.count);

  return {
    inputs: capped(sortTally(inputTally), limit),
    outputs: capped(sortTally(outputTally), limit),
  };
}

// Transitive closure of feature dependencies. Walks either direction via
// visited-set BFS, detects cycles and returns them explicitly. Cycle-safe:
// a feature already in `visited` is never re-expanded.
function walkFeatureClosure(startId, features, direction) {
  const byId = new Map(features.map(f => [f.id, f]));
  // Prebuild the reverse index once when direction='dependents'.
  // Previous version had dead broken code (`.get.bind(null)`) that would
  // throw if ever called AND re-computed the index on each call — bug
  // found in 2026-04-20 round-2 audit.
  const dependentsIdx = direction === 'dependents'
    ? features.reduce((acc, f) => {
        for (const dep of (f.depends_on || [])) {
          if (!acc.has(dep)) acc.set(dep, []);
          acc.get(dep).push(f.id);
        }
        return acc;
      }, new Map())
    : null;

  const visited = new Set();
  const cycles = [];
  const queue = [startId];
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current !== startId) result.push(current);
    const feature = byId.get(current);
    if (!feature) continue;

    let nextIds;
    if (direction === 'dependencies') {
      nextIds = feature.depends_on || [];
    } else {
      nextIds = dependentsIdx.get(current) || [];
    }

    for (const n of nextIds) {
      if (visited.has(n)) {
        // Cycle — if n was already visited AND is in our walk ancestor chain
        if (result.includes(n) || n === startId) {
          const pair = [current, n].sort().join('↔');
          if (!cycles.includes(pair)) cycles.push(pair);
        }
        continue;
      }
      queue.push(n);
    }
  }

  return { features: result, cycles };
}

function filesForFeatures(db, features, featureIds, cap) {
  const selected = featureIds
    .map(id => features.find(f => f.id === id))
    .filter(Boolean);
  const allFiles = new Set();
  for (const f of selected) {
    for (const glob of (f.anchors.files || [])) {
      const rows = db.all(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 100`,
        { g: glob });
      for (const r of rows) allFiles.add(r.file_path);
      if (allFiles.size >= cap * 4) break; // short-circuit if we've got way more than cap
    }
  }
  return capped([...allFiles], cap);
}

// Transitive relations for features only. Direction can be 'downstream',
// 'upstream', or 'both' (default). Returns summary counts + capped lists.
// Returns a skip-reason if the feature is too weakly anchored for trust.
function transitiveForFeature(db, feature, features, opts = {}) {
  const { direction = 'both', featureCap = 20, fileCap = 50 } = opts;

  // Trust gate: if feature has no anchors AT ALL, skip transitive — dev
  // review: transitive compounds bad feature maps faster than direct.
  const anchorCount = (feature.anchors.symbols || []).length
    + (feature.anchors.files || []).length
    + (feature.anchors.routes || []).length;
  if (anchorCount === 0) {
    return { transitive_skipped: 'reason=weak_feature_no_anchors' };
  }

  const out = {};
  const allCycles = [];

  if (direction === 'upstream' || direction === 'both') {
    const { features: depIds, cycles } = walkFeatureClosure(feature.id, features, 'dependencies');
    out.transitive_dependencies = capped(depIds, featureCap);
    out.upstream_files = filesForFeatures(db, features, depIds, fileCap);
    for (const c of cycles) if (!allCycles.includes(c)) allCycles.push(c);
  }

  if (direction === 'downstream' || direction === 'both') {
    const { features: depIds, cycles } = walkFeatureClosure(feature.id, features, 'dependents');
    out.transitive_dependents = capped(depIds, featureCap);
    out.downstream_files = filesForFeatures(db, features, depIds, fileCap);
    for (const c of cycles) if (!allCycles.includes(c)) allCycles.push(c);
  }

  if (allCycles.length > 0) out.cycles_detected = allCycles;

  return out;
}

function pullFile({ db, filePath, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'file', path: filePath }, layers: {} };

  if (layers.has('code')) {
    const fileNode = db.get(
      `SELECT id, label, file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: filePath });
    if (!fileNode) {
      out.layers.code = { error: 'file not in graph', path: filePath };
    } else {
      const symbolsRaw = db.all(
        `SELECT label, type, start_line FROM nodes
         WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
         ORDER BY start_line LIMIT 200`, { p: filePath });
      out.layers.code = { file: filePath, symbols: capped(symbolsRaw, 20) };
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
    out.layers.tasks = capped(
      matched.map(t => ({ id: t.id, title: t.title, status: t.status, features: t.features })),
      10
    );
  }

  if (layers.has('activity')) {
    out.layers.activity = capped(recentCommitsForFile(repoRoot, filePath, 5), 5);
  }

  if (layers.has('docs')) {
    // Docs that MENTION any symbol defined in this file.
    const docs = db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       JOIN nodes s ON s.id = e.to_id AND s.file_path = $p
       WHERE e.relation = 'MENTIONS'
       LIMIT 20`, { p: filePath });
    out.layers.docs = capped(
      docs.map(d => ({ label: d.label, file: d.file_path })),
      10
    );
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForFile(db, filePath);
  }

  return out;
}

function pullFeature({ db, featureId, features, allTasks, repoRoot, layers, opts = {} }) {
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
    const symbolsRaw = feature.anchors.symbols.length > 0 ? db.all(
      `SELECT label, type, file_path, start_line FROM nodes
       WHERE label IN (${feature.anchors.symbols.map((_, i) => `$s${i}`).join(',')})
       AND type IN ('Function','Method','Class','Interface','Type')`,
      Object.fromEntries(feature.anchors.symbols.map((s, i) => [`s${i}`, s]))
    ) : [];
    out.layers.code = { files: capped(hits, 15), symbols: capped(symbolsRaw, 20) };
  }

  if (layers.has('functionality')) {
    out.layers.functionality = {
      depends_on: feature.depends_on,
      related_to: feature.related_to,
      dependents: features.filter(f => f.depends_on.includes(featureId)).map(f => f.id),
    };
  }

  if (layers.has('tasks')) {
    const matched = allTasks
      .filter(t => (t.features || []).includes(featureId))
      .map(t => ({ id: t.id, title: t.title, status: t.status }));
    out.layers.tasks = capped(matched, 10);
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

  if (layers.has('relations')) {
    out.layers.relations = relationsForFeature(db, feature, features);
  }

  if (layers.has('transitive')) {
    out.layers.transitive = transitiveForFeature(db, feature, features, {
      direction: opts.direction || 'both',
    });
  }

  if (layers.has('docs')) {
    // Declared doc anchors + Docs that MENTION any symbol in this feature's
    // anchored files. Two sources merged so users see both what they
    // curated and what the graph observed.
    const fileGlobs = feature.anchors.files || [];
    const inferred = fileGlobs.length > 0 ? db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       JOIN nodes s ON s.id = e.to_id
       WHERE e.relation = 'MENTIONS'
         AND (${fileGlobs.map((_, i) => `s.file_path GLOB $g${i}`).join(' OR ')})
       LIMIT 30`,
      Object.fromEntries(fileGlobs.map((g, i) => [`g${i}`, g]))
    ) : [];
    out.layers.docs = {
      declared: feature.anchors.docs,
      inferred: capped(inferred.map(d => ({ label: d.label, file: d.file_path })), 10),
    };
  }

  return out;
}

function pullSymbol({ db, sym, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'symbol', label: sym.label, type: sym.type, file: sym.file_path, line: sym.start_line }, layers: {} };

  if (layers.has('code')) {
    // Dev review: use resolved symbol id directly, not label. Same-named
    // methods across files would otherwise all match.
    const callersRaw = db.all(
      `SELECT DISTINCT fn.label, fn.file_path, fn.start_line
       FROM edges e JOIN nodes fn ON fn.id = e.from_id
       WHERE e.to_id = $id
         AND e.relation IN ('CALLS','REFERENCES','USES_TYPE')
       LIMIT 100`, { id: sym.id });
    out.layers.code = { callers: capped(callersRaw, 8), file: sym.file_path };
  }

  if (layers.has('functionality')) {
    const matched = features.filter(f => f.anchors.symbols.includes(sym.label) || featuresForFile([f], sym.file_path).length > 0);
    out.layers.functionality = { features: matched.map(f => f.id) };
  }

  if (layers.has('tasks')) {
    const matched = allTasks
      .filter(t =>
        (t.title || '').toLowerCase().includes(sym.label.toLowerCase())
        || (t.files_hint || []).includes(sym.file_path)
      )
      .map(t => ({ id: t.id, title: t.title, status: t.status }));
    out.layers.tasks = capped(matched, 10);
  }

  if (layers.has('activity')) {
    out.layers.activity = capped(recentCommitsForFile(repoRoot, sym.file_path, 5), 5);
  }

  if (layers.has('docs')) {
    // Docs that MENTION this specific symbol id.
    const docs = db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       WHERE e.relation = 'MENTIONS' AND e.to_id = $id
       LIMIT 20`, { id: sym.id });
    out.layers.docs = capped(
      docs.map(d => ({ label: d.label, file: d.file_path })),
      10
    );
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForSymbol(db, sym);
  }

  return out;
}

function pullTask({ db, taskId, features, allTasks, repoRoot, layers }) {
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
    // task→feature→files chain: show both the task's own files_hint AND the
    // anchored files of every feature the task targets. Agent gets
    // "what files could contain this issue?" in one call instead of two.
    const featureFiles = new Set();
    for (const fid of (task.features || [])) {
      const f = features.find(x => x.id === fid);
      if (!f) continue;
      for (const glob of (f.anchors.files || [])) {
        // Resolve glob against graph file list
        const rows = db.all(
          `SELECT file_path FROM nodes
           WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 30`,
          { g: glob });
        for (const r of rows) featureFiles.add(r.file_path);
      }
    }
    out.layers.code = {
      files_hint: task.files_hint || [],
      feature_files: capped([...featureFiles], 30),
    };
  }

  if (layers.has('activity')) {
    try {
      const raw = execFileSync('git',
        ['-C', repoRoot, 'log', `--grep=${task.id}`, '--pretty=format:%h|%ad|%s', '--date=short', '-n', '8'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const items = raw.trim().split('\n').filter(Boolean).map(l => {
        const [sha, date, subject] = l.split('|');
        return { sha, date, subject };
      });
      out.layers.activity = capped(items, 8);
    } catch { out.layers.activity = capped([], 8); }
  }

  if (layers.has('docs')) {
    // Docs MENTIONing any symbol in a feature the task targets.
    const featureIds = task.features || [];
    if (featureIds.length > 0) {
      const globs = [];
      for (const fid of featureIds) {
        const f = features.find(x => x.id === fid);
        if (f) globs.push(...(f.anchors.files || []));
      }
      if (globs.length > 0) {
        const docs = db.all(
          `SELECT DISTINCT d.label, d.file_path
           FROM edges e
           JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
           JOIN nodes s ON s.id = e.to_id
           WHERE e.relation = 'MENTIONS'
             AND (${globs.map((_, i) => `s.file_path GLOB $g${i}`).join(' OR ')})
           LIMIT 20`,
          Object.fromEntries(globs.map((g, i) => [`g${i}`, g]))
        );
        out.layers.docs = capped(docs.map(d => ({ label: d.label, file: d.file_path })), 10);
      } else {
        out.layers.docs = capped([], 10);
      }
    } else {
      out.layers.docs = capped([], 10);
    }
  }

  return out;
}

// ---------- main ----------

export async function graphPull({ repoRoot, node, layers, direction }) {
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
      const result = pullFeature({ db, featureId: node, features, allTasks, repoRoot, layers: layerSet, opts: { direction } });
      return JSON.stringify(result, null, 2);
    }
    // Task id?
    const taskMatch = allTasks.find(t => t.id === node);
    if (taskMatch) {
      const result = pullTask({ db, taskId: node, features, allTasks, repoRoot, layers: layerSet });
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
