// Resolve one dashboard watch anchor against this repository, honestly.
//
// The dashboard's code-graph seam asks a provider one question per anchor and accepts four answers —
// `changed`, `gone`, `unchanged`, `restamp` — or `unwatched` with a reason for an anchor the provider did not
// look at. This module decides which one is true, and refuses where it cannot tell.
//
// ⛔⛔ THE FAILURE THIS EXISTS TO AVOID: correct but wrong — the code is proven and the thing it was built
// for never happens. Their seam is green and has never had a real provider. So every answer here is about
// something APG OBSERVED, and where it cannot observe, the answer is `unwatched` carrying a reason an
// operator can act on, never a confident `unchanged`.
//
// ⛔⛔ THREE PATHS PRODUCE COVERAGE IN THIS REPO, NOT ONE. I nearly shipped this routed on `getLanguageConfig`
// alone, which is the same defect I had just corrected in a measurement: ONE PREDICATE FOR A QUESTION
// PRODUCED BY THREE PATHS (it made a 1.7% figure read as 42%). MEASURED 2026-09-30 with a live probe
// (`docs/evidence/dashboard-seam-2026-09-30/`):
//     getLanguageConfig('AGENTS.md')      THROWS            — yet AGENTS.md HAS a Document node
//     getLanguageConfig('.gitattributes') THROWS            — and .gitattributes has NO node at all
// So the code extractor's refusal does NOT mean the file is uncovered. `resolveAnchor` asks the code path,
// then the document path, and only then reports an absence.
//
// ⛔ AN ABSENCE HAS NO SKIP RECORD. Files the code extractor never sees are filtered out before any
// extractor runs, so `skippedFiles` is EMPTY for them: there was no skip, there was an absence. A provider
// consulting that list would find it empty and conclude coverage. ⇒ Every reason below is derived HERE, from
// the thing that decides, never from a record of what was decided.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * The stamp format, PER ANCHOR rather than per batch.
 *
 * Confirmed against their storage rather than inferred: `provider/stamps.ts:27` stores
 * `watch_id, hash, stamp_version, commit_sha` — one row per watch id, each with its own version. So a doc
 * link-set stamp and a code fingerprint stamp travel in the SAME batch, and the coverage rule never forces a
 * split. I had designed around a constraint that does not exist; they would rather have been asked.
 *
 * ⛔ BUMP A VERSION WHEN WHAT IT HASHES CHANGES. The seam then reports `restamp` rather than flipping every
 * anchor to `changed` at once — the day the page says the whole repository moved and nothing did.
 */
export const STAMP_VERSIONS = Object.freeze({
  code: 'apg-file-structural-1',
  symbol: 'apg-symbol-shape-1',
  doc: 'apg-doc-linkset-1',
});

/** Reasons an anchor goes unwatched. Each names what was not looked at, and why, in an operator's terms. */
export const UNWATCHED_REASONS = Object.freeze({
  unhandled_language: 'aify-project-graph has no code extractor and no document handler for this file type, '
    + 'so it was never read — this is an absence of coverage, not a clean result',
  symbol_kind_not_modelled: 'the file parses and is covered, but aify-project-graph extracted NO symbols '
    + 'from it at all, so it cannot tell a deleted symbol from one it never models (it models functions, '
    + 'including const-assigned arrows; it does not model data constants) — refusing rather than reporting '
    + 'this anchor as gone',
  too_large: 'file exceeds the extraction size cap and is absent from the graph by design',
  unparseable: 'the parser failed on this file, so its symbols are absent rather than proven absent',
  unsupported_anchor_kind: 'this provider resolves whole-file anchors (kind "module" or "file") and '
    + 'kind "symbol"; it cannot honestly resolve this anchor kind and has not guessed at what its author '
    + 'meant',
  no_path: 'the anchor carries no usable repo-relative path, so there is nothing to resolve it against',
});

// The extraction cap the orchestrator enforces. Named once so the reason string and the check cannot disagree.
const SIZE_CAP_BYTES = 1_000_000;

