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
import { attachReadWarnings, inspectReadFreshness, staleNotFoundCaveat } from './read_freshness.js';
import { isGeneratedPath } from '../generated.js';
import { normalizePathArg } from '../../util/paths.js';

// P1-5 — generated codegen stubs sort LAST among otherwise-equal hits. Penalty
// exceeds the per-layer/match bonuses so a hand-written symbol with the same
// label outranks the generated one; the generated hit still appears.
const GENERATED_PENALTY = 2000;

const ALL_LAYERS = ['code', 'features', 'tasks', 'docs'];
const CODE_TYPES = new Set(['Function', 'Method', 'Class', 'Interface', 'Type', 'Test']);

// A LAYER THAT COULD NOT BE READ IS NOT AN EMPTY LAYER.
//
// This returned a bare [] down THREE different routes, and the caller then reported the layer in
// `layers_searched` regardless — telling the consumer the tasks layer was searched and held nothing
// when nothing had been read at all. That is a coverage claim an instrument failure falsifies, in a
// structured field an agent acts on.
//
//   file absent               -> honestly zero
//   corrupt bytes             -> UNKNOWN, via the catch
//   valid JSON, no tasks key  -> UNKNOWN, via the `|| []` fallback, WITHOUT touching the catch
//
// The third route is the one a control aimed at the catch would have missed entirely.
//
// The shape is not invented here: loadFunctionality already returns a typed result with an `error`
// field. This makes loadTasks consistent with its sibling.
function loadTasks(repoRoot) {
  const p = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(p)) return { tasks: [], readable: true, state: 'absent' };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return { tasks: [], readable: false, state: 'unparseable', error: String(e.message).slice(0, 120) };
  }
  if (!Array.isArray(parsed?.tasks)) {
    return { tasks: [], readable: false, state: 'malformed', error: 'parsed, but carries no `tasks` array' };
  }
  return { tasks: parsed.tasks, readable: true, state: 'read' };
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
    const generated = isGeneratedPath(row.file_path);
    let score = scoreTextMatch(row.label, query) + (CODE_TYPES.has(row.type) ? 100 : 20);
    if (generated) score -= GENERATED_PENALTY;
    hits.push({
      layer: 'code',
      kind: (row.type || 'unknown').toLowerCase(),
      label: row.label,
      file: row.file_path,
      line: row.start_line,
      score,
      ...(generated ? { generated: true } : {}),
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

// ⛔ THE TITLE FIX REACHED ONE OF TWO VERBS. `graph_search` learned to query a document's own
// title in c35836a, with the measurement in its comment. `graph_find` is a SEPARATELY REGISTERED
// tool with its own doc search, and it still matched label and path only — so the same repo
// answered the same question two different ways depending on which verb you reached for:
//
//     query                  graph_search(kind:"all")   graph_find(layers:["docs"])
//     "install guide"        finds a document           finds one (by FILENAME, coincidentally)
//     "triage"               finds a document           NOTHING
//     "findings register"    finds a document           NOTHING
//
// Re-measured here, not taken from the other comment: 75 of 155 documents (48%) carry a title word
// that appears nowhere in their path. `AGENTS.md` is titled "Agent install guide";
// `2026-08-10-scan-plan.md` is "Scan plan — collect findings widely, then triage them together".
//
// ⭐ AND THAT IS THE QUERY THE INDEX EXISTS TO WIN. The competitor on discovery is `ls docs/`, not
// grep — it finds anything whose NAME carries the topic, costs nothing and needs no index. The only
// query where an index earns its keep is TOPIC → DOCUMENT WHOSE FILENAME LACKS THE TOPIC, which is
// exactly the query this function returned nothing for.
//
// ⚠ TITLE ONLY, NOT SUMMARY — the same restraint `search.js` reasoned its way to, adopted rather
// than re-decided. A title is the author naming the document; a summary is the second non-empty
// line, whatever sentence happened to be there. Widening to it would buy unmeasured recall at an
// unmeasured precision cost.
const DOC_TITLE = "json_extract(extra, '$.title')";

function searchDocs(db, query, limit) {
  const hits = db.all(
    `SELECT label, file_path, ${DOC_TITLE} AS title FROM nodes
     WHERE type IN ('Document', 'Schema')
       AND (label LIKE $pattern OR file_path LIKE $pattern OR ${DOC_TITLE} LIKE $pattern)
     LIMIT 50`, { pattern: `%${query}%` });
  return hits.map(h => ({
    layer: 'docs',
    kind: 'document',
    label: h.label,
    file: h.file_path,
    // ⚠ The title is RETURNED, not just matched on. A hit whose filename does not contain the
    // query looks like a false positive to the caller unless they can see what matched — and this
    // clause exists precisely to return documents whose names do not carry the topic.
    ...(h.title ? { title: h.title } : {}),
    // Weighted below label, above path: the author naming the document is stronger evidence than
    // a path fragment and weaker than the filename itself, which is usually the name they chose.
    score: scoreTextMatch(h.label, query)
      + scoreTextMatch(h.title || '', query) * 0.75
      + scoreTextMatch(h.file_path, query) * 0.5,
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
  // Accept a Windows backslash path fragment (src\foo.cpp) — file_path is stored
  // with forward slashes. Safe for symbol queries too (they never contain '\').
  query = normalizePathArg(query);
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
  let freshnessState = null;

  // By default, skip ensureFresh — "fast search" is the contract here.
  // Staleness on identifier-text search is acceptable; callers who need
  // strong freshness can pass fresh=true or run graph_index first.
  if (fresh) {
    await ensureFresh({ repoRoot });
  } else {
    const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_find' });
    if (freshness.blocker) return freshness.blocker;
    freshnessWarnings = freshness.warnings;
    freshnessState = freshness;
  }
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const layerSet = new Set(
    Array.isArray(layers) && layers.length > 0
      ? layers.filter(l => ALL_LAYERS.includes(l))
      : ALL_LAYERS
  );

  try {
    const overlay = loadFunctionality(repoRoot);
    const taskLayer = loadTasks(repoRoot);
    const tasks = taskLayer.tasks;

    // ⛔ A LAYER WHOSE SOURCE COULD NOT BE READ MUST NOT BE CLAIMED AS SEARCHED.
    //
    // `layers_searched` is a coverage claim. Leaving an unreadable layer in it reports that the
    // layer was searched and found empty — the false-exhaustive shape, asserted in a field a
    // consumer can act on.
    //
    // ⚠ The two layers are checked INDEPENDENTLY and on purpose. The cheap version is one guard
    // covering both loads, which would unclaim BOTH when one file is bad — a fix that degrades the
    // verb more than the defect did.
    //
    // ⚠ For features the honesty already existed and was DISCARDED: loadFunctionality has always
    // returned an `error` field on a parse failure, and this call site read only `.features`. An
    // honest producer whose consumer ignores it buys nothing.
    const layersUnavailable = [];
    const unclaim = (layer, reason) => {
      if (!layerSet.has(layer)) return;
      layerSet.delete(layer);
      layersUnavailable.push({ layer, reason });
    };
    if (!taskLayer.readable) unclaim('tasks', `tasks.json ${taskLayer.state}: ${taskLayer.error}`);
    if (overlay.error) unclaim('features', `functionality.json unreadable: ${overlay.error}`);
    const broadQuery = tokens.length === 1 && raw.length <= 5;
    const perLayerDisplayLimit = broadQuery ? Math.min(perLayer, 2) : perLayer;
    const topDisplayLimit = broadQuery ? Math.min(limit, 6) : limit;

    const results = {
      query: q,
      layers_searched: [...layerSet],
      // Present only when something was NOT searched, so a clean run carries no noise and an
      // unreadable layer cannot vanish silently.
      ...(layersUnavailable.length ? { layers_unavailable: layersUnavailable } : {}),
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

    // Audit-shape nudge. The 2026-04-27 AUDIT bench showed agents calling
    // graph_find once on enumeration-shape queries ("find every X", "all
    // usages of Y") and stopping when the result was thin — missing 80% of
    // hits that grep would have caught. Detect that shape and steer to grep.
    const totalHits = codeHits.length + featureHits.length + taskHits.length + docHits.length;
    const isAuditShape = /\b(every|all|each|any|usage|usages|references|callers|references-to|find-all)\b/i.test(query)
      || query.split(/\s+/).filter(Boolean).length >= 3;
    if (isAuditShape && totalHits < 5) {
      results.advice = `Audit-shaped query with ${totalHits} hits — likely undercount. graph_find returns at most one node per matching label; for "find every X" patterns prefer N targeted Grep passes (rg -n "X\\b" by file glob). The graph result is a starting point, not the answer.`;
    }

    // FIX A: a zero-hit result on a STALE index must not read as "doesn't
    // exist." Attach the loud staleness caveat so the agent knows a just-landed
    // symbol may simply not be indexed yet. Silent on a fresh index (no noise).
    if (totalHits === 0) {
      const caveat = staleNotFoundCaveat(freshnessState);
      if (caveat) results.stale_caveat = caveat;
    }

    return JSON.stringify(attachReadWarnings(results, freshnessWarnings), null, 2);
  } finally {
    db.close();
  }
}
