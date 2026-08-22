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
import { edgeClass, ownedEdgesPredicate } from '../storage/edge-classes.js';

// Every rule that can admit an edge here, with the confidence it carries. Frozen so a caller
// cannot widen the vocabulary at runtime — a reader must be able to enumerate what could have
// produced any edge they are looking at.
export const DOC_REF_RULES = Object.freeze({
  // A qualified reference inside an author-marked code span, resolving to exactly one symbol.
  'doc_ref:qualified': 0.9,
  // ⛔ `doc_ref:shaped` WAS HERE AND IS GONE. 0.9311 on held-out data against a 0.95 floor; see the
  // deleted RULE 3 block below for the measurement and for why it could not be tuned. Named in this
  // table rather than silently absent, because a reader comparing the rule numbering in the docs to
  // this object should find out what happened to 3 instead of assuming a typo.
  // RULE 4. A bare symbol name sharing a LINE with a path that resolves to the file declaring it.
  //
  // ⭐ ITS SCOPE IS WRITTEN IN THE DOCUMENT BY THE AUTHOR, which is the same KIND of evidence rule
  // 2 has, and it is why this rule survived the held-out grading that killed rule 3. Rule 3's
  // evidence was uniqueness — a property of whatever this repository happens to contain. Rule 4's
  // is a path the author put on the line. It sits below `qualified` only because the name itself is
  // bare, so the association between path and word is co-occurrence rather than syntax.
  //
  // ⭐⭐ THE PROPERTY THAT ACTUALLY SEPARATED THE SURVIVORS, measured rather than argued: both
  // remaining rules require a STRUCTURAL ANCHOR ADJACENT TO THE TOKEN — a path in scope, or a
  // `Class.` prefix. ef-manager regraded all 125 surviving edges at full source text after
  // discovering their first pass had used ±85-character windows, and found 63 of them had been
  // truncated. ZERO verdicts moved. The anchor is adjacent by construction, so even a cut sentence
  // still carried the deciding evidence. Rule 3, whose only evidence was ambient prose, is exactly
  // what a window destroys — and exactly what admitted a Go keyword and another repo's symbol.
  // ⇒ REQUIRE THE EVIDENCE TO BE ADJACENT, NOT AMBIENT. That is the design rule for any successor.
  //
  // ⚠ THE ORDER IS LOAD-BEARING, NOT DECORATIVE. When more than one rule reaches the same symbol
  // in the same document, the STRONGEST tag wins — see `offer()`. Before this constant existed the
  // winner was whichever loop ran first, which is precedence by accident of control flow.
  'doc_ref:path-scoped': 0.85,
});

// ⛔ THE SHAPES ARE THE EVIDENCE, AND EACH ONE IS A CLAIM THE AUTHOR MADE ABOUT THE TOKEN.
//
// `read` in backticks is the English word in monospace. `read()` is someone writing a call. That
// difference is the whole rule: the parentheses, the CamelCase humps and the underscore are all
// marks a writer puts on a token to say "this is a program element", and none of them appear on
// prose by accident.
//
// ⚠ CamelCase requires TWO humps deliberately. `README` and `TODO` are screaming case, and a
// single-hump `Graph` is a perfectly ordinary English word with a capital.