/**
 * Anchor kinds that mean "the whole file".
 *
 * ⛔ THE SERVICE DOES NOT CONSTRAIN ANCHOR KINDS — `WatchItem.anchor` is `Record<string, unknown>`, so the
 * vocabulary is whatever the person anchoring a node wrote in the document. MEASURED against the live set
 * 2026-09-30: `module` (4 anchors), `symbol` (1), `file` (2). I had assumed `module` from a description in
 * prose and would have refused both `file` anchors, including a document the doc path covers — caught by
 * dry-running against the real set rather than by re-reading my own code.
 *
 * ⇒ Because the vocabulary is open, a kind this provider does not know MUST come back as an explicit refusal
 * naming the kind. Guessing "probably the whole file" would put a verdict on a page for an anchor whose
 * author meant something else.
 */
const WHOLE_FILE_KINDS = Object.freeze(['module', 'file']);

// Types the extractor emits for the FILE itself rather than for a symbol in it. Anything else is a symbol.
// ⚠ Used as a COMPLEMENT rather than listing the symbol types, so a new symbol type counts as a symbol here
// without an edit — a list you must remember to update is a defect with a delay on it.
const FILE_LEVEL_TYPES = Object.freeze(['File', 'Module', 'Directory', 'Document', 'Config', 'Repository']);

/**
 * What APG can honestly claim. `exhaustive` is FALSE, and not as a hedge: the fingerprint covers what the
 * extractor MODELS, not everything in the file, so a change to an unmodelled construct fingerprints
 * identically and would report `unchanged`. `compile-db.js:1134` records a shipped false-exhaustive in this
 * repo (exhaustive:true while clangd returned 3 of 8 callers), which is why the flag is never granted from a
 * parse alone.
 */
export const EXTRACTED_TRUST = Object.freeze({ provenance: 'EXTRACTED', exhaustive: false });

/**
 * Is this path present, spelled EXACTLY as given?
 *
 * ⛔ NOT `existsSync`: on Windows it is CASE-INSENSITIVE, so after `git mv middle.js Middle.js` it answers
 * TRUE for the stale spelling, which is how a live phantom survived in this repo until 27c5c422. Comparing
 * each segment against its parent's LISTING cannot be fooled by anything the filesystem merely resolves,
 * because resolution is exactly what a listing does not do.
 *
 * ⚠ Deliberately NOT imported from the freshness layer: this is the provider's independent check on the same
 * question the indexer answers, and a shared implementation cannot disagree with itself. Duplication for
 * independence is not duplication — the test is "would you still want the second one if the first were
 * correct", and here the answer is yes.
 */
export function presentWithExactCase(repoRoot, relPath) {
  const segments = String(relPath).split(/[\\/]+/u).filter((s) => s && s !== '.');
  if (segments.length === 0) return false;
  let parent = repoRoot;
  for (const segment of segments) {
    try {
      if (!readdirSync(parent).includes(segment)) return false;
    } catch {
      return false; // A parent that cannot be listed cannot contain the child. FAIL CLOSED.
    }
    parent = join(parent, segment);
  }
  return true;
}

/**
 * The set of things a document points at, order-insensitive and position-free.
 *
 * ⚠ FENCED REFERENCES ARE EXCLUDED, matching what the doc layer admits as an edge. Including them would make
 * the stamp fire on edits to code examples, which is prose-level change detection — explicitly not wanted:
 * a mark that fires on every wording change is a mark nobody reads within a week. A typo fix must not report
 * `changed`; a document that has stopped pointing where it used to must.
 */
export function docLinkSet(references) {
  return [...new Set((references ?? []).filter((r) => !r.fenced).map((r) => String(r.written)))].sort();
}

/**
 * Resolve one anchor. Returns `{ kind: 'result', row }` or `{ kind: 'unwatched', row }` — never both, never
 * neither, because the seam requires every watchId to appear exactly once across its two arrays.
 *
 * @param deps.languageOf      (relPath) => config, throwing when there is no code extractor
 * @param deps.isDocument      (relPath) => boolean, the SAME predicate the indexer uses
 * @param deps.readSource      (relPath) => string
 * @param deps.extract         ({ relPath, source, config }) => extracted
 * @param deps.fileFingerprint (extracted) => string
 * @param deps.docReferences   (source) => [{ written, fenced }]
 */
