// DOCUMENT → FILE LINKS. RULE 1 OF THE DOC-FOUNDATION REBUILD.
//
// ⛔ WHAT THIS REPLACES. `analysis/mentions.js` admitted a doc→symbol edge for every
// `\b[A-Za-z_]\w{3,}\b` token that happened to equal a symbol label, resolved duplicate labels
// FIRST-WINS, and stored `source_line = 0`. It produced ~2,370 edges on this repo of which 83.5%
// pointed at an all-lowercase-word target. That percentage is a TRIAGE PROXY and not a
// correctness label — but the admission rule required no reference evidence whatsoever, which is
// establishable from the source alone and is the actual defect.
//
// ⚠ ef-manager ran the same extractor on `echoes_of_the_fallen` and measured 63.1% — twenty
// points from this repo, same code. The rate tracks the language's NAMING CONVENTION, not the
// documents: JavaScript names functions `read`, `count`, `exists` and collides with English
// head-on; C++ CamelCase mostly does not. ⇒ No global confidence threshold and no hand-tuned
// stop-word list can be calibrated once and be right on both repos. This module uses NEITHER.
//
// graph-senior-dev's invariant:
//
//   > A stored doc edge must carry a recoverable source span and a deterministic resolution path
//   > to exactly one node.
//
// So the admission test is not "does this token look important" but "did the author write down
// something that identifies a path, and does that path resolve to exactly one indexed NODE".
// A Markdown link and a path-shaped inline-code span both meet it. A bare word never does.
//
// ⚠ "NODE", NOT "FILE" — AND THE WORD MATTERED. ef-manager measured the 480 admitted edges by
// target type: File 303, Document 80, Config 64, DIRECTORY 31, Entrypoint 2. The contract said
// "file" while the code admitted five types, so 6.5% of edges broke a promise nobody had noticed
// making. Directories stay IN — `docs/THE-GOAL.md` writing `` `docs/` `` means the directory, and
// "the specs live in docs/superpowers/specs/" is a real authored pointer — so the DESCRIPTION was
// the wrong half. The admitted types are named in FILE_LEVEL_PRECEDENCE below and pinned by test,
// so widening the set is a reviewed event rather than something a reader discovers in the field.
//
// ⚠ FENCED CONTENT IS EXCLUDED, DELIBERATELY, and that is part of the contract rather than an
// implementation detail. Inside ``` a Markdown link is literal text and a backtick pair is not an
// inline-code span; a mocked output block shows a shape, it does not make a reference. Measured:
// of 480 admitted edges 0 came from inside a fence, and every hand-graded candidate recall-miss
// was inside one. Fenced spans are counted under `fencedExample` so the exclusion is visible in
// the ledger instead of being invisible in both the edges and the misses.
//
// ⭐ THIS EMITS `LINKS_TO` (Document → File), NOT `MENTIONS` (Document → Symbol). dev was explicit
// that these are different relations with different authority and must not share a name: a link
// to a file is an authored pointer; a symbol mention is an inference about prose. Rules 2–4
// (qualified references, invocation-shaped tokens in code context, path-scoped symbols) will emit
// symbol edges under their own extractor tags in later slices.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILE_LEVEL_TYPES as FILE_LEVEL_TYPES_REGISTRY } from '../storage/taxonomy.js';

