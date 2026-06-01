import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { isGeneratedPath } from '../generated.js';
import { loadEmbeddings, embedderFromEnv, rankBySimilarity } from '../../intelligence/embeddings.js';

// P1-5 — generated codegen stubs sort LAST among otherwise-equal candidates.
// Subtracted AFTER the type/match scoring so a hand-written node always wins a
// shared label, but the generated node stays reachable (never hidden).
const GENERATED_PENALTY = 2000;

// Code-first ranking: agents want code symbols, not docs/dirs
const CODE_TYPES = new Set(['Function', 'Method', 'Class', 'Interface', 'Type', 'Test']);
const STRUCTURE_TYPES = new Set(['File', 'Module', 'Entrypoint', 'Route', 'Schema']);
// Document, Directory, Config are lowest priority
const EXACT_SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_.$:-]*$/;

function scoreNode(node, query) {
  let score = 0;

  // Type priority: code > structure > docs
  if (CODE_TYPES.has(node.type)) score += 1000;
  else if (STRUCTURE_TYPES.has(node.type)) score += 500;
  else score += 100;

  // Exact match beats prefix beats substring
  const label = node.label.toLowerCase();
  const q = query.toLowerCase();
  if (label === q) score += 500;
  else if (label.startsWith(q)) score += 300;
  else if (label.includes(q)) score += 100;

  // Fan-in as tiebreaker (from confidence as proxy)
  score += (node.confidence ?? 0) * 10;

  // P1-5 — down-rank generated codegen stubs. The penalty exceeds any
  // type/match bonus so a hand-written node with the same label outranks the
  // generated one, but the generated node still appears (down-rank, not hide).
  if (isGeneratedPath(node.file_path)) score -= GENERATED_PENALTY;

  return score;
}

// Append a `generated:true` hint to rendered lines for generated nodes so the
// agent knows the stub is codegen output. Render order is preserved.
function annotateGenerated(text, nodes) {
  const lines = text.split('\n');
  return lines
    .map((line, i) => {
      const n = nodes[i];
      if (n && isGeneratedPath(n.file_path) && line.startsWith('NODE ')) {
        return `${line} generated:true`;
      }
      return line;
    })
    .join('\n');
}

function buildSearchFilters({ type, file, kind }) {
  const clauses = [];
  const params = {};

  if (type) {
    clauses.push('type = $type');
    params.type = type;
  } else if (kind === 'code') {
    // Default: exclude docs/dirs/configs/external terminals unless explicitly requested.
    clauses.push("type NOT IN ('Document', 'Directory', 'Config', 'External')");
  }

  if (file) {
    clauses.push('file_path LIKE $file');
    params.file = `${file}%`;
  }

  return { clauses, params };
}

export async function graphSearch({ repoRoot, query, type, file, kind = 'code', limit = 20, fresh = false, mode = 'lexical', embedder = undefined }) {
  if (!query || query.trim().length === 0) {
    return 'QUERY_TOO_SHORT — provide at least 1 character';
  }

  const normalizedQuery = query.trim();
  let freshnessWarnings = [];
  let freshnessState = null;
  if (fresh) {
    await ensureFresh({ repoRoot });
  } else {
    const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_search' });
    if (freshness.blocker) return freshness.blocker;
    freshnessWarnings = freshness.warnings;
    freshnessState = freshness;
  }
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const cappedLimit = Math.min(limit, 100);
    const { clauses: baseClauses, params: baseParams } = buildSearchFilters({ type, file, kind });

    // ── Semantic mode (opt-in, pluggable embeddings) ──────────────────────────
    // Find code by MEANING via a precomputed embeddings sidecar + a query
    // embedding. Graceful degrade: no sidecar OR no embedder → lexical + a hint.
    if (mode === 'semantic') {
      const emb = loadEmbeddings(repoRoot);
      const useEmbedder = embedder ?? embedderFromEnv();
      if (emb?.vectors?.length && useEmbedder) {
        let qvec = null;
        try { [qvec] = await useEmbedder.embedTexts([normalizedQuery]); } catch { qvec = null; }
        if (Array.isArray(qvec)) {
          const ranked = rankBySimilarity(qvec, emb.vectors, cappedLimit).filter((r) => r.similarity > 0);
          if (ranked.length) {
            const ids = ranked.map((r) => r.id);
            const rows = db.all(
              `SELECT * FROM nodes WHERE id IN (${ids.map((_, i) => `$i${i}`).join(',')})`,
              Object.fromEntries(ids.map((id, i) => [`i${i}`, id])),
            );
            const byId = new Map(rows.map((r) => [r.id, r]));
            const ordered = ranked.map((r) => byId.get(r.id)).filter(Boolean);
            const rendered = annotateGenerated(renderCompact({ nodes: ordered, edges: [] }), ordered);
            return prefixReadWarnings(`SEMANTIC SEARCH for "${normalizedQuery}" (${ordered.length} hits by meaning)\n${rendered}`, freshnessWarnings);
          }
        }
      }
      // degrade → fall through to lexical with an accurate hint about WHY.
      const hint = (!emb?.vectors?.length || !useEmbedder)
        ? 'semantic search needs embeddings — run /graph-build-embeddings with APG_EMBED_* configured; showing lexical results'
        : 'no strong semantic matches; showing lexical results';
      freshnessWarnings = [hint, ...freshnessWarnings];
    }

    // Fast path: exact symbol-style queries should not pay the broad substring scan
    // when we already have a direct hit.
    if (EXACT_SYMBOL_RE.test(normalizedQuery)) {
      const exactClauses = ['label = $label', ...baseClauses];
      const exactHits = db.all(
        `SELECT * FROM nodes WHERE ${exactClauses.join(' AND ')} LIMIT $limit`,
        { ...baseParams, label: normalizedQuery, limit: cappedLimit }
      );
      if (exactHits.length > 0) {
        // P1-5 — even on the exact-label fast path, generated stubs sort LAST
        // so a hand-written symbol of the same name wins. Stable sort keeps the
        // original DB order among same-class hits.
        const orderedExact = exactHits
          .map((n, i) => ({ n, i, gen: isGeneratedPath(n.file_path) }))
          .sort((a, b) => (a.gen === b.gen ? a.i - b.i : (a.gen ? 1 : -1)))
          .map(x => x.n);
        const rendered = annotateGenerated(renderCompact({ nodes: orderedExact, edges: [] }), orderedExact);
        return prefixReadWarnings(rendered, freshnessWarnings);
      }
    }
    const clauses = ['label LIKE $q', ...baseClauses];
    const params = { ...baseParams, q: `%${normalizedQuery}%`, limit: cappedLimit };
    const where = clauses.join(' AND ');
    const hits = db.all(`SELECT * FROM nodes WHERE ${where} LIMIT 200`, params);

    if (hits.length === 0) {
      const base = `NO RESULTS for "${normalizedQuery}". Try graph_search(query="${normalizedQuery}", kind="all") to include docs/configs, or check graph_status() to verify the graph covers your files.`;
      const caveat = staleNotFoundCaveat(freshnessState);
      return caveat ? `${base}\n${caveat}` : base;
    }

    // Re-rank by agent-intent scoring
    const scored = hits
      .map(n => ({ ...n, _score: scoreNode(n, normalizedQuery) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);

    const rendered = annotateGenerated(renderCompact({ nodes: scored, edges: [] }), scored);
    return prefixReadWarnings(rendered, freshnessWarnings);
  } finally {
    db.close();
  }
}