export function resolveAnchor({ repoRoot, item, deps }) {
  const { watchId, anchor, stamp } = item;
  const relPath = typeof anchor?.path === 'string' ? anchor.path.trim() : '';
  const kind = anchor?.kind;

  if (relPath === '') return unwatched(watchId, 'no_path');
  const wholeFile = WHOLE_FILE_KINDS.includes(kind);
  if (!wholeFile && kind !== 'symbol') return unwatched(watchId, 'unsupported_anchor_kind');

  // ⛔ GONE IS DECIDED FIRST, AND BY THE FILESYSTEM RATHER THAN THE GRAPH. A graph that has not been
  // reindexed still holds nodes for a deleted file; the tree is what is true now.
  if (!presentWithExactCase(repoRoot, relPath)) {
    return decide(watchId, stamp, STAMP_VERSIONS[kind === 'symbol' ? 'symbol' : 'code'], null, {
      gone: true,
      evidence: `${relPath} is not present in the working tree — checked segment by segment against each `
        + 'parent directory listing, not with a case-insensitive existence test',
    });
  }

  let source;
  try {
    source = deps.readSource(relPath);
  } catch {
    return unwatched(watchId, 'unparseable');
  }
  if (Buffer.byteLength(source, 'utf8') > SIZE_CAP_BYTES) return unwatched(watchId, 'too_large');

  let config = null;
  try {
    config = deps.languageOf(relPath);
  } catch {
    config = null;
  }

  // ── The document path. Asked BEFORE reporting an absence, because the code extractor's refusal is not a
  // statement about coverage — AGENTS.md throws there and still has a Document node.
  if (config === null) {
    if (kind === 'symbol') return unwatched(watchId, 'unsupported_anchor_kind');
    if (!deps.isDocument(relPath)) return unwatched(watchId, 'unhandled_language');
    const links = docLinkSet(deps.docReferences(source));
    return decide(watchId, stamp, STAMP_VERSIONS.doc, hashOf(links), {
      evidence: `link set of ${relPath}: ${links.length} distinct non-fenced references `
        + '(sorted, so reordering is not a change; positions excluded, so moving text is not a change)',
    });
  }

  // ── The code path.
  let extracted;
  try {
    extracted = deps.extract({ relPath, source, config });
  } catch {
    // ⛔ A PARSE FAILURE IS `unwatched`, NEVER `changed`. "The parser broke" and "the code changed" are
    // different observations, and reporting the first as the second puts a mark on the page for a reason
    // that is about this provider rather than about the repository.
    return unwatched(watchId, 'unparseable');
  }

  if (wholeFile) {
    return decide(watchId, stamp, STAMP_VERSIONS.code, deps.fileFingerprint(extracted), {
      evidence: `structural fingerprint of ${relPath} — signatures, members, imports and the outgoing target `
        + 'set, with line numbers excluded, so moving or commenting code is not a change (verified both '
        + 'directions: a comment-only edit leaves it equal, renaming an exported function changes it)',
    });
  }

  // ── A symbol anchor, and THE POPULATION COMES FIRST.
  const symbols = (extracted?.nodes ?? []).filter((n) => !FILE_LEVEL_TYPES.includes(n.type));
  const name = String(anchor.name ?? '').trim();
  // ⛔⛔ AN EMPTY SYMBOL LIST IS A SILENT INSTRUMENT, NOT AN EMPTY REPOSITORY. MEASURED: taxonomy.js yields
  // 2 nodes and ZERO symbols, because it is entirely data constants; fingerprint.js yields 7 symbols. So
  // "NODE_TYPES is not among the symbols of taxonomy.js" is true and means NOTHING about whether it exists —
  // it is at taxonomy.js:85 right now. Reporting `gone` would assert a deletion that never happened, and an
  // operator would go looking for it. A CHECK THAT CANNOT TELL WHICH OF TWO WORLDS IT IS IN MUST NOT REPORT
  // EITHER.
  if (symbols.length === 0) return unwatched(watchId, 'symbol_kind_not_modelled');

  const match = symbols.find((n) => n.label === name || n.extra?.qname === name);
  if (!match) {
    // The instrument demonstrably speaks here — it found other symbols in this very file — so an absence is
    // now evidence rather than silence.
    return decide(watchId, stamp, STAMP_VERSIONS.symbol, null, {
      gone: true,
      evidence: `${name} is not among the ${symbols.length} symbols extracted from ${relPath} `
        + `(${symbols.slice(0, 8).map((n) => n.label).join(', ')}) — the extractor does model symbols in `
        + 'this file, so its absence here is evidence rather than silence',
    });
  }
  return decide(watchId, stamp, STAMP_VERSIONS.symbol, hashOf([match.structural_fp, match.dependency_fp]), {
    evidence: `shape of ${name} in ${relPath}: signature, decorators, parent class and node type, plus its `
      + 'outgoing call/reference/type/import set. ⚠ THE BODY IS NOT HASHED — a rewrite that changes no '
      + 'signature and no outgoing call reports `unchanged`, which is why trust.exhaustive is false',
  });
}