// Every rule that can admit an edge here, with the confidence it carries. Frozen so a caller
// cannot widen the vocabulary at runtime — the reader must be able to enumerate what could have
// produced any edge they are looking at.
export const DOC_LINK_RULES = Object.freeze({
  // An authored Markdown link. The strongest evidence available in a document: the author typed a
  // target, not just a word that collided with one.
  'doc_link:markdown': 0.95,
  // Inline code containing something path-shaped. Weaker than a link — the author marked it as
  // code but did not make it a pointer — yet still an explicit path, not a prose collision.
  'doc_link:inline-path': 0.85,
  // ⛔ TIER 2 IS A DIFFERENT RULE AND IT SHIPPED UNDER TIER 1'S TAG.
  //
  // Tier 1 resolves an EXACT path — anchored at the repo root or at the document's own directory.
  // Tier 2 resolves a BARE BASENAME when exactly one indexed file happens to carry it. Those are
  // not the same claim, and folding them under one tag let the weaker one inherit 0.85.
  //
  // MEASURED on this repo:
  //
  //     tier 1, exact path              734
  //     tier 2 via an authored LINK       0   <- the population tier 2 was BUILT for
  //     tier 2 via INLINE CODE          205
  //
  // ⚠ THE JUSTIFICATION IN ITS OWN DOCSTRING HAS ZERO INSTANCES. Tier 2 exists "for
  // `[helper](helper.js)` where neither anchoring hit" — and not one authored link in this corpus
  // uses it. It fires 205 times for a case it was not designed for.
  //
  // ★ AND ONE THIRD OF THAT IS A SINGLE FALSE-POSITIVE CLASS. ef-manager graded the newly-admitted
  // SKILL.md edges and found 27 pointing at `tests/fixtures/code-intel/cpp-fixture-repo/
  // compile_commands.json`, from lines like "when a C++ repo has `compile_commands.json`". A
  // GENERIC FILENAME — a build-system convention naming a file in the READER'S repo — resolved to
  // the one file in this corpus that happens to bear the name, which is a test fixture. 65
  // occurrences of that basename alone.
  //
  // The reference is real and the target is wrong, and it resolves "uniquely" only because the
  // corpus is small. That is the same defect as rule 3's uniqueness being a property of the
  // REPOSITORY rather than of the writing — so it gets the same treatment: its own tag, its own
  // confidence, and dev's floor enforced against it separately.
  'doc_link:inline-basename': 0.6,
});

const EXTRACTOR_PREFIX = 'doc_link:';