// ⛔ THE BARE snake_case SHAPE WAS DELETED, AND THE EVIDENCE IS CROSS-REPO.
//
// It shipped alongside these two and never fired:
//
//     aify-project-graph (JavaScript)   1170 candidates -> 0 resolved
//     echoes_of_the_fallen (C++)         270 candidates -> 0 resolved
//
// I kept it at 0/1170 on the grounds that deleting a shape on one repository's evidence would be
// calibrating on that repository's NAMING CONVENTION — the error that made the legacy extractor
// score 83.9% here and 63.1% on echoes from identical code. So ef-manager ran the second repo,
// expecting (as I predicted on the record) that a C++ codebase would rescue it.
//
// ⚠ THE SECOND REPO DID NOT RESCUE IT. IT CONVICTED IT. Same zero, and the sample says why:
// `comms_send` x26, `comms_share` x12, `comms_dispatch` x10, `query_voxel` x8, `get_perf` x7.
// MCP TOOL NAMES AND CONFIG KEYS — snake_case by ECOSYSTEM convention, in both corpora,
// regardless of the host language. My prediction was refuted on its main axis.
//
// ★ AND THE STRUCTURAL REASON IS THAT INVOCATION ALREADY SUBSUMES THE CASE WORTH HAVING.
// A snake_case FUNCTION written the way people write functions is an invocation:
//
//     `render_frame()`  -> invocation, name render_frame     ✓ still admitted
//     `render_frame`    -> was the bare snake shape          ✗ no longer admitted
//
// So the bare shape only ever caught snake_case written WITHOUT parentheses, which is exactly the
// population with zero evidence for and a named failure mode against. dev's gate is explicit:
// "a rule below the floor is deleted, not rescued by ranking."
//
// ⚠ THIS COSTS RECALL AND I AM NAMING IT RATHER THAN BURYING IT: a Python or Rust document
// writing `parse_config` in prose, meaning the function, is now a miss. Recall is disclosed as a
// floor by design. What is not acceptable is emitting an edge to a FUNCTION because a document
// named a TOOL that shares its spelling — which is what this shape would do first on any repo
// where an MCP tool is implemented by a same-named function.

// ⛔ `shapeOf` WAS DELETED WITH RULE 3, ITS ONLY CALLER.
//
// Retiring the rule and keeping its apparatus would have left an exported, tested function that
// nothing calls — and a test suite exercising a museum piece, which reads as coverage of a
// capability the product no longer has. Retire the workaround with the defect.
//
// ⚠ The IDEA it encoded is not wrong: parentheses and CamelCase humps really are marks an author
// puts on a token to say "this is a program element". What the measurement showed is that the mark
// is evidence of INTENT TO NAME CODE and not evidence of WHICH code — which is why a successor
// needs a second, document-local source of identity, the way rule 4 uses a path.

const EXTRACTOR_PREFIX = 'doc_ref:';

// ⛔ THE LEGACY TAG IS NAMED HERE SO THE DELETE IS AUDITABLE. An extractor owns its output and
// clears its own tag; this one additionally clears its PREDECESSOR's, because a retired rule's
// edges survive every subsequent run otherwise and no amount of tightening the admission rule
// removes them. dev: "INSERT OR IGNORE alone will preserve the poison forever."
// ⇒ THE LEDGER OWNS THIS, NOT THIS FILE. Re-exported for callers that already import it from
// here; the value lives in `storage/edge-classes.js` beside the deletion rule that consumes it,
// because a retired label and the delete that retires it are one fact in two places otherwise.
export const RETIRED_EXTRACTORS = Object.freeze(edgeClass('doc_ref').retiredExtractors);

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
 * The qualified name a node carries, or null.
 *
 * ⛔ ONE IMPLEMENTATION, BECAUSE THE SECOND ONE WAS ALREADY WRITTEN BEFORE ANYONE NOTICED.
 * `buildSymbolIndex` below has parsed `extra.qname` since it was written. When the frozen-sample
 * script needed the same value I wrote a fresh copy in `scripts/doc-ref-sample.mjs` rather than
 * asking whether the repo already knew how to do this — the exact question that found the
 * containment bug in 1c05bde, unasked again. Two copies of a parse are two places for `qname`'s
 * shape to be assumed differently.
 *
 * ⚠ Returns null for a missing, empty or UNPARSEABLE `extra`. Never the node's bare label: that
 * fallback would hand back the same unusable string a qname exists to disambiguate, in a field
 * whose name promises a qualifier. A blank is honest; a wrong answer under a trusted label is not.
 *
 * @param {string|null|undefined} extra  a node's `extra` column, JSON or not
 * @returns {string|null}
 */
