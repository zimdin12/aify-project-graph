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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { buildReceipt, receiptFor, currentPins, hashOverlayContent, hashWorktreeDirty } from '../receipt.js';

// Pin sources. Each returns null rather than a guess when unavailable — an
// unpinned input that LOOKS pinned converts a known gap into an invisible one,
// which is strictly worse than the gap.
function pinRepoCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim() || null;
  } catch { return null; }
}

function pinManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
  } catch { return null; }
}

// Identity, not age — see receipt.js: an age is a clock reading and cannot serve
// as an invalidation condition.
function pinOverlayHash(repoRoot) {
  return hashOverlayContent(readFileSync, ['functionality.json', 'tasks.json'].map((f) => join(repoRoot, '.aify-graph', f)));
}

// Tracked modifications only. Untracked snapshot noise would drift this pin
// constantly for reasons that cannot change an answer.
function pinWorktreeDirty(repoRoot) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    return hashWorktreeDirty(out.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean));
  } catch { return null; }
}

function pinOverlayAge(repoRoot) {
  let newest = null;
  for (const f of ['functionality.json', 'tasks.json']) {
    const p = join(repoRoot, '.aify-graph', f);
    if (!existsSync(p)) continue;
    try {
      const days = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);
      if (newest == null || days < newest) newest = days;
    } catch { /* unreadable — null beats a guess */ }
  }
  return newest;
}
import { loadFunctionality, featuresForFile } from '../../overlay/loader.js';
import { assessOverlayBuild, loadTasksArtifact, overlayNotBuiltHint, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs } from '../../overlay/quality.js';
import { attachReadWarnings, inspectReadFreshness } from './read_freshness.js';
import { getCodeIntelEvidenceForSymbol } from '../../code-intel/query.js';
import { CALL_FAMILY, DOC_FAMILY, FILE_LEVEL_TYPES } from '../../storage/taxonomy.js';

// Registry-composed, like PULL_TOUCH_SQL_LIST. Spelling these out here would be the third copy
// of a list whose first two copies disagreed.
const FILE_LEVEL_SQL_LIST = FILE_LEVEL_TYPES.map((t) => `'${t}'`).join(', ');

// "Who touches this symbol" set for pull's relation rollups: the call family
// plus type-use. Composed from the registry rather than re-declared (review R2).
// USES_TYPE is appended (a type reference is still a touch worth surfacing in a
// cross-layer pull) but this stays narrower than IMPACT_FAMILY (no TESTS /
// OVERRIDDEN_BY) — pull.relations is a compact DIRECT-neighbor view.
const PULL_TOUCH_RELATIONS = [...CALL_FAMILY, 'USES_TYPE'];
const PULL_TOUCH_SQL_LIST = PULL_TOUCH_RELATIONS.map((r) => `'${r}'`).join(', ');

// ⛔ THE DOCS LAYER ANSWERED FROM ONE RELATION AND CLAIMED TO ANSWER THE QUESTION.
// It hardcoded `MENTIONS`. When `LINKS_TO` was added the layer kept querying the old set, so a
// file with 12 inbound authored doc links returned `items: []` — and the receipt stamped
// `exhaustive: true` on that empty set, because nothing could distinguish "the list was cut
// short" from "a source was never consulted".
// ⇒ Derived from the registry, like the touch list above. Adding a doc relation to the taxonomy
// now reaches this query without anyone remembering to come here.
const PULL_DOC_SQL_LIST = DOC_FAMILY.map((r) => `'${r}'`).join(', ');

// How many documents point at this file, regardless of whether the caller asked for them.
// Cheap (indexed on relation), and it is the number that makes the disclosure below possible.
/**
 * ⛔ "N DOCUMENT(S) REFERENCE THIS FILE" WAS TWO DEFECTS IN ONE SENTENCE.
 *
 * DEFECT 1 — THE NOUN. `MENTIONS` is Document→SYMBOL; `LINKS_TO` is Document→FILE. Both are in
 * `DOC_FAMILY` and both join on `s.file_path`, so the count mixed them and then attached the
 * result to the noun "this file". ef-manager proved it on `dedup-records.js`: one document,
 * `CHANGELOG.md`, which never names that file — it names the SYMBOL `dedupCollectionRecords`.
 * The edge is real; the noun was invented.
 *
 * Measured blast radius over the 350 files carrying at least one doc edge (their query, FLOOR
 * quality — it re-implements the shape of ours, cross-checked exact on two files against this
 * verb's own output):
 *
 *     83 (24%)  sentence 100% WRONG — zero LINKS_TO, every counted reference is a symbol mention
 *    101 (29%)  sentence PARTLY wrong — both kinds present
 *    166 (47%)  sentence CORRECT — LINKS_TO only
 *
 * ⚠ AND THE OBVIOUS FIX HAS AN OVERLAP DEFECT, which ef-manager caught in the gap between my
 * describing it and my writing it. The two sets are NOT disjoint — a document can link to a file
 * AND mention a symbol in it. `scripts/refactor-oracle.mjs`: total 53, linking 1, mentioning 53.
 * A two-bucket split renders 1 + 53 = 54 against a total of 53, and it would look MORE
 * authoritative than the sentence it replaced because it now carries structure.
 *
 * ⇒ THREE buckets, and the parts reconcile to the total by construction. The invariant is
 * asserted in the test because it is exactly the property that failed.
 *
 * DEFECT 2 — THE DENOMINATOR. The old count was `COUNT(DISTINCT d.id)` (DOCUMENTS) while the docs
 * layer returns DISTINCT edge rows (REFERENCES), and both surfaced as `total`. Measured:
 * `packet.js` disclosed 13 and the layer returned 18; `importer.js` 41 against 44. An agent told
 * "13 document(s)", who then passes `layers:["docs"]` EXACTLY AS THE SENTENCE INSTRUCTS, is
 * handed 18 under a field also called `total`. The instruction led the reader into the
 * contradiction. Both numbers are now reported, named for what they count.
 */
