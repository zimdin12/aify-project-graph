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
// The types the default kind='code' filter EXCLUDES, and therefore the ones an explicit
// kind='all' was asked for. External is deliberately absent: it is an unresolved reference
// stub, not a document someone is trying to find again.
const WIDENED_TYPES = new Set(['Document', 'Config', 'Directory']);
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

  // ⛔ THE SCORER ONLY EVER COMPARED AGAINST THE WHOLE QUERY STRING, SO AMONG DOCUMENTS THE ORDER
  // WAS ARBITRARY. Measured on the pinned corpus: for the query "parameter types", click's
  // `parameter-types.md` and its `api.md` both scored exactly 100 — same type bonus, and neither
  // label contains the full phrase "parameter types" — so the document that answers the question
  // lost to one that does not, by tie-break. Same for "shell completion" against
  // `shell-completion.md`. The right document was IN the candidate set both times and ranked below.
  //
  // Tokens are what a prose query is actually made of. This counts how many of them the node's own
  // name, title and headings carry, which is a measure of how well it matched rather than whether it
  // matched at all.
  //
  // ⚠ DELIBERATELY SMALLER THAN THE TYPE BONUS. Code still outranks documents overall — that
  // ordering is the existing design and this does not touch it. This orders candidates WITHIN a
  // type, which is exactly where the tie was.
  // ⚠ AND WHERE THE TOKEN SITS DECIDES WHAT IT IS WORTH — measured, because a flat token count did
  // NOT fix the case above. For "parameter types", `api.md` carries both tokens across its twelve
  // headings and `parameter-types.md` carries both in its NAME; counting tokens alone scored them
  // equally and the wrong one still won. A name or title is a claim about the WHOLE document; a
  // heading is a claim about one section of it. That is this repo's own adjacent-not-ambient rule,
  // the property that separated the doc→symbol rules which survived held-out grading from the one
  // deleted at 0.9311.
  const queryTokens = q.split(/\s+/u).filter((t) => t.length > 2);
  if (queryTokens.length > 1) {
    let named = label;
    let sectioned = '';
    try {
      const extra = node.extra ? JSON.parse(node.extra) : null;
      if (extra) {
        named += ` ${String(extra.title ?? '').toLowerCase()}`;
        sectioned = (extra.headings ?? []).join(' ').toLowerCase();
      }
    } catch { /* a node without parseable extra scores on its label alone */ }
    for (const t of queryTokens) {
      if (named.includes(t)) score += 200;
      else if (sectioned.includes(t)) score += 40;
    }
  }

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

