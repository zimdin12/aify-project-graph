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
// something that identifies a file, and does that something resolve to exactly one indexed file".
// A Markdown link and a path-shaped inline-code span both meet it. A bare word never does.
//
// ⭐ THIS EMITS `LINKS_TO` (Document → File), NOT `MENTIONS` (Document → Symbol). dev was explicit
// that these are different relations with different authority and must not share a name: a link
// to a file is an authored pointer; a symbol mention is an inference about prose. Rules 2–4
// (qualified references, invocation-shaped tokens in code context, path-scoped symbols) will emit
// symbol edges under their own extractor tags in later slices.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  if (raw === '.' || raw === '..') return false;
  return raw.includes('/') || HAS_EXTENSION.test(raw);
}

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
const FILE_LEVEL_PRECEDENCE = Object.freeze(['File', 'Document', 'Config', 'Entrypoint', 'Directory']);
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
  if (candidates.size === 1) return [...candidates][0];
  if (candidates.size > 1) return null;             // two anchorings, two files — refuse

  const base = (rootRel ?? cleaned).split('/').pop();
  const bySuffix = index.bySuffix.get(base);
  // ⚠ Only bare basenames fall to tier 2. `src/deleted-yesterday.js` failing tier 1 means that
  // exact path is not indexed; letting it match any file with that basename anywhere would be
  // resolving a path the author did not write.
  if (!bySuffix || cleaned.includes('/')) return null;
  return bySuffix.length === 1 ? bySuffix[0] : null;
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
  if (!cleaned) return { kind: 'unresolved', reason: 'empty' };
  if (EXTERNAL.test(cleaned)) return { kind: 'external' };
  const id = resolveDocPath(cleaned, docPath, index);
  if (id) return { kind: 'resolved', id };

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
    if (fenced) continue;

    for (const m of line.matchAll(MD_LINK)) {
      found.push({ written: m[1], rule: 'doc_link:markdown', line: i + 1 });
    }
    for (const m of line.matchAll(INLINE_CODE)) {
      const raw = m[1].trim();
      if (isPathShaped(raw) && !EXTERNAL.test(raw)) {
        found.push({ written: raw, rule: 'doc_link:inline-path', line: i + 1 });
      }
    }
  }
  return found;
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild every Document→File LINKS_TO edge this extractor owns.
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
  const empty = { added: 0, documents: 0, external: 0, noSuchPath: 0, notAFileReference: 0 };
  if (docs.length === 0) return empty;

  const types = FILE_LEVEL_TYPES.map((t) => `'${t}'`).join(', ');
  const index = buildIndex(db.all(
    `SELECT id, type, file_path FROM nodes WHERE type IN (${types}) AND file_path != ''`));
  let added = 0;
  let external = 0;
  let noSuchPath = 0;
  let notAFileReference = 0;

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
      const verdict = classifyTarget(ref.written, doc.file_path, index);
      if (verdict.kind === 'external') { external++; continue; }
      if (verdict.kind === 'unresolved') {
        if (verdict.reason === 'no_such_path') noSuchPath++; else notAFileReference++;
        continue;
      }
      if (verdict.id === doc.id) continue;          // a document does not link to itself
      if (!best.has(verdict.id)) best.set(verdict.id, ref);
    }

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

  return { added, documents: docs.length, external, noSuchPath, notAFileReference };
}