function docReferenceBreakdown(db, filePath) {
  const empty = { documents: 0, references: 0, linkOnly: 0, mentionOnly: 0, both: 0 };
  try {
    // One row per DOCUMENT, carrying which kinds of edge it has and how many rows it contributes.
    // Classifying per document is what makes the three buckets disjoint — the overlap defect comes
    // from counting the two relations separately and adding them.
    // ⚠ THE PROJECTION MATCHES THE DOCS LAYER'S, EXACTLY, and that is the whole point of this
    // helper. There turned out to be THREE candidate denominators here, not two:
    //   · DOCUMENTS                              — what the old sentence counted
    //   · EDGE ROWS                              — what I assumed the layer counted
    //   · DISTINCT (document, relation, line)    — what the layer ACTUALLY returns, because its
    //                                              SELECT DISTINCT omits the target symbol
    // So two mentions of DIFFERENT symbols on the same line collapse to one row in the layer. A
    // disclosure counting edge rows would promise 3 and the layer would hand back 2 — the same
    // contradiction as before, one denominator over.
    // ⇒ Count what the reader will be given. The inner DISTINCT mirrors the layer's projection.
    const rows = db.all(
      `SELECT doc,
              SUM(CASE WHEN relation = 'LINKS_TO' THEN 1 ELSE 0 END) AS links,
              SUM(CASE WHEN relation = 'MENTIONS' THEN 1 ELSE 0 END) AS mentions,
              COUNT(*) AS refs
         FROM (SELECT DISTINCT d.id AS doc, d.label, d.file_path, e.relation, e.source_line
                 FROM edges e
                 JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
                 JOIN nodes s ON s.id = e.to_id AND s.file_path = $p
                WHERE e.relation IN (${PULL_DOC_SQL_LIST}))
        GROUP BY doc`, { p: filePath });
    const out = { ...empty, documents: rows.length };
    for (const r of rows) {
      out.references += Number(r.refs) || 0;
      const hasLink = Number(r.links) > 0;
      const hasMention = Number(r.mentions) > 0;
      if (hasLink && hasMention) out.both += 1;
      else if (hasLink) out.linkOnly += 1;
      else out.mentionOnly += 1;
    }
    return out;
  } catch { return empty; }
}

/**
 * The sentence. Says only what the buckets support: a document that merely mentions a symbol has
 * NOT referenced the file, and saying so was the original defect.
 */
// Exported under a test-only name so the sentence can be exercised over EVERY count combination
// rather than through a repo fixture per case — the property test needs the generator, not a graph.
export const docsNotShownSentenceForTest = (b) => docsNotShownSentence(b);

function docsNotShownSentence(b) {
  // ⚠ EVERY NUMBER HERE COUNTS DOCUMENTS, AND THE SENTENCE SAYS SO EXPLICITLY. ef-manager
  // measured FOUR distinct denominators available on one file (packet.js: 13 documents, 20 raw
  // edge rows, 18 layer rows, 4 target symbols) and warned that a reader seeing "mention a symbol
  // defined in it" will most likely read the number beside it as HOW MANY SYMBOLS. On packet.js
  // that reading is 4, not 18.
  //
  // ⇒ Chosen deliberately, not by default: the buckets count DOCUMENTS, because that is the only
  // scope on which the three parts can reconcile to the whole — a document is what can be
  // link-only, mention-only, or both. The word "documents" leads the clause so the parts inherit
  // it, and the target-symbol count is NOT printed: it answers a different question, and a
  // sentence carrying four numbers teaches the reader to skip all four.
  // ⚠ SUBJECT-VERB AT n=1. "1 do both" / "1 only mention" read as machine output, and they surface
  // on the SMALLEST cases — which are exactly the ones a reader meets when the answer is simplest
  // and easiest to check by hand. A sentence built so its structure can be trusted should not
  // stumble at the moment it is most checkable. (ef-manager, on CHECK 4 and CHECK 5.)
  // ⚠ THE LEADING CLAUSE WAS THE FOURTH MEMBER OF THIS CLASS AND I WALKED PAST IT. ef-manager
  // named three examples — "1 do both", "1 only mention", "1 link" — and my fix matched the LIST
  // instead of the class the list was drawn from. Their diagnosis, which is the transferable
  // part: "a defect report enumerating instances invites an instance-shaped fix, so the report
  // should name the property." Same failure they had made hours earlier, asserting a dangerous
  // instruction was unique while a second copy sat 340 lines below in different phrasing.
  //
  // ⇒ ONE helper for every count-carrying clause in this sentence, leading clause included, and a
  // property test over all n=1 combinations rather than a fourth instance fix.
  const v = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;
  const parts = [];
  if (b.linkOnly) parts.push(v(b.linkOnly, 'links to the file itself', 'link to the file itself'));
  if (b.mentionOnly) parts.push(v(b.mentionOnly, 'only mentions a symbol defined in it', 'only mention a symbol defined in it'));
  if (b.both) parts.push(v(b.both, 'does both', 'do both'));
  // The second number is what the docs layer will HAND BACK, so following the instruction cannot
  // surprise. Printed only when it differs, so it means something when it appears.
  //
  // ⚠ THAT SILENCE IS LOAD-BEARING ON AN INVARIANT NOBODY DECLARED, and ef-manager found it by
  // cross-tabbing all 350 files with doc edges: MENTIONS edges carry NO source_line — 2527 of
  // 2527, zero exceptions, against LINKS_TO's 477 of 477 non-zero. So for a mention-only file the
  // layer tuple (label, path, relation, line) collapses to one row per document BY CONSTRUCTION,
  // and `documents === references` is a theorem rather than an accident. Sixteen of the nineteen
  // files where the two agree agree for that reason.
  //
  // ⇒ If MENTIONS ever gains line numbers — a plausible improvement, since LINKS_TO already has
  // them — those files stop collapsing and this field wakes up on sixteen files at once. That is
  // a correct design resting on an undocumented property of the extractor, which is the same
  // shape as a guard that passes because its input is missing. The dependency is named here and
  // pinned by test, so whoever adds those line numbers finds out at the right moment.
  const refs = b.references === b.documents ? ''
    : `, giving ${v(b.references, 'entry', 'entries')}`;
  return `${v(b.documents, 'document relates', 'documents relate')} to this file`
    + ` — of those, ${parts.join(', ')}${refs}.`
    + ' Not in the default layers: pass layers:["docs"] to see them, with the line each'
    + ' reference is on.';
}

