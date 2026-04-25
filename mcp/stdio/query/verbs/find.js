// graph_find — fast cross-layer text search.
//
// Searches code nodes (labels + qnames) AND overlay layers (feature labels/
// descriptions/tags, task titles, doc node labels) in one call. Returns a
// flat ranked list with type markers so agents see everything matching a
// query across all layers without juggling multiple verbs.
//
// Fast path uses existing nodes indexes + in-memory scan of the small
// overlay files (functionality.json, tasks.json). No FTS5 dependency.
// If graph size ever pushes past ~500k nodes the code branch can be
// upgraded to FTS5 separately without breaking the interface here.

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { loadFunctionality } from '../../overlay/loader.js';
import { attachReadWarnings, inspectReadFreshness } from './read_freshness.js';

const ALL_LAYERS = ['code', 'features', 'tasks', 'docs'];
const CODE_TYPES = new Set(['Function', 'Method', 'Class', 'Interface', 'Type', 'Test']);

function loadTasks(repoRoot) {
  const p = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')).tasks || [];
  } catch { return []; }
}

function scoreTextMatch(haystack, needle) {
  if (!haystack) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 500;
  if (h.startsWith(n)) return 300;
  if (h.includes(n)) return 100;
  // Token-boundary match: needle is one of the tokens split by non-alnum
  const tokens = h.split(/[^a-z0-9]+/);
  if (tokens.includes(n)) return 200;
  return 0;
}