// `[text](target)` and `[text](target "title")`. Reference-style links (`[text][ref]`) are NOT
// handled here: their target lives in a definition elsewhere in the file, so admitting them needs
// a second pass. Not admitting them costs recall; admitting them by guessing would cost the
// invariant. Slice note, not an oversight.
const MD_LINK = /\[[^\]\n]*\]\(\s*([^()\s]+?)(?:\s+["'][^"']*["'])?\s*\)/g;
const INLINE_CODE = /`([^`\n]+)`/g;

// Anything with a scheme, a protocol-relative prefix, or a mail target is not a repository path.
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// ⚠ A PATH IS NOT "A STRING WITH A DOT IN IT". `e.g.` and `Node.js` are not paths. The test is:
// no whitespace, only path-legal characters, and EITHER a directory separator OR a short
// alphanumeric extension. Both halves are needed — `src/terrain` has no extension and `README.md`
// has no separator, and both are real.
const PATH_CHARS = /^[A-Za-z0-9._\-/@+]+$/;
const HAS_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

function isPathShaped(raw) {
  if (!raw || raw.length > 300) return false;
  if (!PATH_CHARS.test(raw)) return false;
  return raw.includes('/') || HAS_EXTENSION.test(raw);
}

// ⛔ A SPAN THAT NAMES NO SEGMENT IS NOT A PATH, AND `/` PROVED IT THE HARD WAY.
//
// ef-manager found this on the real graph: documents about path handling write `` `/` `` and
// `` `./` `` in inline code while DESCRIBING syntax, and `/` is path-shaped (it contains a
// separator), normalises to nothing, and is then joined onto the document's own directory by the
// relative anchoring — so `docs/x.md` writing `` `/` `` emitted an edge to `docs`.
//
// ⚠ The old `raw === '.' || raw === '..'` guard was DEAD: neither has a separator or an
// extension, so neither was ever a candidate. It looked like this rule and was not.
//
// ⚠ And the error rate concentrates in documents about paths — which in a repo that resolves
// paths means it correlates with the project's own subject matter, not with anything random. An
// error class that tracks what the codebase is about cannot be estimated from that codebase.
const namesNoSegment = (spec) =>
  !String(spec).split('/').some((seg) => seg && seg !== '.' && seg !== '..');

// Normalise to the repo-relative posix form the `nodes.file_path` column stores: forward slashes,
// no leading `./`, `..` segments folded. Returns null when the path escapes the repo root, which
// is a resolution failure and not a path.
function normalize(path) {
  const parts = String(path).replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (out.length === 0) return null; out.pop(); continue; }
    out.push(part);
  }
  return out.length ? out.join('/') : null;
}

const dirOf = (filePath) => {
  const i = String(filePath).replace(/\\/g, '/').lastIndexOf('/');
  return i === -1 ? '' : filePath.slice(0, i);
};

// ── Resolution ───────────────────────────────────────────────────────────────────────────────

// ⛔ "FILE NODE" IS NOT THE SAME AS `type = 'File'`, AND ASSUMING IT WAS COST THE WHOLE FEATURE.
// The first version of this module indexed `type = 'File'` only. Measured against the real graph:
// EVERY `.md` path in this repo is a `Document` node and never a `File` node, so 0 of 68 authored
// Markdown links resolved, and all 252 doc→doc references were counted as misses. Doc→doc is the
// single most valuable edge for "this decision came from that doc" — the feature was structurally
// incapable of the case it was built for, while its unit tests were green, because the fixture
// created File nodes and the real indexer does not.
//
// ⇒ Derived from the graph, not from a guess: the node types that are one-per-file are File (558),
// Document (74), Config (54), Entrypoint (7) and Directory (567). Everything else — Function,
// Module, Method — repeats a path.
//
// ⚠ AND THEY OVERLAP, SO PRECEDENCE IS DECLARED RATHER THAN INCIDENTAL. Six paths in this repo
// carry both `Entrypoint` and `File`. A `Map` that keeps whatever it saw first would resolve those
// by row order — which is precisely the legacy extractor's first-wins bug, one level up, and it
// would have been invisible. `File` is the canonical whole-file node and wins.
// ⇒ MOVED TO THE REGISTRY. It was declared here first, and then `pull.js::detectNodeKind` was
// found making the identical `type = 'File'` assumption — 78 of 266 doc-edge targets answering
// "unresolved" about nodes that exist. A constant that two consumers need is a registry entry,
// not a local one, or the second consumer repeats the bug the first one fixed.
const FILE_LEVEL_PRECEDENCE = FILE_LEVEL_TYPES_REGISTRY;
const PRECEDENCE = new Map(FILE_LEVEL_PRECEDENCE.map((t, i) => [t, i]));

export const FILE_LEVEL_TYPES = FILE_LEVEL_PRECEDENCE;

export function buildIndex(fileNodes) {
  const byPath = new Map();       // exact repo-relative path → { id, rank }
  const bySuffix = new Map();     // basename → [node id, …]
  for (const n of fileNodes) {
    const p = normalize(n.file_path);
    if (!p) continue;
    const rank = PRECEDENCE.get(n.type) ?? Number.MAX_SAFE_INTEGER;
    const held = byPath.get(p);
    if (!held || rank < held.rank) byPath.set(p, { id: n.id, rank });

    // ⚠ Directories are reachable by an EXACT path only. A bare `helper` that happens to match a
    // directory somewhere is not evidence the author meant that directory, and tier 2 exists for
    // unambiguous bare filenames, not for guessing at tree structure.
    if (n.type === 'Directory') continue;
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (!bySuffix.has(base)) bySuffix.set(base, []);
    bySuffix.get(base).push(n.id);
  }
  return { byPath, bySuffix };
}

/**
 * Resolve a written path to exactly one indexed file node, or to null.
 *
 * ⛔ THE TIERS DO NOT VOTE AND THEY DO NOT FALL THROUGH ON AMBIGUITY. The legacy map picked the
 * first candidate for a duplicate label. Picking one of two is not a resolution, it is a coin toss
 * recorded as evidence — so a tier that produces more than one candidate REFUSES, and the weaker
 * tier below it never runs. Falling through would let a precise-but-ambiguous signal be silently
 * replaced by a vaguer one that happens to be unique.
 *
 * Tier 1 — exact, relative to the document's own directory, and relative to the repo root. Both
 *   are how people actually write links, and neither is reliably distinguishable from the text.
 *   If the two land on DIFFERENT files the reference is genuinely ambiguous and is refused.
 * Tier 2 — basename match, for `[helper](helper.js)` where neither anchoring hit. Refused unless
 *   exactly one indexed file carries that basename.
 */
export function resolveDocPath(written, docPath, index) {
  const cleaned = String(written).split('#')[0].split('?')[0].trim();
  if (!cleaned) return null;

  const candidates = new Set();
  const rootRel = normalize(cleaned);
  if (rootRel && index.byPath.has(rootRel)) candidates.add(index.byPath.get(rootRel).id);
  const docRel = normalize(join(dirOf(docPath), cleaned).replace(/\\/g, '/'));
  if (docRel && index.byPath.has(docRel)) candidates.add(index.byPath.get(docRel).id);
  if (candidates.size === 1) return { id: [...candidates][0], tier: 1 };
  if (candidates.size > 1) return null;             // two anchorings, two files — refuse

  const base = (rootRel ?? cleaned).split('/').pop();
  const bySuffix = index.bySuffix.get(base);
  // ⚠ Only bare basenames fall to tier 2. `src/deleted-yesterday.js` failing tier 1 means that
  // exact path is not indexed; letting it match any file with that basename anywhere would be
  // resolving a path the author did not write.
  if (!bySuffix || cleaned.includes('/')) return null;
  if (bySuffix.length !== 1) return null;
  // ⚠ TIER 2 IS REPORTED AS TIER 2. The caller decides what a basename match is worth; this
  // function's job is to resolve and to say HOW. Returning the two tiers as one value is what let
  // a much weaker rule ship under a stronger rule's confidence for a day.
  return { id: bySuffix[0], tier: 2 };
}

/**
 * Classify one written target. THE SINGLE GATE — resolution, externality and failure are decided
 * here and nowhere else.
 *
 * ⛔ THIS EXISTS BECAUSE THE EXTERNAL CHECK WAS UNREACHABLE. A mutation battery removed
 * `EXTERNAL.test()` from the resolver and all twelve tests stayed green: a URL was already being
 * refused by the tier-2 slash guard and by `PATH_CHARS` rejecting `:`. So the module carried a
 * guard nobody could reach, and the comment above it claimed a protection the tests did not hold.
 * An unreachable guard is not defence in depth, it is an untested claim.
 *
 * ⭐ AND SEPARATING THE OUTCOMES FIXES A DISHONEST COUNTER. Folding URLs into `unresolved`
 * conflates "the author deliberately pointed outside this repo" — which is not a gap and never
 * will be — with "the author wrote a repo-shaped path we could not resolve", which IS a gap and
 * is the number worth acting on. One statistic covering both can only ever be read as the wrong
 * one, in the direction that makes coverage look worse than it is and hides real misses inside
 * expected noise.
 */
export function classifyTarget(written, docPath, index) {
  const cleaned = String(written).split('#')[0].split('?')[0].trim();
  if (!cleaned) return { kind: 'unresolved', reason: 'not_a_file_reference' };
  if (EXTERNAL.test(cleaned)) return { kind: 'external' };
  // Before resolution, not inside it: a span naming no segment must never reach the anchoring
  // step, because that step is what turns "nothing" into "the document's own directory".
  if (namesNoSegment(cleaned)) return { kind: 'unresolved', reason: 'not_a_file_reference' };
  const hit = resolveDocPath(cleaned, docPath, index);
  if (hit) return { kind: 'resolved', id: hit.id, tier: hit.tier };

  // ⛔ MY OWN COUNTER REPRODUCED THE DEFECT IT WAS BUILT TO FIX. Having just split `external` out
  // of `unresolved` on the grounds that one number covering two causes can only be read as the
  // wrong one, I measured the result and found `unresolved` doing exactly the same thing: of 1178
  // on this repo, 262 were tokens like `tools/call` and `npm run build` — path-SHAPED prose that
  // was never a claim about a file. Reporting those as a coverage gap inflates the gap and buries
  // the real misses inside it, which is the failure mode in the other direction.
  //
  // ⇒ A miss states its cause. `no_such_path` is the number worth acting on: the author wrote
  // something with a file extension and we could not find it.
  return {
    kind: 'unresolved',
    reason: HAS_EXTENSION.test(cleaned) ? 'no_such_path' : 'not_a_file_reference',
  };
}

// ── Scanning ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every path reference authored in a document, with the rule that saw it and its 1-based line.
 *
 * ⚠ FENCED BLOCKS ARE SKIPPED. Inside ``` a Markdown link is literal text and a backtick pair is
 * not an inline-code span, so scanning them would parse a different grammar than the one written.
 * This costs real references in code examples; rule 3 (invocation-shaped tokens in code context)
 * is where fenced content is admitted, under evidence appropriate to it.
 */