/**
 * Turn a fresh observation into the seam's verdict, given what it had stored.
 *
 * ⛔ NO BASELINE IS `restamp`, NOT `changed`. A null stamp means the service never recorded one, so there is
 * nothing to have changed FROM; reporting `changed` would mark every anchor on the first sweep. Same one step
 * out: a stamp in a format this provider no longer produces cannot be compared, so it re-baselines.
 */
function decide(watchId, stamp, stampVersion, hash, { evidence, gone = false }) {
  if (gone) return result(watchId, 'gone', { evidence, trust: EXTRACTED_TRUST });
  const base = { evidence, trust: EXTRACTED_TRUST, stamp: { hash, stampVersion } };
  if (stamp === null || stamp === undefined) {
    return result(watchId, 'restamp', { ...base, evidence: `first baseline for this anchor — ${evidence}` });
  }
  if (stamp.stampVersion !== stampVersion) {
    return result(watchId, 'restamp', {
      ...base,
      evidence: `stored baseline was stamped ${stamp.stampVersion}, this provider stamps ${stampVersion}, so `
        + `the two are not comparable and this re-baselines rather than claiming a change — ${evidence}`,
    });
  }
  if (stamp.hash === hash) return result(watchId, 'unchanged', base);
  return result(watchId, 'changed', {
    ...base,
    evidence: `${evidence}. Baseline was ${stamp.hash} at ${stamp.commit ?? 'an unrecorded commit'}`,
  });
}

function hashOf(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function result(watchId, status, extra) {
  return { kind: 'result', row: { watchId, status, ...extra } };
}

function unwatched(watchId, reasonKey) {
  const reason = UNWATCHED_REASONS[reasonKey];
  // ⛔ FAIL LOUDLY ON AN UNKNOWN KEY. The seam refuses an empty reason, and an anchor skipped for a reason
  // nobody recorded reads as a bug in THEIR service. A typo here would become that bug, in their UI, with
  // their name on it.
  if (typeof reason !== 'string' || reason === '') {
    throw new Error(`anchor-resolver: no reason string for "${reasonKey}" — refusing to send an empty reason`);
  }
  return { kind: 'unwatched', row: { watchId, reason } };
}

/**
 * Split resolved anchors into the seam's two arrays and PROVE the split is complete.
 *
 * ⛔ COVERAGE IS CHECKED HERE TOO, not only by them. Their `incomplete_batch` refusal is the backstop, and a
 * provider that relies on the backstop to notice its own gaps is one that ships a partial sweep and finds out
 * from a 409. Every watchId in, exactly once out.
 */
export function splitBatch(resolved, expectedWatchIds) {
  const results = [];
  const unwatchedRows = [];
  for (const r of resolved) {
    if (r.kind === 'result') results.push(r.row);
    else unwatchedRows.push(r.row);
  }
  const seen = [...results, ...unwatchedRows].map((r) => r.watchId);
  const missing = expectedWatchIds.filter((w) => !seen.includes(w));
  const duplicated = seen.filter((w, i) => seen.indexOf(w) !== i);
  return {
    results,
    unwatched: unwatchedRows,
    complete: missing.length === 0 && duplicated.length === 0,
    missing,
    duplicated,
  };
}