// A TRUE ZERO AND A BROKEN ZERO WERE SHAPE-IDENTICAL, and ef-manager caught it inside the fix for
// the original bug: "the morning bug returned items:[] + exhaustive:true over 12 real edges. The
// true zero I used as a control returns items:[] + exhaustive:true. You fixed the data; you did
// not make the failure distinguishable from the success."
//
// The receipt's coverage check does NOT close it. If doc-link extraction breaks, the graph holds
// no LINKS_TO at all, so the relations-present set shrinks to match what was consulted and the
// claim is proven complete over a corpus that quietly lost a source.
//
// The positive control, applied to ourselves: an empty answer states whether the INSTRUMENT can
// currently produce a non-empty one anywhere. "No document links to this file" and "no document
// links to ANY file, though this repo has documents" are different facts, and only the first is
// about the file that was asked about.
function docLayerAbsenceCause(db) {
  try {
    const docs = db.all("SELECT COUNT(*) AS c FROM nodes WHERE type = 'Document'")[0]?.c ?? 0;
    if (docs === 0) {
      return 'this graph holds no Document nodes at all, so the absence is about the INDEX rather than about this file';
    }
    const anyEdge = db.all(
      `SELECT COUNT(*) AS c FROM edges WHERE relation IN (${PULL_DOC_SQL_LIST})`)[0]?.c ?? 0;
    if (anyEdge === 0) {
      return `this graph holds ${docs} document(s) and ZERO doc edges of any kind — extraction produced nothing repo-wide, so this absence is SUSPECT rather than observed`;
    }
    return null;
  } catch { return null; }
}

// Which relations do Documents ACTUALLY emit in this graph? Cheap (indexed on relation), and the
// only honest denominator for "did the docs layer ask everywhere it should have". Compared
// against DOC_FAMILY by the receipt: a relation present here and absent there is an unasked
// question, and an unasked question must not be reported as an absence.
function docRelationsPresent(db) {
  try {
    return db.all(
      `SELECT DISTINCT e.relation AS relation
         FROM edges e JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'`,
    ).map((r) => r.relation).sort();
  } catch {
    // ⚠ FAIL CLOSED. If we cannot establish what the graph holds, we cannot prove the layer
    // consulted all of it — so declare a sentinel the family will never contain, which refuses
    // the exhaustive claim and names the reason rather than defaulting to complete.
    return ['<doc relations could not be enumerated>'];
  }
}

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
// `code_intel` is opt-in only — keeps token budget controlled. Plan #3.
const ALL_LAYERS = ['code', 'functionality', 'tasks', 'docs', 'activity', 'relations', 'transitive', 'code_intel'];
// ⛔ `docs` JOINED THE DEFAULT, AND ITS ABSENCE EXPLAINS "ZERO CONSUMERS".
//
// ef-manager, after days of intensive field use: "it cannot have cost me, because I never consumed
// it — the doc layer has had zero consumers." We treated that as an interest problem and spent
// weeks on the layer's PRECISION: rules graded blind on three held-out corpora, one deleted at
// 0.9311, `target_qname` added so a grader could verify a binding.
//
// ⇒ None of that was the reason. The layer was UNREACHABLE FROM THE FRONT DOOR. `graph_pull` is
// the cross-layer verb, and `docs` was opt-in behind a parameter a caller would have to already
// know existed — which is the one thing someone asking "where is the document about this" does not.
// Measured: graph_pull on mcp/stdio/server.js returned ZERO documents while thirteen doc edges
// pointed at it.
//
// ⚠ MEASURED BEFORE CHANGING IT, because a layer added to every response is a token cost on every
// response, and this repo's bar is that a signal firing on most calls is slop however good it is:
//
//     files in the graph                657
//     files with >=1 doc edge           194   (29.5%)
//     when non-empty: median 1, p90 3, max 13
//
// So it is EMPTY for 70.5% of files and one to three items for most of the rest. That is the
// cheapest possible way to carry the thing THE-GOAL says the product is: "from that doc, that
// decision built this feature, this feature lives in these files."
//
// `code_intel` stays opt-in — it is genuinely expensive, and its cost is per-symbol rather than
// per-file. `relations` and `transitive` stay opt-in for the same reason.
const DEFAULT_LAYERS = ['code', 'functionality', 'tasks', 'docs', 'activity'];

function emptyCodeIntelEvidence() {
  return { found: false, definitions: [], references: [], hovers: [], summary: { definitions: 0, references: 0, hovers: 0 } };
}

