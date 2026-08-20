// DOCUMENT → SYMBOL REFERENCES. RULE 2 OF THE DOC-FOUNDATION REBUILD.
//
// ⛔ THIS DELETES THE LEGACY `mentions` EXTRACTOR RATHER THAN SITTING BESIDE IT. graph-senior-dev
// ruled: "remove every edge emitted by the legacy mentions extractor from the consumable graph and
// rebuild under a new extractor version." Measured on this repo at the moment of writing:
//
//     MENTIONS edges          2533
//     with a real source_line    0        (every one hardcoded to 0)
//     LINKS_TO (rule 1)        477
//
// Not one of those 2,533 edges could be checked against the document it came from. The admission
// rule was `\b[A-Za-z_]\w{3,}\b` equal to a symbol label, first-wins on duplicates — so a document
// containing the WORD "read" got an edge to the FUNCTION `read`.
//
// ⚠ WHY BOTH CANNOT RUN AT ONCE, which is the part that makes this a delete and not an addition:
// they would emit under the SAME relation name. A reader pulling MENTIONS edges would get
// evidence-backed references and word collisions in one list with no way to weigh either, and the
// weaker mechanism would inherit the stronger one's authority. That is the same objection that
// kept the legacy text clamp out of `packet-lists.js`.
//
// ★ RULE 2 IS TWO PIECES OF EVIDENCE. NEITHER ALONE IS ADMISSIBLE.
//
//     the author MARKED it as code   (an inline-code span)
//   + the span is QUALIFIED          (`::`, `.` or `->` joining identifiers)
//   + it resolves to EXACTLY ONE indexed symbol
//
// dev was explicit that backticks alone are not sufficient — an author marks all sorts of things
// as code, and `read` in monospace is still the English word. And a qualifier alone is not
// sufficient either: unmarked prose saying "we call Terrain::generate at startup" is describing
// rather than pointing, and admitting it re-opens the door the legacy rule left open. Requiring
// both is what makes the false-positive rate a property of the AUTHOR'S markup rather than of the
// repository's naming convention.
//
// ⛔ NO STOPWORD LIST AND NO GLOBAL THRESHOLD, per dev, and the reason is measured rather than
// stylistic: ef-manager ran the legacy extractor on `echoes_of_the_fallen` and got 63.1% English-
// word targets against 83.9% here, from identical code. The rate tracks the language's naming
// convention — JavaScript names functions `read` and `count` and collides with English head-on;
// C++ CamelCase mostly does not. Anything calibrated on one repo is wrong on the other by
// construction. A qualifier is not a threshold: it is a property of the span itself.
//
// ⚠ RECALL IS DELIBERATELY LOW AND THAT IS THE TRADE. A reference the author wrote as bare prose
// is not admitted, and I am not going to describe that as a limitation to fix later — rules 3 and
// 4 admit narrower contexts under their own evidence, and anything left over stays out. An edge
// this layer emits should be one a reader can open and verify in a second.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIndex, resolveDocPath, FILE_LEVEL_TYPES } from './doc-links.js';

// Every rule that can admit an edge here, with the confidence it carries. Frozen so a caller
// cannot widen the vocabulary at runtime — a reader must be able to enumerate what could have
// produced any edge they are looking at.
export const DOC_REF_RULES = Object.freeze({
  // A qualified reference inside an author-marked code span, resolving to exactly one symbol.
  'doc_ref:qualified': 0.9,
});

const EXTRACTOR_PREFIX = 'doc_ref:';

// ⛔ THE LEGACY TAG IS NAMED HERE SO THE DELETE IS AUDITABLE. An extractor owns its output and
// clears its own tag; this one additionally clears its PREDECESSOR's, because a retired rule's
// edges survive every subsequent run otherwise and no amount of tightening the admission rule
// removes them. dev: "INSERT OR IGNORE alone will preserve the poison forever."
export const RETIRED_EXTRACTORS = Object.freeze(['mentions']);