// ⚠ `kind` is destructured WITHOUT a default so the body can tell a caller-supplied 'code'
// from the default one. With `kind = 'code'` in the signature that distinction is erased at the
// boundary, and the zero-result message cannot attribute the narrowing to whoever caused it.
export async function graphSearch({ repoRoot, query, type, file, kind: kindArg, limit = 20, fresh = false, mode = 'lexical', embedder = undefined }) {
  const kindSupplied = kindArg !== undefined && kindArg !== null && kindArg !== '';
  const kind = kindSupplied ? kindArg : 'code';
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
    //
    // ⛔ AND IT IS SKIPPED WHEN THE CALLER WIDENED, BECAUSE IT WAS SILENTLY DELETING THE WIDENING.
    //
    // A document is reached by its TITLE or its HEADINGS, never by an exact `label` match — a
    // label is a filename. So whenever the query happened to be a valid symbol name AND some node
    // carried it exactly, this returned early and no document could be returned at all, however
    // well it matched. Measured on this repo:
    //
    //     query        exact-label nodes   fast path   documents matching by heading
    //     overlay              4            FIRES                24   ← all unreachable
    //     clangd               1            FIRES                13   ← all unreachable
    //     sqlite               0            skipped               2   ← returned fine
    //     staleness            0            skipped               5   ← returned fine
    //
    // Perfect discrimination: the two queries that returned zero documents are exactly the two
    // where this branch fired. ⇒ Not a ranking problem and not a cap — the widened query was never
    // executed. The reserved-page-share machinery below is downstream of a return statement.
    //
    // ⚠ THIS PREDATES the heading index; it blocked TITLE matches the same way, which is why
    // `kind:"all"` looked like it worked only on queries that were not symbol names.
    // ⚠ The default `kind:'code'` keeps the fast path: documents are excluded by the filter there
    // anyway, so short-circuiting costs that caller nothing. Paying the scan is correct only for
    // the caller who explicitly asked for more than code.
    if (EXACT_SYMBOL_RE.test(normalizedQuery) && kind !== 'all') {
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
    // ⛔ A MULTI-WORD QUERY COULD NEVER MATCH. The predicate was one LIKE over `label`, so
    // "design doc" looked for a node literally named that — and no file is. Steven's case: an
    // agent that had worked a project for two months asked where the game design doc was,
    // because compaction erased that it existed. That is a DISCOVERY question, and grep cannot
    // help you find something you do not know to search for.
    //
    // ⇒ Tokens are ANDed, and each may match the label OR the path, because "design doc" is
    // satisfied by `docs/game-design.md` through both halves at once. A single-word query takes
    // exactly the old path, so nothing that worked before changes.
    const codeTypeList = [...CODE_TYPES].map((t) => `'${t}'`).join(',');
    const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
    const params = { ...baseParams, limit: cappedLimit };
    // ⛔ THE DOCUMENT'S OWN TITLE WAS EXTRACTED, STORED, AND NEVER QUERIED.
    //
    // `sweep.js` pulls a `title` off every text document — its first heading — and writes it into
    // `extra`. All 154 Document nodes on this repo carry one. Nothing searched it.
    //
    // MEASURED: 76 of 154 titles (49%) contain a word that appears NOWHERE in the filename or
    // path. `AGENTS.md` is titled "Agent install guide"; `2026-08-12-refactor-proposal.md` is
    // "two files, verified seams". Before this clause:
    //
    //     graph_search("install guide", kind:"all")        0 hits
    //     graph_search("verified seams", kind:"all")       0 hits
    //     graph_search("collect findings widely")          0 hits
    //     graph_search("attribution")                      3 hits  <- the control: name matching works
    //
    // ⭐ AND THAT IS PRECISELY THE CASE THE INDEX HAS TO WIN. The roadmap is explicit that the
    // competitor on discovery is not grep, it is `ls docs/` — which finds anything whose NAME
    // carries the topic, costs nothing, and needs no index. "Can it find game-design.md" is a test
    // `ls` also passes. The only query where an index earns its keep is TOPIC -> DOCUMENT WHERE
    // THE FILENAME DOES NOT CONTAIN THE TOPIC, and that is exactly the query that returned zero.
    //
    // ⚠ TITLE ONLY, NOT SUMMARY, AND THE RESTRAINT IS DELIBERATE. Every node also carries a
    // `summary` — the second non-empty line, which is arbitrary prose. A title is the author
    // naming the document; a summary is whatever sentence happened to be there. Adding it would
    // widen recall by an unmeasured amount at an unmeasured precision cost, and this repo has
    // spent the night deleting rules that were admitted without a measurement.
    const TITLE = "json_extract(extra, '$.title')";
    // ⛔ HEADINGS TOO, AND THE MEASUREMENT IS WHY. Over ten topics this repo genuinely discusses,
    // name|title reached THREE documents; headings add FORTY-NINE. `graph_search("sqlite")`
    // answered NO RESULTS on the repository whose storage layer is SQLite.
    //
    // ⚠ STILL NOT THE BODY, and the restraint is the same one the paragraph above states. Ninety-
    // six documents contain the word "overlay"; returning all of them would be catastrophic
    // precision, and word-containment-as-aboutness is the legacy `mentions` error. Headings admit
    // 14% of that population because a heading is a claim the author made about a section, not a
    // coincidence of vocabulary. ADJACENT, NOT AMBIENT — the property that separated the doc→symbol
    // rules that survived held-out grading from the one deleted at 0.9311.
    //
    // ⚠ `$.headings` is a JSON ARRAY, so LIKE runs over its serialised form. That is coarse — it
    // can match across the quote-comma boundary between two adjacent headings — and it is chosen
    // over a json_each join deliberately, because this clause is also built for the multi-token
    // path where the join would need a correlated subquery per token. The failure mode is a rare
    // extra match rather than a missed one, and precision is UNMEASURED on any corpus this rule
    // did not shape.
    const HEADINGS = "json_extract(extra, '$.headings')";
    const docText = (bind) => `(label LIKE ${bind} OR ${TITLE} LIKE ${bind} OR ${HEADINGS} LIKE ${bind})`;
    let matchClause;
    if (tokens.length > 1) {
      matchClause = tokens
        .map((t, i) => {
          params[`t${i}`] = `%${t}%`;
          return `(file_path LIKE $t${i} OR ${docText(`$t${i}`)})`;
        })
        .join(' AND ');
    } else {
      matchClause = docText('$q');
      params.q = `%${normalizedQuery}%`;
    }
    // ⭐ A PROSE QUESTION IS A DISCOVERY QUESTION, AND CODE WAS SHADOWING THE ANSWER.
    //
    // Widening only when code finds NOTHING fixes the smaller half. Measured against the pinned
    // corpus with questions registered before indexing: of ten discovery questions, one returned
    // nothing at all and FIVE returned code only — "context", "arguments", "parameter types" each
    // matched some symbol, so the design document that answers them was never reached. A doc that
    // exists and is never shown is unreachable for the same reason a missing one is.
    //
    // A multi-token query is not a symbol lookup. `EXACT_SYMBOL_RE` cannot match anything containing
    // a space, so tokens.length > 1 already means the caller asked in prose — and prose is how an
    // agent asks when it remembers the topic and has lost the filename, which is the whole scenario.
    //
    // ⛔ STILL ONLY WHEN THE NARROWING WAS OURS, and still not a promotion of filler: documents ride
    // the same match clause as everything else, and `reserveForWidened` promotes nothing when nothing
    // matched. Code keeps its +1000 ranking bonus; the reservation only stops docs being buried
    // below every function, which is inclusion the reader cannot reach.
    const proseQuery = tokens.length > 1 && !kindSupplied && !type;
    const effectiveKind = proseQuery ? 'all' : kind;
    const { clauses: effBaseClauses, params: effBaseParams } = proseQuery
      ? buildSearchFilters({ type, file, kind: 'all' })
      : { clauses: baseClauses, params: baseParams };
    Object.assign(params, effBaseParams);
    const clauses = [matchClause, ...effBaseClauses];
    const where = clauses.join(' AND ');
    let hits = db.all(
      `SELECT * FROM nodes WHERE ${where}
        ORDER BY CASE WHEN type IN (${codeTypeList}) THEN 0 ELSE 1 END
        LIMIT ${SQL_CANDIDATE_CAP}`,
      params,
    );

    // ⭐ THE DEFAULT EXCLUSION IS OURS, SO A ZERO CAUSED BY IT IS OURS TO UNDO.
    //
    // THE-GOAL names documents as the base layer and the product's problem as DISCOVERY — "my agent
    // asked me where the game design doc is; he has worked on the project for 2 months". Measured on
    // this repository: 230 documents indexed, and "the goal", "why is the rebuild one transaction"
    // and "PHP language server decision" ALL returned NO RESULTS, because kind defaults to "code"
    // and that excludes Document nodes. The founding question failed on the default path.
    //
    // The message already named the narrowing and gave the exact remedy call, which is honest — but
    // THE-GOAL also says "a disclosure nobody acts on is slop", and the remedy costs a round trip to
    // an agent whose whole problem is that it no longer remembers the document exists. Measured:
    // that message has been delivered ZERO times across 1,078 transcripts on this machine.
    //
    // ⛔ ONLY WHEN THE NARROWING WAS OURS. A caller who passed kind="code" asked for code and gets
    // code; widening under them would answer a question they did not ask. `kindSupplied` exists
    // precisely to tell those two apart.
    const narrowedByDefault = !type && !kindSupplied;
    let autoWidened = false;
    let widenAttempted = false;
    if (hits.length === 0 && narrowedByDefault) {
      widenAttempted = true;
      const { clauses: wideBase, params: wideParams } = buildSearchFilters({ type, file, kind: 'all' });
      const wideWhere = [matchClause, ...wideBase].join(' AND ');
      const wideHits = db.all(
        `SELECT * FROM nodes WHERE ${wideWhere}
          ORDER BY CASE WHEN type IN (${codeTypeList}) THEN 0 ELSE 1 END
          LIMIT ${SQL_CANDIDATE_CAP}`,
        { ...params, ...wideParams },
      );
      if (wideHits.length > 0) {
        hits = wideHits;
        autoWidened = true;
      }
    }

    // ⛔ `kind:"all"` IS THE CALLER EXPLICITLY ASKING FOR DOCS, AND THEY WERE UNREACHABLE.
    // Measured on this repo: `graph_search("plan", kind:"all")` ranked the eleven docs/*plan*.md
    // files 22nd through 32nd, behind every function, because code types earn +1000 in the
    // scorer. At any ordinary limit the caller sees none of them. Including a thing and then
    // ranking it below everything is inclusion the reader cannot reach — the same shape as a
    // cap reported as a population.
    //
    // ⇒ When the caller widened DELIBERATELY, reserve part of the page for what they widened
    // FOR. Not a re-rank: code still leads, and the non-code entries keep their own order. The
    // guarantee is only that the widening is not cosmetic.
    // ⚠ Deliberately does NOT fire on the default kind='code' — see the control test. A fix
    // that inverted ordinary code search would trade one wrong ranking for another.
    // ⚠ IT TAKES THE FULL RANKED LIST, NOT AN ALREADY-SLICED ONE. My first version reserved from
    // `ranked.slice(0, limit)` — which is the very page the doc had already been pushed off, so
    // it reserved space for nothing and the test still failed. A promotion that can only pick
    // from the winners promotes nobody.
    const reserveForWidened = (rankedList) => {
      // `effectiveKind`, not `kind`: a prose query searches the widened population, so its documents
      // need the same reservation or they sit below every function and are never seen.
      if (effectiveKind !== 'all') return rankedList.slice(0, limit);
      // ⚠ PROMOTE WHAT THE WIDENING ADMITS, not merely "not code". My first version reserved for
      // any non-CODE_TYPES node, and on a real query the slot went to a TEST FILE — which the
      // default kind='code' already returns, so the reservation bought the caller nothing. The
      // types `kind='code'` excludes are Document, Directory, Config and External; External is a
      // reference stub rather than something anyone is looking for, so it is not promoted either.
      const widened = rankedList.filter((n) => WIDENED_TYPES.has(n.type));
      if (widened.length === 0) return rankedList.slice(0, limit);
      const share = Math.max(1, Math.floor(limit / 3));
      const promoted = new Set(widened.slice(0, share));
      const rest = rankedList.filter((n) => !promoted.has(n));
      return [...rest.slice(0, Math.max(0, limit - promoted.size)), ...promoted];
    };

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
      // ⛔ TWO DEFECTS the field test EXECUTED, 2026-08-19, BY TAKING THIS MESSAGE'S OWN ADVICE.
      //
      // (a) `kind !== 'code'` counted `kind="all"` — the WIDEST setting, which excludes nothing
      //     — as an active narrowing filter. So following the "Next:" line above produced a new
      //     line blaming filters, and pointed away from the real cause. A cause that appears
      //     BECAUSE the reader widened the search is worse than silence.
      // (b) It was filed under "Ruled out", which is the list of things verified NOT to be the
      //     cause. An active filter is a CANDIDATE cause. Same class as every other basis in
      //     this repo that did not match its computation: the heading made a claim the item
      //     could not support.
      // ⛔ AND MY FIX FOR THAT FLIPPED THE POLARITY RATHER THAN CORRECTING IT. `kind` carried a
      // PARAMETER DEFAULT of 'code', so `kind && kind !== 'all'` was true on a bare call with no
      // arguments — the commonest call there is — and the message blamed filters the caller
      // never passed. Worse under the new heading: "May be narrowing" asserts a candidate cause,
      // so the false claim was promoted from a clause to a hypothesis. the field test executed all
      // three arms the same day.
      //
      // ⇒ CALLER-SUPPLIED vs VERB-DEFAULT, not a value test. Both narrow in SQL — the default
      // really does exclude Document/Directory/Config/External — so neither may be silent, but
      // they are DIFFERENT facts and only one of them is something the reader chose.
      const ruledOut = [];
      const mayNarrow = [];
      // ⛔ `=== false`, NOT `!stale`. This line RULES OUT staleness as the reason a symbol was not
      // found — an affirmative claim about the index, printed to a reader deciding whether "not
      // found" means "not there". `stale` is tri-state and `null` means the git query that would
      // have established freshness never ran; `!null` is `true`, so the old test exonerated the
      // index on the strength of a check that did not happen. An unknown may not be laundered into
      // a ruled-out. Same class as the absence claims in graph_find and graph_whereis.
      if (freshnessState && freshnessState.stale === false) ruledOut.push('the index is fresh');
      if (type || file || (kindSupplied && kind !== 'all')) {
        mayNarrow.push('filters are active (type/file/kind) and may be excluding matches');
      }
      // Attributed to the verb, with the widening move named. Suppressed when the caller already
      // widened, because re-suggesting the setting they just passed is a remedy that cannot
      // change the answer — the same non-terminating shape as the did-you-mean loop.
      // ⛔ A REMEDY ALREADY TRIED IS NOT A REMEDY. When the default narrowing was undone
      // automatically above and the widened search ALSO found nothing, the exclusion is not the
      // cause of this zero — and telling the reader to set kind="all" sends them to a call whose
      // answer we have already computed. This file names that shape a few lines down: "re-suggesting
      // the setting they just passed is a remedy that cannot change the answer".
      const defaultNarrowed = !type && !kindSupplied && !widenAttempted;
      // ⛔ A ZERO MUST NAME THE POPULATION IT SEARCHED, OR IT READS AS A CLAIM ABOUT THE REPOSITORY.
      //
      // the field test, field-testing the heading index on their own corpus: `denoiser` returned
      // "NO RESULTS. Ruled out: the index is fresh." — with ELEVEN documents discussing denoisers
      // sitting in that corpus. `git grep` finds all eleven.
      //
      // ⛔⛔ AND "RULED OUT: THE INDEX IS FRESH" MADE THE FALSE NEGATIVE MORE CONFIDENT. It answers
      // "is this stale?", which was not the reason for the zero, and by eliminating the one cause
      // it can see it implies the remaining explanation is that the topic is not here. Their words:
      // a three-state instrument reporting two states — PRESENT and ABSENT, with NOT-SIGNPOSTED
      // collapsed into ABSENT. `git grep` returning noise never does that, because noise is
      // visibly noise and a confident zero is not.
      //
      // ⇒ So when documents were IN SCOPE and none matched, say what was actually searched.
      // Document bodies are not indexed anywhere in this system; the searchable surface is
      // filename, title and headings. That is a real recall floor and it is honest — the message
      // was not. Of four topics genuinely present in their corpus, this found one, because their
      // documents are audits and session logs whose headings are dates and role names.
      //
      // ⚠ ONLY WHEN DOCUMENTS COULD HAVE MATCHED. On the default kind="code" the reader already
      // gets the line below telling them documents were excluded entirely, and adding this there
      // would be a second explanation for a population they did not ask for.
      const docsInScope = kind === 'all' || type === 'Document';
      const base = [
        `NO RESULTS for "${normalizedQuery}".`,
        ruledOut.length ? `Ruled out: ${ruledOut.join('; ')}.` : '',
        mayNarrow.length ? `May be narrowing: ${mayNarrow.join('; ')}.` : '',
        docsInScope
          ? 'Scope searched for documents: FILENAME, TITLE and HEADINGS only — document bodies are '
            + 'not indexed. A topic discussed inside a document but never written into a heading is '
            + 'not reachable here, so this zero is NOT evidence the topic is absent from the repo. '
            + 'Fall back to grep for body text.'
          : '',
        defaultNarrowed
          ? 'Note: this verb DEFAULTS to kind="code", which excludes Document/Directory/Config/External nodes — you did not set that.'
          : '',
        widenAttempted
          ? 'Scope: code found nothing, so Document/Directory/Config nodes were searched too and also '
            + 'matched nothing. Documents match on FILENAME, TITLE and HEADINGS only — a topic '
            + 'discussed in a body but never in a heading is not reachable here, so this is NOT '
            + 'evidence the topic is absent. Fall back to grep for body text.'
          : '',
        // graph_find is not in the default profile, so naming it spent a round trip to
        // discover it was unreachable. graph_pull is the listed cross-layer verb.
        // `widenAttempted` counts as already-widened: the widened search ran and returned nothing,
        // so offering kind="all" would send the reader to a call whose answer is already known.
        (kind === 'all' || widenAttempted)
          ? `Next: graph_pull for cross-layer context on a known node.`
          : `Next: graph_search(query="${normalizedQuery}", kind="all") to include docs/configs, or graph_pull for cross-layer context on a known node.`,
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
    const scored = reserveForWidened(ranked);
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
    // Widening silently would trade one dishonesty for another: the reader must know the population
    // they got is not the population the verb defaults to, and what its recall floor is.
    // ⛔ BOTH ROUTES INTO THE WIDER POPULATION MUST DISCLOSE IT, and adding the prose route silently
    // was a regression this test caught: a multi-token query now searches documents from the START
    // (it never reaches the widen-on-zero branch), so keying the note off `autoWidened` alone made
    // the commonest discovery path the one that says nothing.
    const widenedNote = (autoWidened || (proseQuery && effectiveKind === 'all'))
      ? `${'\n'}WIDENED: this searched Document/Directory/Config nodes too `
        + '(kind="all"). Documents are matched on FILENAME, TITLE and HEADINGS only — bodies are not '
        + 'indexed, so this is a floor, not a complete match set.'
      : '';
    return prefixReadWarnings(rendered + shownNote + sqlCapNote + widenedNote, freshnessWarnings);
  } finally {
    db.close();
  }
}
