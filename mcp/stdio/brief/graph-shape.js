// EVERYTHING THE BRIEF DERIVES FROM THE GRAPH DATABASE.
//
// The seam is DATA SOURCE, established by classifying every function in the original 1966-line
// generator.js by what it reads. This module is the `db` side; brief/extract.js is the
// filesystem side; brief/artifacts.js is tasks.json and the pure coverage tier; brief/render.js
// turns the result into text. generator.js keeps only orchestration and the crossers.
//
// ⚠ THREE FUNCTIONS DELIBERATELY DID NOT MOVE, because they read BOTH sides and the audit
// flagged the first of them by name:
//   · entryPoints(db, repoRoot)  — queries the graph AND calls detectFromPackageJson
//   · repoSnapshot(db, repoRoot)
//   · extractExports
// The refactor proposal filed `entryPoints` under db-only as the FIRST entry of that group;
// measuring the axis rather than reading the table showed it crosses. Splitting a crosser to
// force a clean boundary would move the defect into the seam instead of naming it, so they stay
// with orchestration and the crossing is stated.

import { join } from 'node:path';
import { buildPaths } from '../query/verbs/path.js';
import { edgeClass } from '../storage/edge-classes.js';

// Module constants moved with the functions that read them — a constant is as much a
// dependency as a call, and the extraction planner only enumerated imports and functions.
// Single-header amalgamation libraries and vendored code that dominate
// hub ranking without being meaningful subsystems.
const NOISE_FILE_PATTERNS = [
  /vk_mem_alloc/i, /stb_/i, /thirdparty\//, /vendor\//, /node_modules\//,
  /__snapshots__\//, /\.min\.(js|css)$/,
];
const STOPWORD_LABELS = new Set([
  'close','open','read','write','get','set','json','log','print','send',
  'parse','init','run','test','str','int','len','__init__','__str__',
  '__repr__','raise_for_status','toString','handle','make','build','map',
  'filter','reduce','push','pop','pipe','next','prev',
]);
// M4b: filter out vendor-include traversal and type-name "calls" that
// pollute PATHS on C++/GLSL repos. Echoes brief showed examples like
// `main → vec4 :0` (GLSL type) and `draw → vk_mem_alloc erase` (vendor
// include). These damage trust without adding navigational value.
const VENDOR_PATH_PATTERNS = [
  /\/vendor\//, /\/third[_-]?party\//, /\/external\//, /\/deps\//,
  /\/node_modules\//, /\/vk_mem_alloc/, /\/glm\//, /\/stb_/,
  /\/imgui/, /\/SDL/, /\/Vulkan/i, /\/eigen/,
];
const TYPE_NAME_PATTERNS = [
  // GLSL primitive types
  /^(vec|mat|ivec|uvec|bvec|dvec)[2-4]$/,
  /^(int|uint|float|double|bool|void)$/,
  /^(sampler\w*|image\w*|texture\w*)$/,
  // C++ STL containers (often called as constructors)
  /^(string|vector|map|set|array|pair|tuple|optional|unique_ptr|shared_ptr|weak_ptr)$/,
];
// Test-typed nodes plus files under conventional test paths, across the
// languages we actually index. Markdown is excluded because doc paths
// coincidentally containing "test"/"spec" are not tests.
//
// C++ suffixes are spelled `_test`/`_tests` rather than a bare `%test.cpp`:
// SQLite LIKE is case-insensitive, so `%test.cpp` would also match innocent
// names like `latest.cpp`.
const TEST_FILE_PREDICATE = `(
       type = 'Test'
       OR file_path LIKE 'tests/%'
       OR file_path LIKE 'test/%'
       OR file_path LIKE '%/tests/%'
       OR file_path LIKE '%/test/%'
       OR file_path LIKE '%/__tests__/%'
       OR file_path LIKE '%.test.js'
       OR file_path LIKE '%.test.ts'
       OR file_path LIKE '%.spec.js'
       OR file_path LIKE '%.spec.ts'
       OR file_path LIKE '%_test.py'
       OR file_path LIKE '%_test.cpp'
       OR file_path LIKE '%_test.cc'
       OR file_path LIKE '%_tests.cpp'
       OR file_path LIKE '%_test.go'
       OR file_path LIKE '%_test.rs'
     )`;