const INLINE_CODE = /`([^`\n]+)`/g;

// The longest dotted chain a lookup can use. `Ns::Type::method` is three; four leaves headroom
// for a namespace nobody has written yet. A reference longer than this resolves to nothing rather
// than to something approximate — the refusal is the point.
const MAX_CHAIN_SEGMENTS = 4;

// A trailing segment that is a known file-extension shape. This is deliberately a CLOSED LIST
// rather than "any short alphanumeric tail": `.generate`, `.build` and `.config` are all method
// names, and a general extension pattern would classify real symbol references as paths. The list
// is what the corpus actually contains — widening it is a reviewed event, not a silent tweak.
const HAS_FILE_EXTENSION =
  /\.(?:md|json|js|mjs|cjs|ts|tsx|jsx|py|cpp|hpp|cc|h|c|yaml|yml|toml|ini|log|txt|sh|sql|lock|env)$/i;

// An identifier chain joined by `::`, `.` or `->`, with at least one join. A trailing `()` is
// allowed and dropped — `Terrain::generate()` and `Terrain::generate` name the same thing.
//
// ⚠ NO `/` IS PERMITTED, so `src/io.cpp` cannot reach this rule at all. Paths belong to rule 1,
// and a span that produced edges under both relations would be double-counted by anyone adding
// the two layers together.
const QUALIFIED = /^([A-Za-z_$][\w$]*(?:(?:::|->|\.)[A-Za-z_$][\w$]*)+)(?:\(\s*\))?$/;

// Node types that carry a `qname` and can be the target of a symbol reference. Derived from the
// file-level registry rather than listed: anything the graph treats as a file-level node is rule
// 1's target, and everything else with a qname is a symbol. A list maintained by hand here would
// drift out of step with the taxonomy the moment either side gained a type.
const FILE_LEVEL = new Set(FILE_LEVEL_TYPES);

/**
 * Index every symbol by the dotted tail of its qname, at every suffix depth.
 *
 * Real qnames are fully path-qualified — `mcp.stdio.code-intel.lsp-client.LspClient.constructor` —
 * and nobody writes that in a document. They write `LspClient.constructor`. So the lookup is by
 * SUFFIX: the written chain must equal the last N segments of the qname.
 *
 * ⛔ EVERY SUFFIX IS INDEXED, INCLUDING AMBIGUOUS ONES. It would be cheaper to keep only unique
 * suffixes, but then a genuinely ambiguous reference would arrive here looking unresolvable and be
 * filed under `no_such_symbol` — a miss bucket claiming the symbol does not exist, about a symbol
 * that exists twice. The buckets have to stay disjoint and true, so ambiguity is recorded as
 * ambiguity and refused at resolution time.
 */
export function buildSymbolIndex(symbolNodes) {
  const bySuffix = new Map();
  for (const n of symbolNodes) {
    if (FILE_LEVEL.has(n.type)) continue;
    let qname;
    try { qname = JSON.parse(n.extra || '{}').qname; } catch { continue; }
    if (!qname) continue;
    const segments = String(qname).split('.').filter(Boolean);
    // ⚠ DEPTH IS CAPPED, AND THE CAP IS WHAT LETS THIS RUN UNGATED. Real qnames are fully
    // path-qualified — `mcp.stdio.code-intel.lsp-client.LspClient.constructor` is six segments —
    // so indexing every suffix is O(symbols × depth) and grows without bound on a large repo.
    // Nobody writes more than a handful of segments in a document, so suffixes deeper than this
    // could never be looked up: they are pure cost. Capping makes the index O(symbols) with a
    // small constant, which is what allows the legacy retirement below to run on every repo
    // rather than only on repos under the node-count gate.
    const deepest = Math.max(0, segments.length - MAX_CHAIN_SEGMENTS);
    // Only suffixes that are themselves qualified — a bare trailing segment is the legacy rule.
    for (let start = segments.length - 2; start >= deepest; start--) {
      const key = segments.slice(start).join('.');
      if (!bySuffix.has(key)) bySuffix.set(key, []);
      bySuffix.get(key).push(n.id);
    }
  }
  return bySuffix;
}

/** Normalise a written chain to the dotted form qnames use. */
export const normalizeChain = (written) => String(written).replace(/::|->/g, '.');

/**
 * Resolve one written chain to exactly one symbol id, or to a reason it could not be.
 *
 * ⛔ THE TIERS DO NOT VOTE AND AMBIGUITY DOES NOT FALL THROUGH. The legacy map took the first
 * candidate for a duplicate label. Picking one of two is not a resolution, it is a coin toss
 * recorded as evidence.
 */
export function resolveSymbolChain(written, symbolIndex) {
  const key = normalizeChain(written);
  const hits = symbolIndex.get(key);
  if (!hits || hits.length === 0) return { id: null, reason: 'no_such_symbol' };
  const unique = [...new Set(hits)];
  if (unique.length > 1) return { id: null, reason: 'ambiguous_symbol' };
  return { id: unique[0], reason: null };
}

/**
 * Every qualified reference an author marked as code, with its 1-based line.
 *
 * ⚠ FENCED BLOCKS ARE FOUND AND MARKED, NOT SKIPPED. Inside ``` a backtick pair is not an
 * inline-code span, so the marking evidence this rule depends on does not exist there. The
 * exclusion is right and stays — but it happens after counting, because a category that exists in
 * the code and not in the ledger is how a denominator goes wrong quietly.
 */