export function scanDocReferences(content) {
  const found = [];
  let fenced = false;
  const lines = String(content).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }

    // ⚠ FENCED SPANS ARE STILL FOUND, THEN MARKED — they used to be skipped outright.
    //
    // ef-manager, measuring the corpus: "a fenced path is invisible in every counter you have —
    // it is neither an edge nor a miss." The exclusion is right and stays; what was wrong is that
    // it happened before anything could count it, so a whole category of authored path lived
    // outside the accounting. A category that exists in the code and not in the ledger is how a
    // denominator goes wrong quietly.
    //
    // They also measured that the exclusion is doing real work: of 480 admitted edges, 0 came
    // from inside a fence, and every candidate recall-miss they hand-graded was inside one —
    // mocked output blocks showing a shape rather than making a reference.
    for (const m of line.matchAll(MD_LINK)) {
      found.push({ written: m[1], rule: 'doc_link:markdown', line: i + 1, fenced });
    }
    for (const m of line.matchAll(INLINE_CODE)) {
      const raw = m[1].trim();
      if (isPathShaped(raw) && !EXTERNAL.test(raw)) {
        found.push({ written: raw, rule: 'doc_link:inline-path', line: i + 1, fenced });
      }
    }
  }
  return found;
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild every LINKS_TO edge this extractor owns. Source is a Document; target is any one of
 * FILE_LEVEL_PRECEDENCE — File, Document, Config, Entrypoint or Directory.
 *
 * ⛔ IT DELETES FIRST. dev: "INSERT OR IGNORE alone will preserve the poison forever." The unique
 * index makes re-insertion idempotent but says nothing about edges a RETIRED rule wrote — those
 * survive every subsequent run and no amount of tightening the admission rule removes them. An
 * extractor owns its output, so it clears its own tag before writing. The delete is keyed on the
 * `doc_link:` prefix, so it never touches another extractor's edges.
 */