function normalizeOverlayLookup(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function parsePrefixedNode(node) {
  const raw = String(node || '');
  const match = raw.match(/^(feature|task)[:/](.+)$/i);
  if (!match) return { kind: null, value: raw };
  return { kind: match[1].toLowerCase(), value: match[2].trim() };
}

function resolveFeatureNode(node, features) {
  const parsed = parsePrefixedNode(node);
  const raw = parsed.kind === 'feature' ? parsed.value : String(node || '');
  const norm = normalizeOverlayLookup(raw);

  const exactId = features.find((f) => f.id === raw);
  if (exactId) return exactId;
  const ciId = features.find((f) => normalizeOverlayLookup(f.id) === norm);
  if (ciId) return ciId;
  if (parsed.kind !== 'feature') return null;
  const exactLabel = features.find((f) => String(f.label || '') === raw);
  if (exactLabel) return exactLabel;
  const ciLabel = features.find((f) => normalizeOverlayLookup(f.label || '') === norm);
  if (ciLabel) return ciLabel;
  return null;
}

function resolveTaskNode(node, allTasks) {
  const parsed = parsePrefixedNode(node);
  const raw = parsed.kind === 'task' ? parsed.value : String(node || '');
  const norm = normalizeOverlayLookup(raw);

  const exactId = allTasks.find((t) => t.id === raw);
  if (exactId) return exactId;
  const ciId = allTasks.find((t) => normalizeOverlayLookup(t.id) === norm);
  if (ciId) return ciId;
  return null;
}

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
    // ⛔ `type = 'File'` HERE MEANT graph_pull ANSWERED "unresolved" ABOUT NODES THAT EXIST.
    // Measured over the whole population, not sampled: 78 of 266 non-File doc-edge targets were
    // unresolvable — Document 37, Config 24, Directory 16, Entrypoint 1, which is exactly
    // FILE_LEVEL_TYPES minus File. `graph_pull("README.md")` returned
    // `{"kind":"unresolved","value":"README.md"}` for a Document node with five documents
    // pointing at it, and `.mcp.json` with nine.
    //
    // ⚠ "Unresolved" is not "no docs". It tells an agent THE NODE DOES NOT EXIST — a confident
    // empty answer, which ends a search rather than redirecting it. Same class as the absence
    // defect this whole arc started from, one route over.
    //
    // ⇒ This is the SAME assumption that cost `analysis/doc-links.js` all 68 of its authored
    // Markdown links this morning. I fixed it there, wrote the list, commented the trap — and left
    // it standing in a resolver two hundred lines from the file I was editing. The list now lives
    // in the registry so the second consumer inherits the fix.
    const fileHit = db.get(
      `SELECT file_path, type FROM nodes WHERE type IN (${FILE_LEVEL_SQL_LIST}) AND file_path = $p
        ORDER BY CASE type ${FILE_LEVEL_TYPES.map((t, i) => `WHEN '${t}' THEN ${i}`).join(' ')} END
        LIMIT 1`, { p: node });
    // The declared precedence breaks ties rather than SQL row order — six paths in this repo are
    // both Entrypoint and File, and picking by row order is the legacy first-wins bug one level up.
    if (fileHit) return { kind: 'file', value: node, nodeType: fileHit.type };
  }
  // Symbol lookup
  const sym = db.get(
    `SELECT id, label, type, file_path, start_line FROM nodes
     WHERE label = $node AND type IN ('Function','Method','Class','Interface','Type')
     LIMIT 1`, { node });
  if (sym) return { kind: 'symbol', value: sym };

  // ⛔ LAST RESORT, AND IT CLOSES THE RESIDUE THE FIRST FIX LEFT. Widening the type list above
  // took the unresolvable doc-edge targets from 78 to 6 — not to 0. The remaining six were all
  // bare top-level directory names: `docs`, `mcp`, `tests`, `scripts`, `.agents`, `reference`.
  // They failed a SECOND gate: `looksFileish` requires a slash or a known extension, so a bare
  // directory name never reaches the path lookup at all.
  //
  // ⚠ AND THE FIX GOES HERE RATHER THAN IN `looksFileish`, deliberately. That heuristic exists so
  // "a path-shaped string does not shadow a real symbol lookup" — widening it would let a
  // DIRECTORY named `docs` outrank a SYMBOL named `docs`, trading one wrong answer for another.
  // Running it after the symbol lookup has already failed preserves that precedence and costs one
  // indexed query on the path that was about to return "unknown" anyway.
  const pathHit = db.get(
    `SELECT file_path, type FROM nodes WHERE type IN (${FILE_LEVEL_SQL_LIST}) AND file_path = $p
      ORDER BY CASE type ${FILE_LEVEL_TYPES.map((t, i) => `WHEN '${t}' THEN ${i}`).join(' ')} END
      LIMIT 1`, { p: node });
  if (pathHit) return { kind: 'file', value: node, nodeType: pathHit.type };

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
  return loadTasksArtifact(repoRoot).tasks || [];
}