export function qnameOf(extra) {
  try {
    const q = JSON.parse(extra || '{}').qname;
    return q ? String(q) : null;
  } catch {
    return null;
  }
}

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
    const qname = qnameOf(n.extra);
    if (!qname) continue;
    const segments = qname.split('.').filter(Boolean);
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

// A Markdown link target, so rule 4 sees `[the client](mcp/stdio/code-intel/lsp-client.js)` as a
// path the same way rule 1 does. Without it, a scoping path written as a link is invisible here.
const MD_LINK_TARGET = /\[[^\]\n]*\]\(\s*([^()\s]+?)(?:\s+["'][^"']*["'])?\s*\)/g;

// Words that introduce a declaration rather than naming one. A span headed by any of these is
// still naming the identifier that follows — `export function autoReindexEnabled(env)` names
// `autoReindexEnabled`. Kept deliberately short and syntactic: these are keywords in the languages
// this repo indexes, not a list of words that seemed unimportant.
const DECLARATION_KEYWORDS = new Set([
  'export', 'default', 'function', 'const', 'let', 'var', 'async', 'await',
  'class', 'struct', 'enum', 'interface', 'type', 'def', 'fn', 'public', 'private',
  'protected', 'static', 'inline', 'template', 'typename', 'namespace', 'return',
]);

/**
 * Is `index` the position of the token this code span NAMES?
 *
 * A span names one thing and the thing is at its head, skipping declaration keywords. Returns
 * false when there is no span, so a caller cannot get a true answer from a missing one.
 */
export function isSpanHead(line, span, index) {
  if (!span) return false;
  const text = String(line).slice(span.start, span.end);
  for (const m of text.matchAll(BARE_WORD)) {
    if (DECLARATION_KEYWORDS.has(m[0])) continue;
    return span.start + m.index === index;
  }
  return false;
}

// Bare identifier tokens. Deliberately permissive — the file scope, not the token shape, is what
// makes this rule safe, which is the entire difference between rule 4 and rule 3.
const BARE_WORD = /[A-Za-z_$][\w$]*/g;

/** label -> [ids] for the symbols declared in each file. */
export function buildSymbolsByFile(symbolNodes) {
  const byFile = new Map();
  for (const n of symbolNodes) {
    if (FILE_LEVEL.has(n.type) || n.type === 'External' || n.type === 'Module') continue;
    if (!n.file_path || !n.label) continue;
    if (!byFile.has(n.file_path)) byFile.set(n.file_path, new Map());
    const m = byFile.get(n.file_path);
    if (!m.has(n.label)) m.set(n.label, []);
    m.get(n.label).push(n.id);
  }
  return byFile;
}

/**
 * Every bare symbol name that shares a LINE with a path resolving to the file that declares it.
 *
 * ⛔ AMBIGUITY IS REFUSED WITHIN THE SCOPE, NOT ACROSS THE GRAPH. Two symbols named `build` in the
 * same scoped file is a genuine ambiguity and emits nothing. Two symbols named `build` in
 * DIFFERENT files is not ambiguous here at all — that is precisely what the path resolved.
 */
