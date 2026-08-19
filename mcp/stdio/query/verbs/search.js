import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { inspectReadFreshness, prefixReadWarnings, staleNotFoundCaveat } from './read_freshness.js';
import { isGeneratedPath } from '../generated.js';
import { normalizePathArg } from '../../util/paths.js';
import { loadEmbeddings, embedderFromEnv, rankBySimilarity } from '../../intelligence/embeddings.js';

// P1-5 — generated codegen stubs sort LAST among otherwise-equal candidates.
// Subtracted AFTER the type/match scoring so a hand-written node always wins a
// shared label, but the generated node stays reachable (never hidden).
const GENERATED_PENALTY = 2000;

// Hard ceiling on candidates pulled from SQL before ranking. Past this, nodes are
// never scored, so raising `limit` cannot surface them — the result must say so
// rather than look complete (LH-1).
const SQL_CANDIDATE_CAP = 200;

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
  file = normalizePathArg(file); // accept Windows backslash file filters (src\foo)

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
        ? 'semantic search needs embeddings — run `node scripts/build-embeddings.mjs <repo>` with APG_EMBED_* configured; showing lexical results'
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
    // ⛔ THE RANKER ONLY EVER SAW AN ARBITRARY SAMPLE. This page had NO `ORDER BY`, so the 200
    // rows were whatever storage order handed over, and the +1000 a code type earns below could
    // only ever be awarded within that accident. `Module` and `File` nodes are not excluded by
    // the kind='code' filter and there are ~1050 of them here, so they crowd Functions out.
    //
    // ★ MEASURED on this repo before the fix, with the SAME filter the verb applies: query "e"
    // — 1577 code-typed matches, 138 inside the page, 1439 DISPLACED. Queries "a" and "s" are
    // 1002 and 984. Roughly 91% of the results the ranker exists to promote were gone before it
    // ran. (⚠ My first probe omitted the kind filter and measured a population this query never
    // sees; the figures happened to survive re-measurement, but the first instrument was wrong.)
    //
    // ⇒ ORDER THE PAGE BY THE SCORER'S DOMINANT TERM. A larger cap would only move the
    // boundary and keep the arbitrariness; making the SQL agree with the ranking is what
    // establishes the route. Displacement WITHIN the code tier is still possible and is still
    // disclosed by the candidate-cap note below — this narrows the defect, it does not remove
    // it, and saying otherwise would trade a known limit for an unknown one.
    const codeTypeList = [...CODE_TYPES].map((t) => `'${t}'`).join(',');
    const clauses = ['label LIKE $q', ...baseClauses];
    const params = { ...baseParams, q: `%${normalizedQuery}%`, limit: cappedLimit };
    const where = clauses.join(' AND ');
    const hits = db.all(
      `SELECT * FROM nodes WHERE ${where}
        ORDER BY CASE WHEN type IN (${codeTypeList}) THEN 0 ELSE 1 END
        LIMIT ${SQL_CANDIDATE_CAP}`,
      params,
    );

    if (hits.length === 0) {
      // ZERO-RESULT CAUSE HONESTY. This used to suggest "check graph_status() to
      // verify the graph covers your files" — a CAUSE we never checked, pointing
      // at expensive remediation that usually cannot help. Worse, the semantic
      // degradation hint computed above went into freshnessWarnings and this
      // branch returned `base` WITHOUT them, so the one accurate explanation was
      // dropped exactly when it mattered: an NL query in semantic mode with no
      // embeddings sidecar rarely matches lexically, which is the whole reason
      // someone selects semantic mode. Measured in the field: the banner fired on
      // the results path and vanished on the empty path.
      //
      // Say what we KNOW and what we RULED OUT; never name an unverified cause.
      // ⛔ TWO DEFECTS ef-manager EXECUTED, 2026-08-19, BY TAKING THIS MESSAGE'S OWN ADVICE.
      //
      // (a) `kind !== 'code'` counted `kind="all"` — the WIDEST setting, which excludes nothing
      //     — as an active narrowing filter. So following the "Next:" line above produced a new
      //     line blaming filters, and pointed away from the real cause. A cause that appears
      //     BECAUSE the reader widened the search is worse than silence.
      // (b) It was filed under "Ruled out", which is the list of things verified NOT to be the
      //     cause. An active filter is a CANDIDATE cause. Same class as every other basis in
      //     this repo that did not match its computation: the heading made a claim the item
      //     could not support.
      const ruledOut = [];
      const mayNarrow = [];
      if (freshnessState && !freshnessState.stale) ruledOut.push('the index is fresh');
      if (type || file || (kind && kind !== 'all')) {
        mayNarrow.push('filters are active (type/file/kind) and may be excluding matches');
      }
      const base = [
        `NO RESULTS for "${normalizedQuery}".`,
        ruledOut.length ? `Ruled out: ${ruledOut.join('; ')}.` : '',
        mayNarrow.length ? `May be narrowing: ${mayNarrow.join('; ')}.` : '',
        // graph_find is not in the default profile, so naming it spent a round trip to
        // discover it was unreachable. graph_pull is the listed cross-layer verb.
        `Next: graph_search(query="${normalizedQuery}", kind="all") to include docs/configs, or graph_pull for cross-layer context on a known node.`,
      ].filter(Boolean).join(' ');
      const caveat = staleNotFoundCaveat(freshnessState);
      // prefixReadWarnings carries the semantic-degradation hint (and any
      // snapshot warnings). Omitting it here is what lost the one accurate cause.
      return prefixReadWarnings(caveat ? `${base}\n${caveat}` : base, freshnessWarnings);
    }

    // Re-rank by agent-intent scoring.
    // LH-1 (2026-07-26): this truncated SILENTLY, twice — the SQL `LIMIT 200`
    // above caps what is even scored, and this slice caps what is shown (default
    // 20) — and renderCompact was called with no `truncated` argument, so no
    // marker was emitted at all. An agent saw 20 hits with no hint that more
    // existed, which is the same false-completeness failure as a bad
    // exhaustive:true. Both caps are now reported.
    const ranked = hits
      .map(n => ({ ...n, _score: scoreNode(n, normalizedQuery) }))
      .sort((a, b) => b._score - a._score);
    const scored = ranked.slice(0, limit);
    const dropped = ranked.length - scored.length;

    // The hint used to read `limit=${limit + 20}` regardless of how much was
    // dropped: with 200 candidates and limit=20 it suggested 40, so an agent
    // following the hint still could not see the set and had no way to know how
    // many rounds it would take. Name the number that actually shows everything
    // ranked (bounded by the 100 hard cap, which the suffix below explains).
    const enough = Math.min(ranked.length, 100);
    const rendered = annotateGenerated(
      renderCompact({
        nodes: scored,
        edges: [],
        truncated: dropped,
        suggestion: dropped > 0 ? `limit=${enough}` : undefined,
      }),
      scored,
    );
    // The SQL cap is a separate, harder ceiling: past it, candidates were never
    // scored at all, so raising `limit` alone cannot reveal them.
    const sqlCapNote = hits.length >= SQL_CANDIDATE_CAP
      ? `\n⚠ candidate cap: matched at least ${SQL_CANDIDATE_CAP} nodes and only the first ${SQL_CANDIDATE_CAP} were ranked`
        + ' — results are a FLOOR, not a complete match set. Narrow with type= / file= to bring the'
        + ' set under the cap.'
      : '';
    const shownNote = dropped > 0 || sqlCapNote
      ? `\nSHOWING ${scored.length} of ${hits.length}${hits.length >= SQL_CANDIDATE_CAP ? '+' : ''} matches.`
      : '';
    return prefixReadWarnings(rendered + shownNote + sqlCapNote, freshnessWarnings);
  } finally {
    db.close();
  }
}