export async function detectDocLinks(db, repoRoot) {
  db.run(`DELETE FROM edges WHERE relation = 'LINKS_TO' AND extractor LIKE '${EXTRACTOR_PREFIX}%'`);

  const docs = db.all("SELECT id, file_path FROM nodes WHERE type = 'Document'");
  const empty = {
    added: 0, documents: 0, documentsWithLinks: 0,
    external: 0, noSuchPath: 0, notAFileReference: 0, fencedExample: 0, misses: [],
  };
  if (docs.length === 0) return empty;

  const types = FILE_LEVEL_TYPES.map((t) => `'${t}'`).join(', ');
  const index = buildIndex(db.all(
    `SELECT id, type, file_path FROM nodes WHERE type IN (${types}) AND file_path != ''`));
  let added = 0;
  let documentsWithLinks = 0;

  // ⛔ A COUNT IS UNFALSIFIABLE FROM OUTSIDE, and ef-manager was blocked by exactly that: "the
  // manifest stores counts and not the misses themselves — I can see how many landed in each,
  // never which." 707 `noSuchPath` could be 707 genuine stale references or 707 mis-bucketed
  // prose tokens, and the number reads identically either way.
  //
  // ⚠ AND THE COUNTERS ARE DERIVED FROM THIS LIST RATHER THAN INCREMENTED BESIDE IT. Two tallies
  // maintained in parallel can drift, and then a grader who audits a sample is certifying a
  // number those records do not add up to — a receipt for a claim nobody made. One pass, one
  // list, counts computed from it at the end.
  const misses = [];

  for (const doc of docs) {
    let content;
    try {
      content = await readFile(join(repoRoot, doc.file_path), 'utf8');
    } catch {
      continue;                                     // unreadable document — nothing to claim
    }

    // ⚠ One edge per (document, file) pair, carrying the FIRST occurrence's line and rule. The
    // unique index would collapse repeats anyway, but silently and in whatever order SQLite saw
    // them — so the span a reader is sent to would depend on insertion order. Choosing the first
    // occurrence explicitly makes the recorded span reproducible.
    const best = new Map();
    for (const ref of scanDocReferences(content)) {
      // Every outcome that is not an edge lands in the ledger with the span, the line and the
      // rule that produced it — so a reader can open the document at that line and grade it.
      const note = (bucket) => {
        misses.push({ doc: doc.file_path, written: ref.written, line: ref.line, rule: ref.rule, bucket });
      };
      // The exclusion is unchanged — a fenced span never becomes an edge. It is now RECORDED
      // rather than dropped before anything could see it.
      if (ref.fenced) { note('fenced_example'); continue; }
      const verdict = classifyTarget(ref.written, doc.file_path, index);
      if (verdict.kind === 'external') { note('external'); continue; }
      if (verdict.kind === 'unresolved') { note(verdict.reason); continue; }
      if (verdict.id === doc.id) continue;          // a document does not link to itself
      // ⛔ THE TIER DECIDES THE TAG, NOT THE SPAN THAT CARRIED IT. A markdown link that only
      // resolved by basename is still a basename resolution; calling it `doc_link:markdown`
      // because of how it was written would put 0.95 on a 0.6 claim. The SPAN says how the author
      // wrote it; the TIER says how confidently we found it, and the weaker of the two governs.
      const rule = verdict.tier === 2 ? 'doc_link:inline-basename' : ref.rule;
      if (!best.has(verdict.id)) best.set(verdict.id, { ...ref, rule });
    }

    if (best.size > 0) documentsWithLinks++;

    for (const [targetId, ref] of best) {
      db.run(
        `INSERT OR IGNORE INTO edges
           (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
         VALUES ($from_id, $to_id, 'LINKS_TO', $source_file, $source_line, $confidence,
                 'INFERRED', $extractor)`,
        {
          from_id: doc.id,
          to_id: targetId,
          source_file: doc.file_path,
          source_line: ref.line,
          confidence: DOC_LINK_RULES[ref.rule],
          extractor: ref.rule,
        },
      );
      added++;
    }
  }

  // ⚠ `documents` IS THE ADMITTED CORPUS, NOT THE REPOSITORY'S MARKDOWN. ef-manager composed the
  // real figure end to end on this repo: 150 tracked .md → 71 Document nodes (47.3%, the
  // ingest/sweep.js allowlist) → 59 emitting a link (83.1% of survivors) = 39.3% of the repo's
  // markdown reachable through this layer. "83% of documents link out" and "39% of the markdown
  // is reachable" describe the same system and imply completely different next actions, and only
  // the second answers "will this find the doc I forgot".
  //
  // ⇒ `documentsWithLinks / documents` is emitted here so nobody has to recompute it from the
  // edge count. The THIRD term — how much markdown never became a node — is not knowable from
  // this module, which only ever sees nodes. It belongs to the sweep, and until the corpus fix
  // lands this ratio must not be quoted as repository coverage.
  const tally = (bucket) => misses.reduce((n, m) => n + (m.bucket === bucket ? 1 : 0), 0);
  return {
    added,
    documents: docs.length,
    documentsWithLinks,
    // Derived from `misses`, never incremented alongside it. See the note where `misses` is
    // declared: parallel tallies drift, and a drifted count turns a graded sample into a
    // certification of the wrong number.
    external: tally('external'),
    noSuchPath: tally('no_such_path'),
    notAFileReference: tally('not_a_file_reference'),
    fencedExample: tally('fenced_example'),
    misses,
  };
}