export function scanPathScopedReferences(content, docPath, pathIndex, symbolsByFile) {
  const out = [];
  const lines = String(content).split(/\r?\n/);
  const pathOf = new Map();
  for (const [p, v] of pathIndex.byPath) pathOf.set(v.id, p);

  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;

    // Spans that scope, and the exact character ranges they occupy — the ranges matter, see below.
    const written = [];
    for (const m of line.matchAll(MD_LINK_TARGET)) {
      written.push({ text: m[1], start: m.index, end: m.index + m[0].length });
    }
    const codeSpans = [];
    for (const m of line.matchAll(INLINE_CODE)) {
      codeSpans.push({ start: m.index, end: m.index + m[0].length });
      written.push({ text: m[1].trim(), start: m.index, end: m.index + m[0].length });
    }

    // ⚠ ONLY FILES THAT DECLARE SYMBOLS SCOPE ANYTHING. A line naming `docs/design.md` scopes
    // nothing, and letting it through would make every word on that line a candidate against an
    // empty map — harmless, but it would inflate the denominator with lines that never had a chance.
    const scopes = new Set();
    const scopingRanges = [];
    for (const w of written) {
      // resolveDocPath now reports its TIER as well as its id, because a bare-basename match and
      // an exact-path match are different claims. Rule 4 accepts both: the scope only has to name
      // a real file, and a wrong scope produces no edge rather than a wrong one — the bare word
      // simply will not be declared in it.
      const hit = resolveDocPath(w.text, docPath, pathIndex);
      const p = hit ? pathOf.get(hit.id) : null;
      if (p && symbolsByFile.has(p)) { scopes.add(p); scopingRanges.push(w); }
    }
    if (scopes.size === 0) continue;

    const inside = (idx, ranges) => ranges.some((r) => idx >= r.start && idx < r.end);

    for (const wm of line.matchAll(BARE_WORD)) {
      // ⛔ A WORD INSIDE THE SCOPING PATH IS NOT A REFERENCE TO A SYMBOL. `- \`tests/unit/query/
      // pull-code-intel.test.js\`` produced an edge to a function named `pull`, because the
      // bare-word scanner matched a fragment of the very path that did the scoping. The rule was
      // reading its own input as evidence — a self-reference, and the target was a real function,
      // so nothing about the edge looked wrong.
      if (inside(wm.index, scopingRanges)) continue;

      // ⛔ THE WORD MUST BE AUTHOR-MARKED, AND ADDING THIS AFTER A FAILING GRADE IS DISCLOSED.
      //
      // I graded all 45 edges of the first version and counted 4 false positives — 0.911, BELOW
      // dev's 0.95 floor. Three were the same mechanism: an ENGLISH word on a line that also
      // carried a path.
      //
      //     "`bin/apg.js` — main CLI entry"          -> the function `main`
      //     "90 diagnostics dominated by the cascade" -> the method `diagnostics`
      //     "`npm rebuild better-sqlite3`"            -> a function `rebuild`
      //
      // ⚠ CHANGING A RULE AFTER SEEING IT FAIL IS HOW A FLOOR GETS TUNED INTO MEANINGLESSNESS, so
      // the justification has to stand WITHOUT the score. It does: rules 2 and 3 BOTH require the
      // author to have marked the token as code, and rule 4 requiring marking-plus-scope is the
      // consistent design. The version I graded was the inconsistent one — it was the only rule
      // admitting unmarked prose, which is the exact door the legacy extractor left open.
      //
      // ⇒ The floor did not tell me what to change. It told me to look, and looking found an
      // inconsistency I should have seen when writing it.
      if (!inside(wm.index, codeSpans)) continue;

      // ⛔ THE TOKEN MUST BE WHAT ITS SPAN NAMES, NOT MERELY A WORD INSIDE IT.
      //
      // `` `npm rebuild better-sqlite3` `` is a marked span holding a SHELL COMMAND, and it
      // produced an edge to a function called `rebuild` — the surviving false positive from the
      // first grade. A code span names ONE thing, and the thing is at its head.
      //
      // ⚠ NAIVE HEAD-POSITION DROPS A TRUE POSITIVE, and ef-manager measured it before I applied
      // the version I had proposed:
      //
      //     `npm rebuild better-sqlite3`               head `npm`      -> the FP, correctly dropped
      //     `export function autoReindexEnabled(env)`  head `export`   -> A REAL REFERENCE, dropped
      //
      // "A module-level helper keeps it testable: `export function autoReindexEnabled(env)` in a
      // small `mcp/stdio/freshness/auto-reindex.js`" is as clear a reference as this corpus holds,
      // and the head of its span is a keyword. So the head is the first identifier that is not a
      // DECLARATION KEYWORD — which still kills `npm rebuild …`, because `npm` is an ordinary
      // identifier sitting in head position.
      //
      // ⛔ THIS IS THE THIRD CHANGE TO RULE 4 AFTER GRADING IT, AND THE PRECISION FIGURE IS
      // THEREFORE NO LONGER INDEPENDENT. 32/33 = 0.970 at 420147b was measured by two graders on
      // code neither of them had tuned. Whatever this scores on the same corpus is a fit to data
      // that shaped it. The honest claim is narrower: the ONE known false-positive mechanism is
      // closed, and precision must be re-measured somewhere this corpus did not reach.
      const span = codeSpans.find((r) => wm.index >= r.start && wm.index < r.end);
      if (!isSpanHead(line, span, wm.index)) continue;

      const owners = [];
      for (const scope of scopes) {
        const ids = symbolsByFile.get(scope)?.get(wm[0]);
        if (ids) owners.push(...ids);
      }
      const uniq = [...new Set(owners)];
      if (uniq.length === 1) out.push({ id: uniq[0], word: wm[0], line: i + 1 });
    }
  }
  return out;
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
  // ⇒ ONE PREDICATE, FROM THE LEDGER, COVERING BOTH THE LIVE PREFIX AND THE RETIRED LABELS. This
  // was three statements restating the same ownership rule in two shapes. A deletion rule written
  // twice differs in one of the two places eventually — which is how the record prune and the edge
  // invalidation drifted 600 lines apart and cost 62,066 records on 2026-08-20.
  const owned = ownedEdgesPredicate('doc_ref');
  db.run(`DELETE FROM edges WHERE ${owned.sql}`, owned.params);

  const docs = db.all("SELECT id, file_path FROM nodes WHERE type = 'Document'");
  const empty = {
    added: 0, documents: 0, documentsWithRefs: 0,
    unqualified: 0, basenameOnly: 0,
    noSuchSymbol: 0, pathNotIndexed: 0, ambiguousPath: 0, ambiguousSymbol: 0,
    isAPath: 0, fencedExample: 0, misses: [],
  };
  if (docs.length === 0) return empty;

  // ⛔ HISTORY, NOT MECHANISM. THE BARE-LABEL RESOLUTION INDEX AND THE CLAIMANT COUNT ARE GONE.
  //
  // `resolutionIndex` and `nameOwners` answered "which single symbol owns this bare name, and does
  // anything else claim it" — the two questions rule 3 asked, and the only two. They went with it.
  // Both were still being BUILT on every run after the rule was deleted, walking every labelled
  // node in the graph to fill structures nothing read.
  //
  // ⚠ AND THIS PARAGRAPH USED TO ARGUE FOR THEM IN THE PRESENT TENSE, with the tombstone appended
  // underneath. ef-manager caught it reviewing c8dcb2e: a reader met the case for a mechanism and
  // then a line saying the mechanism was removed. That is a description outliving its behaviour —
  // the third instance this week — and it appeared INSIDE the commit that did the deleting, which
  // is the moment the author is least able to see it. The order is the fix: what is true now
  // first, what it replaced second.
  //
  // ── WHY IT WORKED THE WAY IT DID, kept because the incident is real and the distinction is ────
  //
  // "UNIQUE" AND "UNIQUE AMONG WHAT" ARE DIFFERENT QUESTIONS. The two maps were once ONE index, and
  // the External/Module filter ran BEFORE the uniqueness test — so `hits.length > 1` meant "more
  // than one non-External, non-Module, non-file-level node" while READING as "more than one node in
  // the graph". A population statement hiding inside a boolean.
  //
  // ef-manager found it as two false positives on echoes_of_the_fallen. `vec3` had two nodes:
  //
  //     Class      engine/voxel/SimplexNoise.h:46   a PRIVATE NESTED STRUCT in a noise class
  //     External   (no file)                        the glm/GLSL type the author actually meant
  //
  // The External candidate was filtered out before the ambiguity test ran, so a name with two
  // owners passed as unique and both documents got an edge to a private struct nobody was talking
  // about.
  //
  // ⇒ THE DISTINCTION IS WORTH REMEMBERING EVEN THOUGH THE CODE IS GONE: an index of what an edge
  // may POINT AT is not the same as a count of what CLAIMS a name. Filtering External stubs is
  // right for resolution — an edge must not point at a node with no file and no span — and wrong
  // for ambiguity, because an External node carrying your label is precisely the evidence that the
  // name is not yours alone. Same index, opposite needs.
  //
  // ⚠ Its resolution was ALSO the shape the held-out grading later killed: uniqueness among
  // whatever this repository happens to contain, standing in for evidence the author supplied.
  // Getting the population right made rule 3 less wrong. It could not make it right.
  const symbolsByFile = buildSymbolsByFile(db.all(
    "SELECT id, type, label, file_path FROM nodes WHERE label != '' AND file_path != ''"));

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

    // ⛔ CANDIDATES ARE COLLECTED, THEN THE STRONGEST RULE WINS. This was two inline INSERTs, so
    // whichever rule's loop reached a symbol first got the tag — precedence as an artifact of
    // control flow rather than a decision. With three rules of different evidential strength
    // pointing at the same symbol that is not survivable: the tag is the ONLY thing telling a
    // reader how much to trust the edge, and "whichever ran first" is not a reason.
    //
    // Keyed by symbol id, one edge per (document, symbol), strongest rule retained.
    const candidates = new Map();
    const offer = (symbolId, rule, line) => {
      const held = candidates.get(symbolId);
      if (held && DOC_REF_RULES[held.rule] >= DOC_REF_RULES[rule]) return;
      candidates.set(symbolId, { rule, line });
    };

    for (const ref of scanQualifiedReferences(content)) {
      const note = (bucket) => misses.push({
        document: doc.file_path, written: ref.written, line: ref.line, bucket,
      });

      if (ref.fenced) { note('fenced_example'); continue; }

      // ── RULE 3 — DELETED 2026-08-22, MEASURED AT 0.9311 ON HELD-OUT DATA ─────────────────────
      //
      // It admitted an unqualified span whose SHAPE looked like a program element — `render()`,
      // `LspClient` — when the bare label resolved to exactly one symbol. Uniqueness in the graph
      // stood in for the qualifier rule 2 demands.
      //
      // ⛔ 311 CORRECT, 23 WRONG, 3 UNSURE = 0.9311, against a floor of 0.95 per rule. Graded blind
      // by ef-manager on three corpora that had never been indexed — graphify b14b52e9,
      // agent-understand-anything 32944829, codegraph c6aaa203 — because the previous 0.972 was
      // measured on the corpus the rule had been tuned against three times.
      // dev's ruling: a rule below the floor is DELETED. Not demoted, not ranked, not rescued.
      //
      // ⛔⛔ AND IT IS NOT TUNABLE, WHICH IS THE PART WORTH KEEPING. The rule already refused 1,309
      // of its own candidates (997 no-symbol, 312 ambiguous) and still admitted 23 wrong. Its whole
      // evidence is "this name resolves here, uniquely" — and a Go `init()`, a Swift
      // `init(name:age:)`, an R `source()`, an author's declared `trace(a,b)` NOTATION, and another
      // repository's `forward()` all satisfy that perfectly. ef-manager's sentence, which belongs
      // here verbatim: EXISTENCE AND UNIQUENESS IN THE INDEX ARE NOT EVIDENCE OF REFERENCE.
      //
      // ⚠ 19 of the 23 errors were in ONE corpus — codegraph, whose docs discuss many languages and
      // many analysed repositories. The rule is not uniformly imprecise; it degrades in
      // documentation that talks about code OTHER THAN ITS OWN, which is exactly what a tool aimed
      // at other people's repositories will meet. Any successor must be designed against that.
      //
      // ⚠ AND THE 0.9311 IS AN UPPER BOUND, not a point estimate. The grader disclosed afterwards
      // that all 462 rows were read through a ±85-character window while the artifact carried the
      // full line — 33% of rows were longer than that. A truncated sentence looks MORE like a
      // citation than it is, so the bias runs toward CORRECT. True precision is at most 0.9311,
      // which only makes the deletion safer.
      //
      // ⇒ An unqualified span now emits nothing here. It can still reach rule 4 below, where the
      // author supplies a PATH in the same line — evidence that lives in the document and travels
      // with it, rather than in whatever this repository happens to contain.
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
        // ⚠ NOT `candidates` — that name now belongs to the per-document edge map above, and
        // shadowing it here would have silently discarded every collected edge for this document.
        const pathCandidates = pathIndex.bySuffix.get(base);
        if (pathCandidates && new Set(pathCandidates).size > 1) { note('ambiguous_path'); continue; }
        // ⛔ FIFTH INSTANCE OF THE LYING BUCKET, AND THIS TIME I CAUSED IT.
        //
        // Deleting rule 1's tier 2 means a bare basename no longer resolves at all. So
        // `mcp/stdio/server.js` written as `` `server.js` `` — indexed, unambiguous, findable —
        // started landing in `path_not_indexed`, which is FALSE about the file and false about the
        // corpus. Removing a resolution path silently re-pointed a miss bucket at a population it
        // was never about.
        //
        // ⚠ A test caught it within seconds, and only because that test asserts the POSITIVE case:
        // "a basename indexed EXACTLY ONCE is claimed by rule 1, not bucketed at all". Without the
        // positive control the deletion would have looked clean and quietly inflated the corpus
        // hole by every bare filename in the corpus.
        if (pathCandidates && pathCandidates.length > 0) { note('basename_only'); continue; }
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
        //     11  ( 5%)  gitignored (reference/) — also the corpus working
        //     49  (24%)  genuine, and it is EIGHT DISTINCT FILES, not 49 problems:
        //                the six install.*.md, ATTRIBUTION.md, and SKILL.md
        //
        // ⚠ AN EARLIER VERSION OF THIS COMMENT SAID reference/ WAS NOT DENYLISTED, on the
        // strength of 345 graph nodes carrying that path. ef-manager retracted it: 342 of
        // those are Directory nodes and ZERO are Files, so the tree was walked and nothing
        // was extracted. `.gitignore:12` excludes it. A real number attached to an invented
        // noun — kept here because the corrected figure is a quarter of the headline.
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
      offer(id, 'doc_ref:qualified', ref.line);
    }

    // ── RULE 4 — THE PATH IS THE QUALIFIER ────────────────────────────────────────────────────
    //
    // Rules 2 and 3 both need the TOKEN to carry a SHAPE: a `::`, or parentheses, or CamelCase
    // humps. Rule 4 needs no shape, because the author wrote the FILE alongside the name and a file
    // scope disambiguates better than any shape can.
    //
    //     "`export function autoReindexEnabled(env)` in a small `mcp/stdio/freshness/auto-reindex.js`"
    //
    // `autoReindexEnabled` has no parentheses of its own and no second CamelCase hump in the place
    // rule 3 looks; scoped to the file that declares it, it is unambiguous. That is the population
    // rule 4 actually serves: MARKED BUT UNSHAPED identifiers beside a path — `buildEmbeddings`,
    // `inspectReadFreshness`, `aifyBlock`.
    //
    // ⛔ THIS PARAGRAPH USED TO DESCRIBE A DIFFERENT RULE, AND THE CORRECTION IS THE POINT.
    //
    // It argued the rule with `diagnostics`, `references` and `hover` — ordinary English words
    // beside `lsp-client.js` — as references only a scope could reach. Then the first grade failed
    // at 0.911 and I added a requirement that the token be inside an author-marked code span,
    // which excludes exactly those bare words. ef-manager measured the result: `hover` 0 edges,
    // `diagnostics` 0 edges, `references` 1 edge justified by a MARKED occurrence elsewhere on its
    // line. The flagship example in this comment produced one edge of three, and that one did not
    // need the rule as argued.
    //
    // ⚠ SO THE COMMENT SURVIVED THE RULE IT DESCRIBED. It read as verified, described a capability
    // the code no longer had, and nothing could catch it but checking the prose against the yield —
    // the same class as a dead assertion, one layer up. I also claimed in commit 8280567's body
    // that this was already fixed. It was not; that sentence was false when written, and this
    // commit is the correction rather than a silent tidy-up.
    //
    // ⚠ THE SPAN IS ONE LINE, WHICH IS NARROWER THAN dev SPECIFIED. dev allowed "link, sentence,
    // list item, fenced example" and was explicit that WHOLE-DOCUMENT co-occurrence is too weak.
    // A line is checkable, gives an honest `source_line`, and covers list items and most sentences.
    // Sentences wrapped across lines are a disclosed recall miss, not an oversight.
    //
    // ⚠ AND MY EVIDENCE THAT "A LINE IS A PARAGRAPH" IS RETRACTED. I cited a graded edge with ~855
    // characters between the scoping path and the word. ef-manager found that figure was measured
    // with `indexOf`, which returns the FIRST occurrence of a token — and the edge in question had
    // two, bare prose at column 1298 and a marked span at 1724. Every scope-distance number for a
    // repeated token was measured against the wrong occurrence. The concern may still be real; the
    // measurement is not, so the number is gone rather than quietly kept.
    //
    // ⚠ FENCES STAY EXCLUDED even though dev listed them, and that is a DEFERRAL rather than a
    // ruling: the exclusion is measured load-bearing elsewhere (0 of 480 rule-1 edges came from
    // inside a fence, and every hand-graded recall miss was inside one). Admitting them here needs
    // its own measurement, and I would rather owe recall than spend precision I cannot yet grade.
    for (const scoped of scanPathScopedReferences(content, doc.file_path, pathIndex, symbolsByFile)) {
      offer(scoped.id, 'doc_ref:path-scoped', scoped.line);
    }

    for (const [symbolId, { rule, line }] of candidates) {
      db.run(
        `INSERT OR IGNORE INTO edges
           (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
         VALUES ('${doc.id}', '${symbolId}', 'MENTIONS', '${doc.file_path}', ${line},
                 ${DOC_REF_RULES[rule]}, 'INFERRED', '${rule}')`);
      added++;
    }
    if (candidates.size > 0) documentsWithRefs++;
  }

  const tally = (bucket) => misses.filter((m) => m.bucket === bucket).length;
  return {
    added,
    documents: docs.length,
    documentsWithRefs,
    unqualified: tally('unqualified'),
    // ⛔ `shapedNoSymbol` and `shapedAmbiguous` were REMOVED, not zeroed. Nothing notes those
    // buckets since rule 3 was deleted, so they would have reported 0 for ever — and a standing
    // zero in a telemetry block reads as a measured absence of refusals rather than the absence
    // of the rule that produced them. A field that cannot vary is not telemetry.
    noSuchSymbol: tally('no_such_symbol'),
    pathNotIndexed: tally('path_not_indexed'),
    basenameOnly: tally('basename_only'),
    ambiguousPath: tally('ambiguous_path'),
    ambiguousSymbol: tally('ambiguous_symbol'),
    isAPath: tally('is_a_path'),
    fencedExample: tally('fenced_example'),
    misses,
  };
}