function searchCode(db, query, limit) {
  // Exact label match fast path (uses idx_nodes_label)
  const exact = db.all(
    `SELECT label, type, file_path, start_line FROM nodes
     WHERE label = $q LIMIT 50`, { q: query });
  // Substring match (LIKE scan, 10-50ms on medium graphs)
  const like = db.all(
    `SELECT label, type, file_path, start_line FROM nodes
     WHERE label LIKE $pattern AND type NOT IN ('External','Directory','Config')
     LIMIT 200`, { pattern: `%${query}%` });
  const seen = new Set();
  const hits = [];
  for (const row of [...exact, ...like]) {
    const key = `${row.label}|${row.file_path}|${row.start_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = scoreTextMatch(row.label, query) + (CODE_TYPES.has(row.type) ? 100 : 20);
    hits.push({
      layer: 'code',
      kind: (row.type || 'unknown').toLowerCase(),
      label: row.label,
      file: row.file_path,
      line: row.start_line,
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchFeatures(features, query, limit) {
  const hits = [];
  for (const f of features) {
    const scoreId = scoreTextMatch(f.id, query);
    const scoreLabel = scoreTextMatch(f.label, query);
    const scoreDesc = scoreTextMatch(f.description, query) * 0.4; // descriptions weight less
    const scoreTags = (f.tags || []).reduce((s, t) => s + scoreTextMatch(t, query) * 0.6, 0);
    const total = scoreId + scoreLabel + scoreDesc + scoreTags;
    if (total > 0) {
      hits.push({
        layer: 'features',
        kind: 'feature',
        id: f.id,
        label: f.label || f.id,
        description: f.description,
        score: total,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchTasks(tasks, query, limit) {
  const hits = [];
  for (const t of tasks) {
    const scoreId = scoreTextMatch(t.id, query);
    const scoreTitle = scoreTextMatch(t.title, query);
    const scoreDesc = scoreTextMatch(t.description || '', query) * 0.4;
    const scoreEvidence = scoreTextMatch(t.evidence || '', query) * 0.3;
    const total = scoreId + scoreTitle + scoreDesc + scoreEvidence;
    if (total > 0) {
      hits.push({
        layer: 'tasks',
        kind: 'task',
        id: t.id,
        title: t.title,
        status: t.status,
        features: t.features || [],
        score: total,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchDocs(db, query, limit) {
  const hits = db.all(
    `SELECT label, file_path FROM nodes
     WHERE type IN ('Document', 'Schema')
       AND (label LIKE $pattern OR file_path LIKE $pattern)
     LIMIT 50`, { pattern: `%${query}%` });
  return hits.map(h => ({
    layer: 'docs',
    kind: 'document',
    label: h.label,
    file: h.file_path,
    score: scoreTextMatch(h.label, query) + scoreTextMatch(h.file_path, query) * 0.5,
  })).sort((a, b) => b.score - a.score).slice(0, limit);
}

function capCollection(items, limit) {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: items.length > limit,
    limit,
  };
}

export async function graphFind({ repoRoot, query, layers, limit = 10, fresh = false }) {
  if (!query || query.trim().length < 1) {
    return 'ERROR: query parameter is required (minimum 1 character)';
  }
  // Server-side tokenization: compound queries like "pressure vacuum gas"
  // silently returned empty before — each word was passed as one literal
  // substring match, so the search only fired if any label/text contained
  // the exact multi-word string verbatim. Real-world callers type natural
  // phrases and hit empty. Fix: split on whitespace, try the full string
  // first (for exact-phrase hits), then each token, and union results with
  // per-token scores summed. Echoes bench 2026-04-21 flagged this twice.
  const raw = query.trim();
  const tokens = raw.split(/\s+/u).filter(Boolean);
  const queries = tokens.length > 1 ? [raw, ...tokens] : [raw];
  const perLayer = Math.max(1, Math.min(limit, 20));
  const q = raw; // canonical reported query
  let freshnessWarnings = [];

  // By default, skip ensureFresh — "fast search" is the contract here.
  // Staleness on identifier-text search is acceptable; callers who need
  // strong freshness can pass fresh=true or run graph_index first.
  if (fresh) {
    await ensureFresh({ repoRoot });
  } else {
    const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_find' });
    if (freshness.blocker) return freshness.blocker;
    freshnessWarnings = freshness.warnings;
  }
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const layerSet = new Set(
    Array.isArray(layers) && layers.length > 0
      ? layers.filter(l => ALL_LAYERS.includes(l))
      : ALL_LAYERS
  );

  try {
    const overlay = loadFunctionality(repoRoot);
    const tasks = loadTasks(repoRoot);
    const broadQuery = tokens.length === 1 && raw.length <= 5;
    const perLayerDisplayLimit = broadQuery ? Math.min(perLayer, 2) : perLayer;
    const topDisplayLimit = broadQuery ? Math.min(limit, 6) : limit;

    const results = {
      query: q,
      layers_searched: [...layerSet],
      broad_query_capped: broadQuery,
      hits: { code: [], features: [], tasks: [], docs: [] },
    };

    // Multi-token search: run each per-layer searcher for every query
    // variant, dedupe by (layer, id/file/line) key, keep the best score.
    const mergeHits = (hits) => {
      const byKey = new Map();
      for (const h of hits) {
        const key = `${h.layer}|${h.kind ?? ''}|${h.label ?? ''}|${h.file ?? ''}|${h.line ?? ''}|${h.id ?? ''}`;
        const prev = byKey.get(key);
        if (!prev || h.score > prev.score) byKey.set(key, h);
      }
      return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, perLayer);
    };
    const runLayer = (layer, fn) => {
      if (!layerSet.has(layer)) return [];
      const all = queries.flatMap((term) => fn(term));
      return mergeHits(all);
    };

    const codeHits = runLayer('code', (term) => searchCode(db, term, perLayer));
    const featureHits = runLayer('features', (term) => searchFeatures(overlay.features, term, perLayer));
    const taskHits = runLayer('tasks', (term) => searchTasks(tasks, term, perLayer));
    const docHits = runLayer('docs', (term) => searchDocs(db, term, perLayer));

    // Flat top-k if user wants a simple merge
    const flat = [
      ...codeHits,
      ...featureHits,
      ...taskHits,
      ...docHits,
    ].sort((a, b) => b.score - a.score);

    results.hits.code = capCollection(codeHits, perLayerDisplayLimit);
    results.hits.features = capCollection(featureHits, perLayerDisplayLimit);
    results.hits.tasks = capCollection(taskHits, perLayerDisplayLimit);
    results.hits.docs = capCollection(docHits, perLayerDisplayLimit);
    results.top = capCollection(flat, topDisplayLimit);
    results.totals = {
      code: codeHits.length,
      features: featureHits.length,
      tasks: taskHits.length,
      docs: docHits.length,
    };
    if (broadQuery) {
      results.truncated = {
        code: Math.max(0, codeHits.length - perLayerDisplayLimit),
        features: Math.max(0, featureHits.length - perLayerDisplayLimit),
        tasks: Math.max(0, taskHits.length - perLayerDisplayLimit),
        docs: Math.max(0, docHits.length - perLayerDisplayLimit),
        top: Math.max(0, flat.length - topDisplayLimit),
      };
    }

    return JSON.stringify(attachReadWarnings(results, freshnessWarnings), null, 2);
  } finally {
    db.close();
  }
}