function recentCommitsForFile(repoRoot, filePath, limit = 5) {
  try {
    const out = execFileSync('git',
      ['-C', repoRoot, 'log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', String(limit), '--', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
    `SELECT DISTINCT fn.label, fn.type, fn.file_path, fn.start_line, e.relation, e.provenance
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     WHERE e.to_id = $id
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
     LIMIT 100`, { id: sym.id });
  const calleesRaw = db.all(
    `SELECT DISTINCT tn.label, tn.type, tn.file_path, tn.start_line, e.relation, e.provenance
     FROM edges e
     JOIN nodes tn ON tn.id = e.to_id
     WHERE e.from_id = $id
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
     LIMIT 100`, { id: sym.id });
  const withProv = (r) => ({ ...r, provenance: r.provenance ?? 'EXTRACTED' });
  return {
    callers: capped(callersRaw.map(withProv), limit),
    callees: capped(calleesRaw.map(withProv), limit),
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
  // ★ THE RECOMPILE SURFACE IS TRANSITIVE, AND WE WERE STOPPING AT HOP 1.
  //
  // ef-manager, deleting a header (2026-07-31): "ChunkManager.h and
  // GpuTerrainGenerator.h are HEADERS, so the blast radius does not stop at the 10
  // direct includers. One more grep gave ~30 additional TUs at hop 2, and showed
  // propagation TERMINATES there because every hop-2 includer is a .cpp. For a
  // deletion question the transitive surface is the whole point — imported_by is
  // hop 1 only. You already have the edges; the walk is what is missing."
  //
  // He is right that it is a walk over edges we already hold, and right that hop 1
  // is the wrong answer to "what do I have to rebuild". Bounded by depth and by a
  // node cap so a hub header cannot produce an unbounded sweep, and the bound is
  // REPORTED — a truncated closure that looks complete would be the same
  // false-completeness failure this codebase exists to prevent.
  const TRANSITIVE_MAX_DEPTH = 4;
  const TRANSITIVE_MAX_FILES = 300;
  const transitiveImporters = (() => {
    const seen = new Set([filePath]);
    const byDepth = [];
    let frontier = [filePath];
    let truncated = false;
    for (let depth = 1; depth <= TRANSITIVE_MAX_DEPTH && frontier.length; depth += 1) {
      const rows = db.all(
        `SELECT DISTINCT fn.file_path
           FROM edges e
           JOIN nodes fn ON fn.id = e.from_id
           JOIN nodes tn ON tn.id = e.to_id
          WHERE tn.file_path IN (${frontier.map((_, i) => `$f${i}`).join(',')})
            AND e.relation = 'IMPORTS'
            AND fn.file_path IS NOT NULL
          LIMIT ${TRANSITIVE_MAX_FILES}`,
        Object.fromEntries(frontier.map((f, i) => [`f${i}`, f])),
      );
      // ★ THE SQL `LIMIT` IS ITSELF A TRUNCATION, AND IT WAS INVISIBLE.
      //
      // The old check only set `truncated` when `seen.size` crossed the cap. But
      // the LIMIT clips rows inside SQLite BEFORE we ever count them: a hop whose
      // returned rows are mostly already-seen discards real includers and leaves
      // seen.size far below the cap — so the closure reported `terminated: true`
      // while silently missing files. That is precisely the false-completeness
      // failure this whole surface exists to prevent, sitting inside the fix for
      // it. A full page of rows means "there may be more", always.
      if (rows.length >= TRANSITIVE_MAX_FILES) truncated = true;
      const next = [];
      for (const r of rows) {
        if (!r.file_path || seen.has(r.file_path)) continue;
        if (seen.size >= TRANSITIVE_MAX_FILES) { truncated = true; break; }
        seen.add(r.file_path);
        next.push(r.file_path);
      }
      if (next.length) byDepth.push({ depth, files: next });
      frontier = next;
    }
    // Ran out of depth budget with work still queued — the closure is a FLOOR for
    // a different reason than the file cap, and the caller deserves to know which.
    const depthCapped = frontier.length > 0;
    const total = seen.size - 1;
    return {
      total,
      byDepth,
      truncated,
      depth_capped: depthCapped,
      // TERMINATED means the walk ran out of INCLUDERS, not out of budget — the
      // frontier emptied on its own. That is the useful fact for a deletion, and
      // it is decided by the graph (a node with no incoming IMPORTS edge is
      // terminal), never by file extension. Extension-based terminality would be
      // defeated by the first .inl/.glsl/.tpp the walk met; this is not.
      terminated: !truncated && !depthCapped,
      note: truncated
        ? // ⚠ WORDING CORRECTED 2026-08-12 (graph-senior-dev-hermes). "not the full closure"
        // asserts omission, and on an EXACTLY-full page nothing may have been omitted —
        // 300 returned rows cannot distinguish 300 candidates from 3000. What is true in
        // both cases is that completeness was not established.
        `recompile surface hit the ${TRANSITIVE_MAX_FILES}-file limit — COMPLETENESS NOT ESTABLISHED, treat as a FLOOR`
        : depthCapped
          ? `recompile surface CUT OFF at depth ${TRANSITIVE_MAX_DEPTH} with includers still unexplored — this is a FLOOR, not the full closure`
          : `full transitive include closure: ${total} file(s) across ${byDepth.length} hop(s)`,
    };
  })();

  // defines: top symbols defined in this file
  const definesRaw = db.all(
    `SELECT label, type, start_line FROM nodes
     WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
     ORDER BY start_line LIMIT 50`, { p: filePath });
  return {
    imports: capped(importsRaw.map(r => r.file_path), limit),
    // ★ D5 — SAME RELATION, SAME HOP, SAME RESPONSE, ONE CAPPED AND ONE NOT.
    //
    // ef-manager on worldbuf.glsl: imported_by showed 10 of 13 with truncated:true
    // while recompile_surface hop 1 listed all 13 with truncated:false. Both are
    // the IMPORTS hop-1 set. Nothing was wrong in either number, which is exactly
    // why it is worth fixing — a reader who has been trained to check `truncated`
    // finds two answers to one question and has to work out which to believe.
    //
    // recompile_surface hop 1 IS this set, uncapped, so the capped one points at
    // it rather than silently disagreeing.
    imported_by: {
      ...capped(importedByRaw.map(r => r.file_path), limit),
      ...(importedByRaw.length > limit ? {
        complete_set_at: 'relations.recompile_surface.byDepth[0] — same IMPORTS hop-1 set, uncapped',
      } : {}),
    },
    // Hop 1 answers "who includes this"; the RECOMPILE surface is transitive, and
    // for a deletion question the transitive surface is the whole point.
    recompile_surface: transitiveImporters,
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
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
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
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
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

function pullFile({ db, filePath, features, allTasks, repoRoot, layers, receiptMode }) {
  const out = { node: { kind: 'file', path: filePath }, layers: {} };

  if (layers.has('code')) {
    const fileNode = db.get(
      `SELECT id, label, file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: filePath });
    if (!fileNode) {
      // ⛔ THIS SENTENCE ASSERTED ABSENCE FROM THE GRAPH, and for the 78 nodes the resolver above
      // now admits it would have been FALSE — a Document or Config node is in the graph, it simply
      // has no `File`-typed row. ef-manager scoped it correctly: fixing the resolver alone is
      // sufficient for the disclosure, because this gate fails SOFT and the other layers still
      // run. But it would then announce "file not in graph" about a file that is in the graph, on
      // exactly the population being fixed — and it is the assertion, not the emptiness, that ends
      // a search.
      //
      // ⇒ Say what was actually checked. Same scoping correction already applied in this file to
      // `orphan`, to the trust-spine banner, and to `stale`.
      const indexedAs = db.get(
        `SELECT type FROM nodes WHERE type IN (${FILE_LEVEL_SQL_LIST}) AND file_path = $p LIMIT 1`,
        { p: filePath });
      // ⛔ THE KEY WAS `error`, AND THE KEY CONTRADICTED ITS OWN CONTENT. ef-manager: "This is not
      // an error. It is a correct, complete answer to a question that does not apply to the node.
      // The prose was fixed to stop asserting a failure; the field name still asserts one, and a
      // consumer branching on the presence of `error` — which is exactly what a field called
      // `error` invites — will treat 78 healthy nodes as 78 failures."
      //
      // I spent the night on fields whose name and content disagree and then shipped one, inside
      // the fix for one. And it is the same insight as refusing to file the legacy text clamp
      // under packet-lists.js: a name that merges two things lets the weaker one inherit the
      // stronger one's authority.
      //
      // ⇒ `absent_because` separates the ANSWER from the REASON it is empty, which is the shape
      // the receipt work already settled on for exactly this question one verb over. Machine-
      // readable `reason` so a consumer never parses English, and no key that invites a failure
      // branch.
      out.layers.code = indexedAs
        ? {
          symbols: null,
          absent_because: {
            reason: 'indexed_as_other_type',
            indexed_as: indexedAs.type,
            detail: `this path is indexed as ${indexedAs.type}, not as a source File, so it has no code symbols`,
          },
          path: filePath,
        }
        : {
          symbols: null,
          absent_because: {
            reason: 'not_in_graph',
            detail: 'no node of any file-level type exists at this path',
          },
          path: filePath,
        };
    } else {
      const symbolsRaw = db.all(
        `SELECT label, type, start_line FROM nodes
         WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
         ORDER BY start_line LIMIT 200`, { p: filePath });
      out.layers.code = { file: filePath, symbols: capped(symbolsRaw, 20) };
    }
  }

  if (layers.has('functionality')) {
    // ★ "ORPHAN" WAS A BROAD CLAIM MADE FROM A NARROW MECHANISM.
    //
    // featuresForFile matches ONLY `anchors.files` globs. graph_consequences also
    // reaches features through SYMBOL anchors and through tasks.json references —
    // so the two verbs answered "does this file map to a feature?" with flatly
    // opposite verdicts on the same file, same server, same minute (ef-manager,
    // 2026-07-31):
    //     graph_pull          → features: [], orphan: true
    //     graph_consequences  → features_touching: [world-buffer, chunk-management]
    //
    // And it mattered more than a cosmetic disagreement: that feature mapping is the
    // mechanism that produced the ONLY decisive graph win in his experiments — four
    // real dependents with zero textual mentions. One verb was reporting that the
    // winning mechanism did not apply.
    //
    // Neither computation is wrong; the CLAIM was. `orphan` now says what it was
    // derived from instead of asserting a global negative, which is the same
    // scoping fix applied to the trust-spine banner and to "stale".
    const matchedIds = featuresForFile(features, filePath);
    out.layers.functionality = {
      features: matchedIds,
      // Kept for back-compat, but read `orphanBasis` before acting on it.
      orphan: matchedIds.length === 0,
      orphanBasis: 'file_glob_anchors_only',
      ...(matchedIds.length === 0 ? {
        note: 'no feature FILE-GLOB anchor matches this path. That is not proof the file is unmapped: '
          + 'graph_consequences also resolves features via SYMBOL anchors and tasks.json references, and may map it. '
          + 'Check there before treating this file as orphaned.',
      } : {}),
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
    // Documents that point at this file — either by MENTIONING a symbol defined in it, or by
    // LINKING TO the file itself. The `s.file_path = $p` join covers both shapes already: a
    // symbol node and the file-level node both carry the path. Only the relation set was wrong.
    //
    // The relation is carried through so a reader can weigh an authored link differently from an
    // inferred prose mention — they are different evidence and were being reported as one.
    const docs = db.all(
      `SELECT DISTINCT d.label, d.file_path, e.relation, e.source_line
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       JOIN nodes s ON s.id = e.to_id AND s.file_path = $p
       WHERE e.relation IN (${PULL_DOC_SQL_LIST})
       LIMIT 20`, { p: filePath });
    out.layers.docs = capped(
      docs.map(d => ({
        label: d.label,
        file: d.file_path,
        via: d.relation,
        ...(d.source_line ? { line: d.source_line } : {}),
      })),
      10
    );
    // An empty result says WHY when the reason is about the index rather than about this file.
    // Silent on the ordinary case, so the note carries information when it appears.
    if (docs.length === 0) {
      const cause = docLayerAbsenceCause(db);
      if (cause) out.layers.docs.absence_cause = cause;
    }
  } else {
    // REACHABLE-BY-ARGUMENT IS NOT REACHABLE. ef-manager re-ran the fixed call with `layers`
    // omitted — what an agent gets who reaches for the right verb without knowing the layer
    // names — and the defaults (code/functionality/tasks/activity) do not include docs. The
    // response carried zero documents and nothing in it named a docs layer or hinted one existed.
    // So an agent who reaches CORRECTLY still got the same nothing as before the fix, now from a
    // call returning exhaustive:false without saying what it left out.
    //
    // ⛔ THE PARAGRAPH THAT USED TO BE HERE CHOSE A POINTER OVER A DEFAULT, AND ITS REASON WAS
    // WRONG — measured, not re-argued. It read: "adding docs to the defaults makes every pull pay
    // for a layer most callers do not want, while a pointer costs nothing when there is nothing to
    // point at." The second half is true. The first half was never measured:
    //
    //     files in the graph            657
    //     files with >=1 doc edge       194   (29.5%)   median 1, p90 3, max 13
    //
    // ⇒ 70.5% of pulls pay NOTHING because the layer is empty, and the 29.5% that would pay one to
    // three items were instead paying a sentence of prose telling them to ask again. Comparable
    // cost, strictly less use, plus a round trip.
    //
    // ⇒ AND THE POINTER WAS A STAND-IN FOR THE FIX. ef-manager's own sentence, quoted above: an
    // agent who reaches correctly and does not know to type layers:["docs"] gets the same nothing.
    // Telling them what to type is better than silence and worse than answering.
    //
    // `docs` is now a DEFAULT layer. This branch survives for the caller who passes an explicit
    // narrow `layers` list excluding docs — a deliberate act rather than an ignorant one, and the
    // one case where a pointer is the right answer.
    const breakdown = docReferenceBreakdown(db, filePath);
    if (breakdown.documents > 0) {
      out.docs_not_shown = docsNotShownSentence(breakdown);
      // The structure beside the sentence, so a consumer never has to parse prose to get the
      // split — and so the reconciliation is checkable without a regex.
      out.docs_not_shown_breakdown = breakdown;
    }
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForFile(db, filePath);
  }

  // ★ RECEIPT ON graph_pull — ef-manager's stated priority over graph_impact,
  // because relations/docs are the layers that won his experiment 2 and the ones
  // he would most want handed to a teammate with a receipt attached.
  //
  // The claims here are almost entirely `observed`: these come from edges, not
  // from the curated overlay. That contrast IS the point — a teammate holding a
  // pull receipt and a consequences receipt for the same file can see which
  // fields survive without the overlay, and disagreement between them is itself
  // the signal.
  const rel = out.layers.relations;
  // `capped()` returns {items,total,truncated} — and a capped LIST is a floor in
  // exactly the way the closure cap is. Reading `.items` and ignoring `.truncated`
  // would put a silently-shortened list under an exhaustive receipt, which is the
  // same laundering this file already committed once inside `terminated`.
  const importedBy = rel?.imported_by ?? {};
  const docsLayer = out.layers.docs ?? {};
  const listTruncated = Boolean(importedBy.truncated) || Boolean(docsLayer.truncated);
  const pullClaims = [
    ...(importedBy.items ?? []).map((f) => ({ field: 'imported_by', value: f, provenance: 'observed', basis: 'IMPORTS edge, hop 1' })),
    ...(rel?.recompile_surface?.byDepth ?? []).flatMap((d) => d.files.map((f) => ({
      field: 'recompile_surface', value: f, provenance: 'observed', basis: `IMPORTS closure, hop ${d.depth}`,
    }))),
    // ⚠ The basis names the RELATION THAT PRODUCED THIS ROW, not a relation somebody assumed.
    // It said 'MENTIONS edge' for every row, which would now be false for the authored links and
    // was the kind of hardcoded provenance string that survives a query change unnoticed.
    ...(docsLayer.items ?? []).map((d) => ({
      field: 'docs',
      value: d.file ?? d.label,
      provenance: 'observed',
      basis: `${d.via ?? 'doc'} edge${d.line ? ` @${d.line}` : ''}`,
    })),
  ];
  const surface = rel?.recompile_surface;
  out.receipt = receiptFor(buildReceipt({
    verb: 'graph_pull',
    args: { node: filePath, layers: [...layers] },
    pins: currentPins({
      repoCommit: pinRepoCommit(repoRoot),
      manifest: pinManifest(repoRoot),
      overlayContentHash: pinOverlayHash(repoRoot),
      worktreeDirtyHash: pinWorktreeDirty(repoRoot),
    }),
    reported_context: { overlay_age_days: pinOverlayAge(repoRoot) },
    claims: pullClaims,
    floor: {
      // Exhaustive ONLY when the closure genuinely terminated. A truncated or
      // depth-capped surface is a FLOOR, and a receipt that called it exhaustive
      // would launder that floor into a fact — the failure this file already had
      // once, in `terminated` itself.
      exhaustive: surface ? surface.terminated === true && !listTruncated : false,
      cause: listTruncated
        ? 'a returned list hit its display cap — the claim set is a subset of what was found'
        : surface?.terminated === true
          ? null
          : surface?.truncated
          ? 'recompile surface hit the file cap — closure is a floor, not the full set'
          : surface?.depth_capped
            ? 'recompile surface hit the depth cap with includers still unexplored — closure is a floor'
            : 'relations layer not requested, so no closure was computed',
      // ⛔ THE DOC LAYER'S COMPLETENESS DEPENDS ON RELATIONS, AND THE RECEIPT COULD NOT SEE THAT.
      // `assessTruncation` proves a list was not cut short; it cannot prove the list was built by
      // asking every source. Declaring the family here means that adding a doc relation to the
      // taxonomy WITHOUT wiring it into the query above turns this receipt non-exhaustive, with
      // the unasked relation named — rather than certifying an empty answer.
      // ⚠ `declared` COMES FROM THE GRAPH, NOT FROM THE SAME CONSTANT THE QUERY USED.
      // My first version declared DOC_FAMILY on both sides, which is a tautology wearing the
      // shape of a check: two reads of one source cannot disagree. What can disagree is the
      // family against REALITY — the relations documents actually emit in this graph. If an
      // extractor starts producing a doc-sourced relation the family does not know about, the
      // layer is silently incomplete and this is the only thing that would notice. It is exactly
      // the failure that happened: LINKS_TO existed in the graph before the layer knew of it.
      coverage: layers.has('docs')
        ? { declared: docRelationsPresent(db), consulted: [...DOC_FAMILY] }
        : undefined,
      not_checked: [
        'includers reachable only through a build system rather than a source include',
        ...(surface?.truncated || surface?.depth_capped ? ['files beyond the traversal cap'] : []),
      ],
    },
    disconfirm: {
      verb: 'graph_consequences',
      args: { target: filePath },
      expect:
        'consequences reaches dependents through feature anchors rather than include edges. A file it '
        + 'lists as a co-consumer that is absent from recompile_surface is a real dependent with no '
        + 'include path — which means this receipt\'s structural closure is not the whole blast radius.',
    },
  }), receiptMode);

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
        const raw = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
         AND e.relation IN (${PULL_TOUCH_SQL_LIST})
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
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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

// ⛔ `dirtyFilesKnown` HAS NO DEFAULT, DELIBERATELY. I wrote `= true` first, which means a call
// site added later and missed here would silently certify a tree nobody read — a fail-open
// default, the exact shape this whole sweep exists to remove. Absent now means undefined,
// which is falsy, which reports UNOBSERVED. The omission fails toward doubt, not toward a claim.
function summarizeDirtyOverlapForNode({ kind, value, features, dirtyFiles, dirtyFilesKnown }) {
  const seams = summarizeDirtySeams(features, dirtyFiles);
  let targetFiles = [];
  let targetFeatureIds = [];

  if (kind === 'file') {
    targetFiles = [value];
    targetFeatureIds = featuresForFile(features, value);
  } else if (kind === 'symbol') {
    targetFiles = value?.file_path ? [value.file_path] : [];
    targetFeatureIds = value?.file_path ? featuresForFile(features, value.file_path) : [];
  } else if (kind === 'feature') {
    targetFeatureIds = value?.id ? [value.id] : [];
  } else if (kind === 'task') {
    targetFeatureIds = taskFeatureRefs(value);
    targetFiles = value?.files_hint || [];
  }

  return {
    direct_files: targetFiles.filter((file) => dirtyFiles.includes(file)),
    affected_features: seams.features
      .filter((feature) => targetFeatureIds.includes(feature.id))
      .map((feature) => ({
        id: feature.id,
        label: feature.label,
        file_count: feature.file_count,
        files: feature.files.slice(0, 5),
      })),
    // ⛔ See consequences.js: an empty overlap and an unread tree are the same bytes without this.
    // A caller that omits the flag entirely lands here too, which is the intended direction.
    ...(dirtyFilesKnown ? {} : { unobserved: true }),
  };
}

// ---------- main ----------

export async function graphPull({ repoRoot, node, layers, direction, receipt: receiptMode, overlayQuality: wantOverlayQuality }) {
  // ★ overlay_quality was a 12-field block on EVERY graph_pull response, and a field
  // reviewer reading everything adversarially across three experiments never once
  // read it. It is repo-level state, so it belongs in graph_health ONCE — not on
  // every node query. Opt in with overlayQuality:true.
  if (!node) return 'ERROR: node parameter is required (file path, feature id, symbol name, or task id)';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_pull' });
  if (freshness.blocker) return freshness.blocker;

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const layerSet = new Set(
    Array.isArray(layers) && layers.length > 0
      ? layers.filter(l => ALL_LAYERS.includes(l))
      : DEFAULT_LAYERS
  );
  // Top-level code-intel evidence (opt-in via 'code_intel' layer). Lives at
  // the top level (not under .layers) so consumers can grep result.code_intel
  // without knowing the rest of the shape. Plan #3.
  let codeIntelEvidence = null;
  if (layerSet.has('code_intel')) {
    try {
      codeIntelEvidence = getCodeIntelEvidenceForSymbol(db, { qname: String(node) });
    } catch {
      codeIntelEvidence = emptyCodeIntelEvidence();
    }
  }
  const withCodeIntel = (obj) => (codeIntelEvidence ? { ...obj, code_intel: codeIntelEvidence } : obj);

  try {
    const overlay = loadFunctionality(repoRoot);
    const allTasks = loadTasksSafe(repoRoot);
    const features = overlay.features;
    const overlayQuality = summarizeOverlayQuality(features, allTasks);
    // ⛔ ONE GIT OBSERVATION PER READ, NOT TWO. inspectReadFreshness above already ran
    // `git status` and printed a warning about the result; this line ran it AGAIN, moments later,
    // and swallowed a failure into []. Two queries for one question is the shape of the field
    // report this whole area exists to answer — one verb said "592 dirty" and another "4 dirty"
    // for the same tree at the same commit, and the reader could not tell which was lying. Sharing
    // the observation makes disagreement unconstructible rather than merely unlikely.
    //
    // ⚠ `dirtyFilesKnown` is false when the query failed. The shared warning channel has already
    // told the reader so, which is why nothing is re-announced here; the flag is for the structured
    // seam fields below, which an agent reads without seeing the prose.
    const dirtyFiles = freshness.dirtyFiles;
    const dirtyFilesKnown = freshness.dirtyFilesKnown;
    const prefixed = parsePrefixedNode(node);

    // Resolve node kind. Feature/task prefixes are explicit routing hints:
    // `feature:chunk-management`, `task:CU-123`.
    const featureMatch = resolveFeatureNode(node, features);
    if (featureMatch) {
      const result = attachReadWarnings({
        ...pullFeature({ db, featureId: featureMatch.id, features, allTasks, repoRoot, layers: layerSet, opts: { direction } }),
        ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'feature',
          value: featureMatch,
          features,
          dirtyFiles,
          dirtyFilesKnown,
        }),
      },
      freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    const taskMatch = resolveTaskNode(node, allTasks);
    if (taskMatch) {
      const result = attachReadWarnings({
        ...pullTask({ db, taskId: taskMatch.id, features, allTasks, repoRoot, layers: layerSet }),
        ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'task',
          value: taskMatch,
          features,
          dirtyFiles,
          dirtyFilesKnown,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    if (prefixed.kind === 'feature' || prefixed.kind === 'task') {
      // FIX B — overlay-empty hint. Before reporting "feature/task not found"
      // (which reads as "tool broken" when the overlay was never built), check
      // whether the overlay is actually built. Uses the DB so validateAnchors()
      // gives the authoritative "all anchors broken" (resolved:0) signal —
      // the exact sand_castle condition. When unbuilt, surface the recovery
      // hint instead of an empty not-found.
      const build = assessOverlayBuild(repoRoot, { features, tasks: allTasks, db });
      if (!build.built) {
        return JSON.stringify(withCodeIntel(attachReadWarnings({
          node: { kind: prefixed.kind, value: prefixed.value },
          error: 'overlay not built',
          hint: overlayNotBuiltHint(build.reason),
          ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
          dirty_overlap: { direct_files: [], affected_features: [] },
        }, freshness.warnings)), null, 2);
      }
      const suggestions = prefixed.kind === 'feature'
        ? features.slice(0, 5).map((f) => `feature:${f.id}`)
        : allTasks.slice(0, 5).map((t) => `task:${t.id}`);
      return JSON.stringify(withCodeIntel(attachReadWarnings({
        node: { kind: prefixed.kind, value: prefixed.value },
        error: `${prefixed.kind} not found`,
        hint: prefixed.kind === 'feature'
          ? 'use a valid feature id/label, e.g. feature:chunk-management or feature/chunk-management'
          : 'use a valid task id, e.g. task:CU-123, task/CU-123, or CU-123',
        suggestions,
        ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
        dirty_overlap: { direct_files: [], affected_features: [] },
      }, freshness.warnings)), null, 2);
    }
    // File or symbol?
    const detected = detectNodeKind(db, node);
    if (detected.kind === 'file') {
      const result = attachReadWarnings({
        ...pullFile({ db, filePath: detected.value, features, allTasks, repoRoot, layers: layerSet, receiptMode }),
        ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'file',
          value: detected.value,
          features,
          dirtyFiles,
          dirtyFilesKnown,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    if (detected.kind === 'symbol') {
      const result = attachReadWarnings({
        ...pullSymbol({ db, sym: detected.value, features, allTasks, repoRoot, layers: layerSet }),
        ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'symbol',
          value: detected.value,
          features,
          dirtyFiles,
          dirtyFilesKnown,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    return JSON.stringify(withCodeIntel(attachReadWarnings({
      node: { kind: 'unresolved', value: node },
      error: 'could not resolve as feature id, task id, file path, or symbol',
      hint: 'try feature:<id>, feature/<id>, task:<id>, task/<id>, graph_whereis(symbol=...), or graph_search(query=...) to find the right node identifier',
      ...(wantOverlayQuality ? { overlay_quality: overlayQuality } : {}),
      dirty_overlap: { direct_files: [], affected_features: [] },
    }, freshness.warnings)), null, 2);
  } finally {
    db.close();
  }
}