export function q(db, sql, params = {}) {
  return db.all(sql, params);
}
export function count(db, sql, params = {}) {
  return db.get(sql, params).c;
}
export function extractPaths(db, exportsArr, limit = 5) {
  if (!exportsArr || exportsArr.length === 0) return { paths: [], hiddenCount: 0 };
  const out = [];
  let hiddenCount = 0;
  // Deepest-chain flattener: pick the longest descendant branch at each level.
  function deepestChain(tree) {
    if (!tree) return [];
    const node = { name: tree.symbol, file: tree.file, line: tree.line };
    if (!tree.children || tree.children.length === 0) return [node];
    // Pick child with the deepest subtree, skipping noise
    let bestChild = null;
    let bestDepth = -1;
    for (const c of tree.children) {
      if (isPathNoise({ symbol: c.symbol, file: c.file, line: c.line })) {
        hiddenCount += 1;
        continue;
      }
      const d = subtreeDepth(c);
      if (d > bestDepth) {
        bestDepth = d;
        bestChild = c;
      }
    }
    return [node, ...deepestChain(bestChild)];
  }
  function subtreeDepth(t) {
    if (!t || !t.children || t.children.length === 0) return 1;
    return 1 + Math.max(...t.children.map(subtreeDepth));
  }

  for (const ex of exportsArr.slice(0, limit)) {
    // Resolve the EXPORT to a graph node. For MCP verbs the location is
    // `mcp/stdio/server.js:handler=graphX` — we want graphX, not graph_x.
    let symbol = ex.name;
    const handlerMatch = String(ex.location || '').match(/handler=([A-Za-z_][A-Za-z0-9_]*)/);
    if (handlerMatch) symbol = handlerMatch[1];

    const sources = db.all(
      `SELECT id, label, type, file_path, start_line, confidence
       FROM nodes WHERE label = $label
         AND type IN ('Function','Method','Class','Route','Entrypoint')
       LIMIT 1`, { label: symbol });
    if (sources.length === 0) continue;
    const root = sources[0];

    try {
      const tree = buildPaths(db, root, {
        direction: 'out',
        maxDepth: 5,
        explorationWidth: 12,
        relations: ['PASSES_THROUGH', 'INVOKES', 'CALLS'],
        visited: new Set(),
      });
      if (!tree) continue;
      const chain = deepestChain(tree);
      if (chain.length < 2) continue; // single-node path is not informative
      out.push({ entry: ex.name, chain });
    } catch {}
  }

  return { paths: out, hiddenCount };
}
export function detectCanonicalEntries(db) {
  // Canonical filenames in project-root-ish locations. Scoped tight to avoid
  // bringing in tests/fixtures/ and nested third-party copies.
  const rows = q(db,
    `SELECT label, file_path AS file FROM nodes
     WHERE type = 'File'
       AND label IN ('server.js', 'main.py', 'app.py', 'index.php',
                     'main.go', 'main.rs', 'main.cpp', 'app.js',
                     'cli.js', 'cli.ts', 'artisan')
       AND file_path NOT LIKE 'tests/%'
       AND file_path NOT LIKE 'test/%'
       AND file_path NOT LIKE 'node_modules/%'
       AND file_path NOT LIKE 'vendor/%'
     LIMIT 10`);
  // Prefer shallower paths first (root-level server.js beats nested ones).
  return rows
    .map(r => ({ file: r.file, why: `canonical entry: ${r.label}`, source: 'canonical', depth: r.file.split('/').length }))
    .sort((a, b) => a.depth - b.depth);
}
export function subsystems(db, limit = 6) {
  // For each Directory node, count File nodes whose parent is exactly this
  // dir (path = `<dir>/<basename>` with no further slashes). Also count
  // outgoing edges sourced from files inside this directory (edge weight)
  // so architecturally important but small subsystems still surface.
  //
  // Bench 2026-04-20 found that ranking SUBSYS by file count alone dropped
  // echoes_of_the_fallen's engine/ecs subsystem from the brief — small
  // directory, but structurally central. Composite score fixes this.
  const rows = q(db,
    `SELECT n.file_path AS path,
            (SELECT COUNT(*) FROM nodes f
             WHERE f.type = 'File'
               AND f.file_path LIKE n.file_path || '/%'
               AND instr(substr(f.file_path, length(n.file_path) + 2), '/') = 0
            ) AS file_count,
            (SELECT COUNT(*) FROM edges e
             WHERE e.source_file LIKE n.file_path || '/%'
            ) AS edge_count
     FROM nodes n
     WHERE n.type = 'Directory'
       AND n.file_path != '.'
       AND n.file_path != ''
       AND n.file_path NOT LIKE 'tests/%'
       AND n.file_path NOT LIKE 'test/%'
       AND n.file_path NOT LIKE 'node_modules/%'
       AND n.file_path NOT LIKE 'vendor/%'
       AND n.file_path NOT LIKE '.%'
       AND n.file_path NOT LIKE '%/thirdparty/%'
       AND n.file_path NOT LIKE '%/third_party/%'
       AND n.file_path NOT LIKE 'thirdparty/%'
       AND n.file_path NOT LIKE 'third_party/%'
       AND n.file_path NOT LIKE '%/deps/%'
       AND n.file_path NOT LIKE '%/external/%'
       AND n.file_path NOT LIKE '%/thirdparty'
       AND n.file_path NOT LIKE '%/third_party'
       AND n.file_path NOT IN ('tests', 'test', 'vendor', 'node_modules', 'docs', 'scripts', 'thirdparty', 'third_party', 'deps', 'external')`);
  // Composite score: file_count (primary) + edge_count / 5 (structural density
  // signal). A subsystem with 10 files and 500 edges beats one with 30 files
  // and 20 edges. Keeps primary file-count ranking intact for most repos but
  // rescues structurally-central small directories.
  const scored = rows
    // Drop 0-file parent directories — they crowd out leaf subsystems with
    // redundant aggregated edge counts. Bench 2026-04-20: echoes "engine (0f
    // 15489e)" crowded out engine/ecs at top-4.
    // Rescue structurally-central small directories: allow file_count >= 2
    // OR (file_count >= 1 AND high edge density) to surface 1-2 file dirs
    // that punch above their size (e.g. engine/ecs with few files but many
    // consumers).
    .filter(r => r.file_count >= 2 || (r.file_count >= 1 && r.edge_count >= 50))
    .map(r => ({
      path: r.path,
      file_count: r.file_count,
      edge_count: r.edge_count,
      score: r.file_count + Math.floor((r.edge_count || 0) / 5),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(r => ({
    path: r.path,
    why: `${r.file_count} files, ${r.edge_count} edges`,
    score: r.score,
    file_count: r.file_count,
    edge_count: r.edge_count,
  }));
}
export function hubs(db, limit = 5) {
  const stop = [...STOPWORD_LABELS].map(s => `'${s.replace(/'/g, "''")}'`).join(',');
  const rows = q(db,
    `SELECT n.label, n.type, n.file_path AS file, n.start_line AS line,
            count(e.from_id) AS fan_in
     FROM nodes n JOIN edges e ON e.to_id = n.id
     WHERE n.type IN ('Function', 'Method', 'Class', 'Interface')
       AND e.relation IN ('CALLS', 'REFERENCES')
       AND n.label NOT IN (${stop})
     GROUP BY n.id
     ORDER BY fan_in DESC LIMIT $limit`, { limit: limit * 3 });
  return rows
    .filter(r => !isNoisyFile(r.file))
    .slice(0, limit)
    .map(r => ({ ...r, role: classifyRole(r.label, r.file, r.type) }));
}
/**
 * The linked-document candidate population AND the sample rendered from it.
 *
 * ⛔ ONE PRODUCER OWNS MEMBERSHIP AND DENOMINATOR. This was inline in `readFirst`, which slices to
 * two before returning — so anything counting the returned array was counting a RENDERED SAMPLE.
 * `document_evidence.linked_candidate_count` reported 2 against a real population of 88.
 *
 * ⇒ That is the cap-reported-as-a-total defect, committed inside the typed state whose purpose is
 * to stop it. The same shape as `filesTotal` being the scope's denominator and as the enumeration
 * ceiling reported as convergence — the third time today, and the first where I built it into the
 * remedy rather than finding it in old code.
 *
 * ⚠ It also means the STATE was derived from rendering rather than evidence: if the display slice
 * were filtered downstream the artifact would report `indexed_without_link_candidates` while
 * candidates existed.
 *
 * @returns {{items: Array, total: number, basis: string}} `total` is the population; `items` is
 *   what a caller should render. A consumer that wants the cap disclosed compares the two.
 */
export function linkedDocumentCandidates(db, opts = {}) {
  const { docRecency = null } = opts;
  let total = 0;
  let docBasis = 'links';
  // ⛔ CANDIDATE POPULATION IS EVERY DOCUMENT. The first version joined from the candidate to a
  // non-Document target, so a document could not be a candidate unless it referenced code — which
  // excluded exactly the docs index that other documents point AT. graph-senior-dev executed it:
  // `other.md` LINKS_TO `docs/index.md`, and the index was absent while the unrelated source won on
  // root position. My own test "doc→doc links alone do not qualify" had PINNED that exclusion.
  //
  // ⚠ RELATION AND EXTRACTOR SCOPED. The counts used to include every relation from any Document
  // source, so the retiring legacy `MENTIONS` population influenced ranking silently — 532 authored
  // LINKS_TO against 99 legacy MENTIONS on this repo, combined under one label. Mentions are
  // REPORTED, never ranked on: two authorities under one number is how a figure stops meaning
  // anything.
  // ⚠ FROM THE LEDGER, NOT A LITERAL. Embedding `doc_link:%` here made this file a second holder
  // of a prefix that scopes a DELETE elsewhere, and the ownership gate turned red on it — correctly,
  // because that gate cannot tell a reader from a writer and my own rule for it was "if a reader
  // needs the label, import the constant". Third time today one of these gates has caught its
  // author, which is the only evidence that they are refusals rather than reminders.
  const DOC_LINK = edgeClass('doc_link');
  const LINK = `e.relation = '${DOC_LINK.relation}' AND e.extractor LIKE '${DOC_LINK.extractor}%'`;
  let docs = q(db,
    `SELECT n.label, n.file_path AS file,
            (SELECT count(*) FROM edges e JOIN nodes s ON s.id = e.from_id
              WHERE e.to_id = n.id AND s.type = 'Document' AND ${LINK}) AS inbound,
            (SELECT count(*) FROM edges e JOIN nodes t ON t.id = e.to_id
              WHERE e.from_id = n.id AND t.type != 'Document' AND ${LINK}) AS deg,
            (SELECT count(*) FROM edges e
              WHERE e.from_id = n.id AND e.relation = 'MENTIONS') AS mentions
       FROM nodes n WHERE n.type = 'Document'`)
    .filter((d) => d.inbound > 0 || d.deg > 0);

  // ⛔ NO PRE-TRUNCATION. The first version took `LIMIT 12` in SQL ordered by inbound, then applied
  // recency in JS — so recency ranked the top-12-by-a-different-order, not the population.
  // graph-senior-dev executed that too: 13 documents, all inbound 0, the NEWEST holding the lowest
  // degree, and it never entered the sort. At 155 rows there is nothing to justify a cap; if scale
  // ever demands one it must preserve complete tie groups and be disclosed as a cap.
  const recencyOf = (file) => {
    const v = docRecency instanceof Map ? docRecency.get(file) : docRecency?.[file];
    return typeof v === 'string' ? v : null;
  };
  docs.sort((a, b) => {
    if (b.inbound !== a.inbound) return b.inbound - a.inbound;
    const ra = recencyOf(a.file);
    const rb = recencyOf(b.file);
    if (ra !== rb) {
      if (ra == null) return 1;          // UNKNOWN sorts last, never as "oldest"
      if (rb == null) return -1;
      return rb.localeCompare(ra);
    }
    if (b.deg !== a.deg) return b.deg - a.deg;
    // Lexical, not length: equal-length paths otherwise fall back to SQLite row order and the
    // brief stops being byte-deterministic for the same graph.
    return a.file.localeCompare(b.file);
  });

  // ⛔⛔ THE RANKING IS UNGRADED AND ON ITS ONLY GROUND-TRUTH CORPUS IT IS WRONG. ef-manager field-
  // tested it on `echoes_of_the_fallen`, whose CLAUDE.md line 3 says verbatim "Read AGENTS.md
  // first" — so the answer is written down rather than judged:
  //
  //     rank 1   docs/contracts/worldbuffer-authority.md     last commit 2026-04-27
  //     rank 2   docs/contracts/configuration-authority.md   last commit 2026-04-27
  //     AGENTS.md                                            NOT IN TOP 12 · committed 2026-08-19
  //
  // ⇒ INBOUND SELECTS THE MOST-CITED DOCUMENT, AND "READ FIRST" WANTS THE ONE THAT ORIENTS YOU. In
  // a contract-heavy repo those are different genres: a contract is cited by everything and read
  // when you need the contract. Worse, frozen contracts accrue citations while never being edited,
  // so inbound rank and staleness correlate POSITIVELY — the ranking is pulled toward old documents
  // by construction, and recency cannot correct it because inbound is a strict primary sort.
  //
  // ★ Same shape as the resolution-rate signal ef-manager refuted earlier: a metric that tracks
  // GENRE, read as currency. Neither of us could see it from inside one repo.
  //
  // ⇒ SO THE REMEDY HERE IS DISCLOSURE, NOT RE-SORTING. The inbound evidence is real and I have no
  // graded replacement; silently re-ranking on a signal I cannot defend would be swapping an
  // unmeasured order for another. The `why` states what the evidence IS and how much of the corpus
  // is newer, and the reader applies the correction the ranking cannot safely apply for them.
  // ⚠ SNAPSHOT THE FULL CANDIDATE SET BEFORE SLICING. `newerThan` closed over `docs`, which is
  // reassigned to the two survivors below — so the disclosure counted "how many of the TWO shown
  // are newer" while claiming to describe the corpus. Caught by its own test expecting 4 and
  // getting nothing. The same population error the whole ranking is about, committed inside the
  // sentence that discloses it.
  const population = docs.slice();
  const known = population.map((d) => recencyOf(d.file)).filter(Boolean).sort();
  const median = known.length ? known[Math.floor(known.length / 2)] : null;
  const newerThan = (date) => (date ? population.filter((d) => {
    const r = recencyOf(d.file);
    return r && r > date;
  }).length : 0);

  // ⛔⛔ THE POSITIONAL FALLBACK IS A SEPARATE POPULATION AND USED TO TRAVEL IN `items`.
  //
  // graph-senior-dev built a graph with two root Documents and zero edges. One artifact then said:
  // 0 linked candidates, 2 shown candidates, "ranked by link prominence" — beside two entries whose
  // own `why` said "position, not evidence". Three statements, mutually exclusive, same section.
  //
  // ⇒ The producer was mixing authored-link candidates with root-position fallbacks under one name.
  // They are different evidence and they now travel in different fields; a consumer that wants only
  // link evidence can no longer be handed position by accident.
  let positionalFallback = [];
  if (docs.length === 0) {
    docBasis = 'position';
    total = 0;
    docs = [];
    positionalFallback = q(db,
      `SELECT label, file_path AS file, 0 AS inbound, 0 AS deg, 0 AS mentions FROM nodes
        WHERE type = 'Document' AND file_path NOT LIKE '%/%'
        ORDER BY length(file_path) ASC, file_path ASC LIMIT 2`);
  } else {
    // ⛔ THE TOTAL IS CAPTURED BEFORE THE SLICE. It used to be counted AFTER, from the
    // RENDERED array, so `linked_candidate_count` reported 2 for a population of 88 — a cap
    // reported as a total, in the typed state built to remove exactly that. graph-senior-dev
    // measured it on this graph.
    total = docs.length;
    docs = docs.slice(0, 2);
  }
  // ⚠ `population` is the full sorted candidate list, returned because the staleness disclosure
  // must count the CORPUS of candidates, not the two rendered. That disclosure already had this bug
  // once — it closed over the sliced array and reported "how many of the TWO shown are newer".
  return { items: docs, total, basis: docBasis, population, positionalFallback };
}

export function readFirst(db, limit = 6, opts = {}) {
  // Non-obvious "read first" targets. Priority order:
  //   1. Linked document candidates (link prominence — NOT a read order; see the note below)
  //   2. Files that back an EXPORTS entry (if passed in)
  //   3. Files with anchored feature overlays (if passed in)
  //   4. High-degree source files as fallback, filtered by dominant language
  const { exports: exportsArr = [], overlayHealth, primaryExt = null, docRecency = null } = opts;

  // ⛔ THIS WAS A THREE-NAME ALLOWLIST AND IT MATCHED NOTHING. Measured on this repo:
  //
  //     Document nodes                                                     155
  //     matching ARCHITECTURE.md / DESIGN.md / DEVELOPMENT.md                0
  //     negative control (a name nobody has)                                 0
  //
  // So the doc section of the brief an agent reads FIRST was empty, and had been for the life of
  // the repo. The recorded figure was 0 of 74; the doc-corpus fix doubled the population the
  // allowlist fails to match without changing the outcome, because the outcome was never about
  // how many documents exist.
  //
  // ⇒ DERIVED, NOT NAMED. No document is excluded for having an unexpected name; that is the whole
  // defect this replaced.
  //
  // ⚠ THIS COMMENT USED TO CALL THE RESULT "an orienting document" AND THAT CLAIM IS WITHDRAWN.
  // Link prominence measures how much of the system a document REFERENCES and how often other
  // documents cite it. On the only corpora with stated ground truth, that ranked contracts above the
  // file the repo itself names as its entry point — 0 of 2. What the numbers measure is real; what
  // they were said to mean was not.
  //
  // ⚠ AND THE HONEST LIMIT, STATED RATHER THAN IMPLIED: outbound degree means "describes a lot of
  // code", NOT "describes the code as it is now". A superseded plan can outrank a current
  // changelog, and there is no derived staleness signal for documents in this graph. The `why`
  // carries the evidence so a reader can judge it instead of trusting the ordering.
  // ⚠ The population is computed ONCE. The generator passes it in so the same query does not run
  // twice, and so the renderer and this ranking cannot disagree about how many candidates exist.
  const candidates = opts.documentCandidates ?? linkedDocumentCandidates(db, { docRecency });
  const docBasis = candidates.basis;
  const docs = candidates.items;
  const recencyOf = (file) => {
    const v = docRecency instanceof Map ? docRecency.get(file) : docRecency?.[file];
    return typeof v === 'string' ? v : null;
  };
  const population = candidates.population ?? [];
  const known = population.map((d) => recencyOf(d.file)).filter(Boolean).sort();
  const median = known.length ? known[Math.floor(known.length / 2)] : null;
  const newerThan = (date) => (date ? population.filter((d) => {
    const r = recencyOf(d.file);
    return r && r > date;
  }).length : 0);

  const files = q(db,
    `SELECT n.label, n.file_path AS file, count(e.from_id) AS deg
     FROM nodes n JOIN edges e ON e.to_id = n.id OR e.from_id = n.id
     WHERE n.type = 'File'
     GROUP BY n.id
     ORDER BY deg DESC LIMIT $limit`, { limit: limit * 4 });

  const out = [];
  const seen = new Set();
  const push = (file, why, kind) => {
    if (!file || seen.has(file) || isNoisyFile(file)) return;
    seen.add(file);
    out.push({ file, why, kind });
  };

  // ⚠ THE `why` STATES THE EVIDENCE AND DECLINES THE ONTOLOGY CLAIM. graph-senior-dev's wording:
  // this is INDEXED AUTHORED DOC LINKS — route authority — not a claim that a document is canonical
  // or accurate. "architecture doc" was a claim about KIND that nothing in the graph supported.
  // ⛔⛔ POSITIONAL ROWS ARE NOT PUSHED HERE AT ALL, AND THE REASON IS CUSTODY, NOT PRESENTATION.
  //
  // They used to enter this accumulator and its `seen` dedupe before exports and source rows.
  // graph-senior-dev executed the overlap: one root `AGENTS.md` with no links, and an
  // export-backed source fact for the SAME path. The positional row claimed `seen` first and the
  // export fact was silently discarded — the WEAKER authority erasing the STRONGER one, with the
  // renderer's later re-split by kind unable to recover it because the row no longer existed.
  //
  // ⚠ Splitting by kind at RENDER time is presentation separation. This is producer separation: the
  // positional population never enters the mixed array, so it cannot consume the shared dedupe or
  // the global limit. `linkedDocumentCandidates()` returns it and the generator carries it as its
  // own field.
  for (const d of docs) {
    const rec = recencyOf(d.file);
    const newer = median && rec && rec < median ? newerThan(rec) : 0;
    push(d.file,
      `${d.inbound} document(s) link here (indexed authored doc links), `
      + `${d.deg} repository file(s) referenced`
      + (d.mentions > 0 ? `, ${d.mentions} symbol mention(s)` : '')
      + (rec ? `, last edited ${rec}` : ', edit date UNKNOWN')
      // ⇒ ef-manager's disclosure: on their ground-truth corpus the top two answers were four
      // months older than the entry point the repo itself names. The reader gets the correction
      // the ranking cannot safely apply.
      // ⚠ NAMED PRECISELY: this counts LINKED CANDIDATES, not every Document node. Calling it
      // corpus-wide would be the population error the whole ranking is about — and it cannot
      // correct for an entry document excluded from candidacy in the first place, which is exactly
      // what happened to AGENTS.md on the graded corpora.
      + (newer > 0 ? ` — ⚠ ${newer} linked candidate(s) are newer` : '')
      + ' — evidence of relevance, not of accuracy',
    'doc');
  }

  // EXPORTS-backed files: parse "<file>:<line>" or "<file> → handler" forms
  for (const ex of (exportsArr || [])) {
    const m = String(ex.location || '').match(/^([^:→]+?)(?::|\s→|$)/);
    const file = m ? m[1].trim() : null;
    if (file && !file.includes('=')) {
      push(file, `backs EXPORT: ${ex.name}`, 'export');
    }
    if (out.length >= limit) break;
  }

  // Feature-anchored files (from overlay) — skip glob entries
  if (overlayHealth?.valid?.length) {
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      const fsrc = Array.isArray(feature.anchors?.files) ? feature.anchors.files : [];
      for (const f of fsrc.slice(0, 2)) {
        if (!f.includes('*') && !f.includes('?')) {
          push(f, `anchors feature: ${feature.id}`, 'feature-anchor');
        }
      }
      if (out.length >= limit) break;
    }
  }

  // Fallback: high-degree files, prefer dominant language
  const ranked = files
    .filter(f => {
      if (isNoisyFile(f.file)) return false;
      if (/^(README|AGENTS|CONTRIBUTING)\.md$/i.test(f.label)) return false;
      return true;
    })
    .sort((a, b) => {
      if (!primaryExt) return b.deg - a.deg;
      const aMatch = a.file.endsWith('.' + primaryExt) ? 1 : 0;
      const bMatch = b.file.endsWith('.' + primaryExt) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.deg - a.deg;
    });

  for (const f of ranked) {
    push(f.file, `${f.deg} connections`, 'high-degree');
    if (out.length >= limit) break;
  }

  return out;
}
// One row per test file, carrying how many declared test CASES live in it.
// `cases` counts Test-typed nodes (Catch2 TEST_CASE / GTest TEST / pytest etc.),
// which is what separates a real suite file from a helper script that merely
// sits under tests/.
export function testFileRows(db) {
  return q(db,
    `SELECT file_path AS file,
            sum(CASE WHEN type = 'Test' THEN 1 ELSE 0 END) AS cases
     FROM nodes
     WHERE ${TEST_FILE_PREDICATE}
       AND file_path IS NOT NULL AND file_path <> ''
       AND file_path NOT LIKE '%.md'
       AND file_path NOT LIKE '%node_modules/%'
     GROUP BY file_path`);
}
// What test system does this repo ACTUALLY use, and how big is it? Without this,
// the three anchors below are indistinguishable from "this repo has three tests".
export function testInventory(db) {
  const rows = testFileRows(db);
  const byExt = new Map();
  for (const r of rows) {
    const ext = (r.file.match(/\.[A-Za-z0-9_+]+$/) ?? ['(none)'])[0].toLowerCase();
    const cur = byExt.get(ext) ?? { ext, files: 0, cases: 0 };
    cur.files += 1;
    cur.cases += r.cases ?? 0;
    byExt.set(ext, cur);
  }
  const systems = [...byExt.values()]
    .sort((a, b) => b.files - a.files || a.ext.localeCompare(b.ext));
  return { total: rows.length, systems };
}
export function testAnchors(db, limit = 3) {
  // ORDER matters more here than it looks. Framework plugins (Catch2/GTest for
  // C++) run in the ENRICH phase, so their Test nodes are inserted LAST — under
  // the old unordered `LIMIT 3` they could never win a tie no matter how many
  // there were. Sand Castle field report (2026-07-27): brief.agent.md named 3
  // Python helper scripts as the test system of a repo with 129 Catch2 files.
  // An agent reading that looks for the wrong suite and concludes the real one
  // does not exist.
  //
  // Rank by declared test cases (a file with 12 TEST_CASEs is more
  // representative than a helper with none), then by path for determinism.
  const rows = testFileRows(db)
    .sort((a, b) => (b.cases ?? 0) - (a.cases ?? 0) || a.file.localeCompare(b.file))
    .slice(0, limit);
  return rows.map(r => ({
    file: r.file,
    why: r.cases > 0 ? `test file (${r.cases} cases)` : 'test file',
  }));
}
// For each valid feature, precompute action-bearing data the plan brief
// needs: test files anchored under the feature's file globs, + a rough
// callers count summed across feature symbols. This is what makes
// brief.plan.md say "open these tests, N callers" instead of just listing
// anchors. Convergent audit finding (subagent + dev, both 6.5/10): plan
// brief was too orient-shaped; this is the highest-leverage fix.
export function enrichFeaturesForPlanning(db, validFeatures) {
  const enriched = [];
  for (const entry of validFeatures) {
    const { feature } = entry;
    const fileGlobs = feature.anchors.files || [];

    // Tests related to this feature. Three signals, applied in order:
    //   1. Symbol-reference edges (test files that CALL/REFERENCE anchored symbols)
    //   2. Path-token match (tests whose path shares a dir token with the feature's files)
    //   3. Glob match under feature's file anchors (covers projects that keep tests co-located)
    let tests = (feature.tests || []).map((file_path) => ({ file_path }));
    const symbols = feature.anchors.symbols || [];
    if (tests.length === 0 && symbols.length > 0) {
      tests = db.all(
        `SELECT DISTINCT f.file_path FROM nodes f
         JOIN edges e ON e.from_id = f.id
         JOIN nodes s ON s.id = e.to_id
         WHERE s.label IN (${symbols.map((_, i) => `$s${i}`).join(',')})
           AND e.relation IN ('CALLS', 'REFERENCES', 'TESTS', 'USES_TYPE')
           AND (f.file_path LIKE 'tests/%' OR f.file_path LIKE 'test/%'
                OR f.file_path LIKE '%/__tests__/%' OR f.file_path LIKE '%.test.%'
                OR f.file_path LIKE '%.spec.%' OR f.file_path LIKE '%_test.py')
         LIMIT 10`,
        Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]))
      );
    }
    // Path-token fallback: extract meaningful tokens from feature's file globs
    // (e.g. `mcp/stdio/freshness/*` → "freshness") and find tests whose path
    // contains any of them.
    if (tests.length === 0 && fileGlobs.length > 0) {
      const tokens = new Set();
      for (const glob of fileGlobs) {
        for (const part of glob.split(/[/*]+/)) {
          if (part.length >= 4 && !['mcp', 'src', 'app', 'lib', 'app/', 'tests'].includes(part)) {
            tokens.add(part);
          }
        }
      }
      if (tokens.size > 0) {
        const likes = [...tokens].map((_, i) => `file_path LIKE $t${i}`).join(' OR ');
        const params = Object.fromEntries([...tokens].map((t, i) => [`t${i}`, `%${t}%`]));
        tests = db.all(
          `SELECT DISTINCT file_path FROM nodes
           WHERE type = 'File'
             AND (file_path LIKE 'tests/%' OR file_path LIKE 'test/%'
                  OR file_path LIKE '%.test.%' OR file_path LIKE '%.spec.%'
                  OR file_path LIKE '%_test.py')
             AND (${likes})
           LIMIT 5`, params);
      }
    }
    // Final fallback: direct glob match (covers co-located tests)
    if (tests.length === 0 && fileGlobs.length > 0) {
      tests = db.all(
        `SELECT DISTINCT file_path FROM nodes
         WHERE type = 'File'
           AND (file_path LIKE 'tests/%' OR file_path LIKE 'test/%'
                OR file_path LIKE '%.test.%' OR file_path LIKE '%.spec.%')
           AND (${fileGlobs.map((_, i) => `file_path GLOB $g${i}`).join(' OR ')})
         LIMIT 5`,
        Object.fromEntries(fileGlobs.map((g, i) => [`g${i}`, g]))
      );
    }

    // Callers count: sum of incoming edges to every anchored symbol. This
    // gives a single "how load-bearing is this feature?" number.
    // M4b: extended with INVOKES + PASSES_THROUGH so framework-driven call
    // chains count, and with file-anchored callers (incoming edges to any
    // node in feature.anchors.files) so C++ class methods that don't share
    // a label with the anchored symbol still register. The previous shape
    // produced 0 for major C++ features even when their files had clear
    // inbound traffic — validation gate / echoes tester finding.
    let callersTotal = 0;
    const anchoredFiles = entry.feature?.anchors?.files ?? [];
    if (symbols.length > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes n ON n.id = e.to_id
         WHERE n.label IN (${symbols.map((_, i) => `$s${i}`).join(',')})
           AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH')`,
        Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]))
      );
      callersTotal += row?.c ?? 0;
    }
    if (anchoredFiles.length > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes tn ON tn.id = e.to_id
         WHERE e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH')
           AND e.source_file NOT IN (SELECT file_path FROM nodes WHERE type='File' AND (${anchoredFiles.map((_, i) => `file_path GLOB $f${i}`).join(' OR ')}))
           AND (${anchoredFiles.map((_, i) => `tn.file_path GLOB $f${i}`).join(' OR ')})`,
        Object.fromEntries(anchoredFiles.map((g, i) => [`f${i}`, g]))
      );
      callersTotal += row?.c ?? 0;
    }

    enriched.push({
      ...entry,
      tests: tests.map(t => t.file_path),
      callers_total: callersTotal,
    });
  }
  return enriched;
}
// For each RISK file, compute: which features anchor it + how many callers
// its symbols have + the closest test file. Answers "if I touch this, what
// context matters?" without requiring a separate graph_impact call.
export function enrichRisksForPlanning(db, risksArr, features) {
  return risksArr.map(r => {
    const matchedFeatures = features
      .filter(f => (f.anchors.files || []).some(g => globMatchesPath(g, r.file)))
      .map(f => f.id);
    // Nearest test: file in same dir or one of the feature's test files
    const dir = r.file.split('/').slice(0, -1).join('/') || '.';
    // Same C++ blindness as the anchors had: keying on a literal `tests/%`
    // prefix returned nearest_test: null for every risk file in a repo whose
    // suite lives anywhere else. Reuse the shared predicate.
    const nearestTest = db.get(
      `SELECT file_path FROM nodes
       WHERE ${TEST_FILE_PREDICATE}
         AND file_path NOT LIKE '%.md'
         AND file_path LIKE $pattern
       LIMIT 1`, { pattern: `%${dir.split('/').pop()}%` });
    return {
      ...r,
      features: matchedFeatures,
      nearest_test: nearestTest?.file_path ?? null,
    };
  });
}
export function risks(db, limit = 3) {
  // Files with high fan-in. Skip noisy files and empty/root file_paths
  // (some aggregate rows slip through without a real path).
  const rows = q(db,
    `SELECT n.file_path AS file, count(e.from_id) AS fan
     FROM nodes n JOIN edges e ON e.to_id = n.id
     WHERE e.relation IN ('CALLS', 'REFERENCES')
       AND n.file_path IS NOT NULL
       AND n.file_path != ''
       AND n.file_path != '.'
     GROUP BY n.file_path
     ORDER BY fan DESC LIMIT $limit`, { limit: limit * 3 });
  return rows.filter(r => r.file && !isNoisyFile(r.file)).slice(0, limit)
    .map(r => ({ file: r.file, why: `${r.fan} inbound refs` }));
}
export function isNoisyFile(path) {
  return NOISE_FILE_PATTERNS.some(p => p.test(path));
}
export function isPathNoise(node) {
  if (!node) return false;
  // Empty/zero line is suspicious (tree-sitter assigning fallback)
  if (node.file && /:0$/.test(`${node.file}:${node.line}`)) {
    if (TYPE_NAME_PATTERNS.some((re) => re.test(node.symbol || ''))) return true;
  }
  if (TYPE_NAME_PATTERNS.some((re) => re.test(node.symbol || ''))) return true;
  if (VENDOR_PATH_PATTERNS.some((re) => re.test(node.file || ''))) return true;
  return false;
}
// Role inference from file path + symbol name. The point is to help agents
// pick the RIGHT hub for the task shape, not just the highest-fan one.
// On lc-api, brief-only Run 1 got misled because `Application` (an entity
// hub) was the top hub — the model anchored on it for "change request
// handling safely" even though entity hubs aren't the right surface for
// that question. Role hints let the agent disambiguate.
// Matches segments like `DomainRepository.php` where the role word is
// glued to other PascalCase words. Uses substring match, not word boundary.
export function classifyRole(label, file, type) {
  const f = String(file || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  const fileOrLabelHas = (needles) => needles.some(n => f.includes(n) || l.includes(n));
  if (fileOrLabelHas(['middleware', 'kernel'])) return 'middleware';
  if (fileOrLabelHas(['controller'])) return 'handler';
  if (fileOrLabelHas(['/route', 'router', '/routes/'])) return 'routing';
  if (fileOrLabelHas(['/entity/', '/entities/', '/models/', 'entity.', 'model.', 'record.'])
      || /entity$|model$|record$/.test(l)) return 'entity';
  if (fileOrLabelHas(['factory', 'builder', 'provider'])) return 'factory';
  if (fileOrLabelHas(['repository', 'repo.', 'dao'])) return 'repository';
  if (fileOrLabelHas(['/request', 'formrequest']) && type === 'Class') return 'request/validation';
  if (fileOrLabelHas(['/service', '/processor', '/command', '/job', '/task'])) return 'service';
  if (/render|format|serializ/.test(l)) return 'renderer';
  if (fileOrLabelHas(['/storage/', '/database/', '/db.', 'storage.', '/store/'])) return 'storage';
  if (fileOrLabelHas(['resolve', 'orchestr', 'freshness', 'pipeline', 'ingest'])) return 'pipeline';
  if (type === 'Class') return 'class';
  if (type === 'Method') return 'method';
  if (type === 'Function') return 'fn';
  return (type || 'symbol').toLowerCase();
}
export function globMatchesPath(glob, path) {
  if (glob === path) return true;
  const regex = glob
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*\*/g, '§§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§§/g, '.*');
  return new RegExp(`^${regex}$`).test(path);
}