export function scanQualifiedReferences(content) {
  const found = [];
  let fenced = false;
  const lines = String(content).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    for (const m of line.matchAll(INLINE_CODE)) {
      const raw = m[1].trim();
      const q = QUALIFIED.exec(raw);
      found.push({
        written: q ? q[1] : raw,
        qualified: Boolean(q),
        line: i + 1,
        fenced,
      });
    }
  }
  return found;
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild every doc→symbol MENTIONS edge, and retire the legacy extractor's edges in the same
 * pass. Source is a Document; target is any non-file-level node carrying a qname.
 */
export async function detectDocRefs(db, repoRoot) {
  // ⛔ THE RETIREMENT IS UNCONDITIONAL AND HAPPENS FIRST. It does not depend on this run finding
  // anything: if the corpus is empty, or every document is unreadable, the legacy edges must
  // STILL be gone. Making the delete conditional on success would leave the poison in place in
  // exactly the runs where nothing else was there to notice it.
  for (const tag of RETIRED_EXTRACTORS) {
    db.run(`DELETE FROM edges WHERE relation = 'MENTIONS' AND extractor = '${tag}'`);
  }
  db.run(`DELETE FROM edges WHERE relation = 'MENTIONS' AND extractor LIKE '${EXTRACTOR_PREFIX}%'`);

  const docs = db.all("SELECT id, file_path FROM nodes WHERE type = 'Document'");
  const empty = {
    added: 0, documents: 0, documentsWithRefs: 0,
    unqualified: 0, noSuchSymbol: 0, pathNotIndexed: 0, ambiguousPath: 0, ambiguousSymbol: 0,
    isAPath: 0, fencedExample: 0, misses: [],
  };
  if (docs.length === 0) return empty;

  const symbolIndex = buildSymbolIndex(db.all(
    "SELECT id, type, extra FROM nodes WHERE extra LIKE '%\"qname\"%'"));
  const types = FILE_LEVEL_TYPES.map((t) => `'${t}'`).join(', ');
  const pathIndex = buildIndex(db.all(
    `SELECT id, type, file_path FROM nodes WHERE type IN (${types}) AND file_path != ''`));

  let added = 0;
  let documentsWithRefs = 0;

  // ⚠ COUNTERS ARE DERIVED FROM THIS LIST, NEVER INCREMENTED BESIDE IT. Two tallies maintained in
  // parallel can drift, and then a grader auditing a sample certifies a number those records do
  // not add up to — a receipt for a claim nobody made.
  const misses = [];

  for (const doc of docs) {
    let content;
    try {
      content = await readFile(join(repoRoot, doc.file_path), 'utf8');
    } catch {
      continue;                                     // unreadable document — nothing to claim
    }

    const seen = new Set();                         // one edge per (document, symbol) pair
    let emitted = 0;

    for (const ref of scanQualifiedReferences(content)) {
      const note = (bucket) => misses.push({
        document: doc.file_path, written: ref.written, line: ref.line, bucket,
      });

      if (ref.fenced) { note('fenced_example'); continue; }
      if (!ref.qualified) { note('unqualified'); continue; }

      // ⛔ RULE 1 GETS FIRST REFUSAL, so the two layers are disjoint BY CONSTRUCTION rather than
      // by the accident of their patterns not overlapping. `README.md` is a qualified-looking
      // chain and a real path; whichever rule claims it, only one may, or anyone adding the two
      // layers together double-counts the same authored span.
      if (resolveDocPath(ref.written, doc.file_path, pathIndex)) { note('is_a_path'); continue; }

      // ⛔ A PATH THAT IS NOT INDEXED IS NOT A MISSING SYMBOL, AND MERGING THEM MAKES THE BUCKET
      // LIE. The first run of this rule filed 404 chains under `no_such_symbol`, and the sample
      // was `install.claude.md`, `brief.plan.md`, `opencode.json`, `tasks.json`, `hook.log` —
      // real files, written as `Ident.Ident`, that the path guard above could not claim because
      // THEY ARE NOT IN THE GRAPH. Reporting those as absent symbols would be a claim about the
      // wrong noun entirely.
      //
      // ⚠ THIRD OCCURRENCE OF ONE SHAPE TONIGHT. `unresolved` hid path-shaped prose until it was
      // split into no_such_path / not_a_file_reference; the sweep's `not_a_known_kind` hid
      // declined source files until it was split; now this. A miss bucket named for the rule that
      // refused, rather than for the reason it refused, absorbs every cause the author did not
      // think of — and the count reads identically whichever cause it is.
      //
      // ★ AND THE SPLIT TURNS A LIE INTO A MEASUREMENT. `pathNotIndexed` counts authored
      // references to files the corpus never admitted, which is the doc corpus hole measured by
      // an instrument that was not built to measure it.
      if (HAS_FILE_EXTENSION.test(ref.written)) {
        // ⛔ FOURTH LYING BUCKET, INSIDE THE SPLIT BUILT TO STOP BUCKETS LYING.
        //
        // ef-manager graded the 228 and found 28 of them were bare basenames whose file IS
        // in the graph, at two or more paths: `server.js` is both mcp/stdio/server.js and
        // mcp/stdio/dashboard/server.js; likewise render.js, extract.js, schema.js. rule 1
        // correctly REFUSES an ambiguous basename rather than picking one — but its refusal
        // and its no-such-file are the same `null`, so the ambiguity had nowhere to go and
        // landed in a bucket that says the path is not indexed. That is false about the file
        // and false about the corpus.
        //
        // ⚠ This is my own diagnosis reproducing inside my own fix, twenty minutes after I
        // wrote it: "a miss bucket named for the rule that refused, rather than for the
        // reason it refused, absorbs every cause the author did not think of." A refusal and
        // an absence are not the same answer, and collapsing them is the two-state collapse
        // one more time — the fourth tonight, and the first where the mechanism I was
        // repairing recurred inside the repair.
        const base = String(ref.written).split('/').pop();
        const candidates = pathIndex.bySuffix.get(base);
        if (candidates && new Set(candidates).size > 1) { note('ambiguous_path'); continue; }
        // ⚠ WHAT SURVIVES HERE IS NOT "THE DOC CORPUS HOLE", AND THE HEADLINE NUMBER IS
        // WRONG BY 3.4x IF READ THAT WAY. ef-manager hand-graded all 230 pre-split:
        //
        //     99  (43%)  DELIBERATELY EXCLUDED — .aify-graph/brief.*.md, functionality.json,
        //                tasks.json, fixture graphs under tests/fixtures/. The graph's own
        //                output. A graph indexing its own briefs would be pathological, so
        //                these are the corpus working, not a hole in it.
        //     43  (19%)  no such file anywhere — references to ANOTHER repository, prose
        //                examples like `A.cpp`, and `mentions.js`, which was deleted tonight.
        //     28  (12%)  ambiguous — split out above.
        //     60  (26%)  the genuine hole: install.claude.md, install.codex.md,
        //                install.hermes.md, ATTRIBUTION.md, and files under reference/ —
        //                which is NOT denylisted (345 graph nodes carry a reference/ path),
        //                so those are an inconsistency rather than a design choice.
        //
        // Splitting the first two properly means asking the sweep whether it WOULD admit the
        // path, not re-deriving its rules here — a second copy of an admission policy is the
        // defect this file exists to fix. Left as one bucket with its composition stated, so
        // nobody reads 202 as 202 missing documents.
        note('path_not_indexed');
        continue;
      }

      const { id, reason } = resolveSymbolChain(ref.written, symbolIndex);
      if (!id) { note(reason); continue; }
      if (seen.has(id)) continue;
      seen.add(id);

      db.run(
        `INSERT OR IGNORE INTO edges
           (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
         VALUES ('${doc.id}', '${id}', 'MENTIONS', '${doc.file_path}', ${ref.line},
                 ${DOC_REF_RULES['doc_ref:qualified']}, 'INFERRED', 'doc_ref:qualified')`);
      added++;
      emitted++;
    }
    if (emitted > 0) documentsWithRefs++;
  }

  const tally = (bucket) => misses.filter((m) => m.bucket === bucket).length;
  return {
    added,
    documents: docs.length,
    documentsWithRefs,
    unqualified: tally('unqualified'),
    noSuchSymbol: tally('no_such_symbol'),
    pathNotIndexed: tally('path_not_indexed'),
    ambiguousPath: tally('ambiguous_path'),
    ambiguousSymbol: tally('ambiguous_symbol'),
    isAPath: tally('is_a_path'),
    fencedExample: tally('fenced_example'),
    misses,
  };
}
