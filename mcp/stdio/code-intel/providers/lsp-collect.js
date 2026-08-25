// Language-agnostic LSP collection engine.
//
// Drives any standard LSP server (documentSymbol → per-symbol definition /
// references / hover, plus per-file diagnostics) and emits the v0.2 collection
// envelope the importer consumes. The C++ provider keeps its own collect() (it
// needs compile-DB enumeration + unity/foreign handling + budget machinery);
// the TS and Python providers are thin wrappers around this engine, supplying a
// spawn config, a file enumerator, and the freshness basis.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LspClient } from '../lsp-client.js';
import { getHeadCommit } from '../../freshness/git.js';
import { findIdentifierPosition, leafNameOf, isAnonymousSymbolName } from '../identifier-position.js';
import { readLedger, writeLedger, pendingFiles, graphEvidenceWitness } from '../collect-ledger.js';

function realpath(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

// Relativize a server-returned file URI against the project root, reconciling
// Windows 8.3 short paths vs long paths (and case) by realpath-ing both sides.
/**
 * Repo-relative path for a URI, or `null` when the target is OUTSIDE the repository.
 *
 * ⛔ THIS FUNCTION LEAKED OUT-OF-REPO NODES INTO EVERY COLLECTED GRAPH, AND THE BUG WAS ALREADY
 * DOCUMENTED TEN LINES BELOW. The fallback read:
 *
 *     try { return toRepoRelative(uri, realRoot); } catch { return uri; }
 *
 * Two defects on one line. The arguments are REVERSED — the signature is
 * `toRepoRelative(projectRoot, filePath)` — so it always threw, with an error naming the repo root
 * as the path and the URI as the root. And the catch returned the INPUT, writing a raw
 * percent-encoded `file://` URI into `file_path`.
 *
 * MEASURED on click: pyright resolves `click` to the operator's INSTALLED site-packages copy and
 * reads its own bundled typeshed stubs, both legitimately outside the repository. The containment
 * check above correctly REJECTED them; this fallback then stored them verbatim. Six such nodes, and
 * zero in the four arms that ran no collection.
 *
 * ⇒ The guard was never the problem. What followed converted a correct refusal into an artifact.
 *
 * ⛔⛔ AND THE COMMENT AT `uriToRepoRelative` BELOW DESCRIBES THIS EXACT DEFECT — reversed
 * arguments, a `file://` URI where a path was expected — in a copy that was DELETED for being a
 * trap, while the live one ten lines above was left in place. It even explains why the dead copy
 * was harmless: "it was never called". That is the property this one did not have.
 * ⇒ The most accurate description of this bug in the repository sat ten lines from the bug and did
 * not prevent it. A comment is not an instrument; a test calling this with an out-of-repo URI is.
 *
 * ⚠ THE FALLBACK IS DELETED, NOT CORRECTED. With the arguments the right way round it throws for
 * exactly the same inputs — it can only succeed where the containment check already succeeded — so
 * it was dead weight whose sole effect was to produce the wrong answer.
 *
 * Returning `null` rather than a path makes the out-of-repo case UNIGNORABLE at every call site: a
 * caller must decide what to do instead of silently recording a URI.
 */
export function relativizeUri(uri, realRoot) {
  try {
    let p = String(uri).startsWith('file:') ? fileURLToPath(uri) : uri;
    p = realpath(p);
    // ⚠ THE ROOT IS CANONICALISED HERE TOO, NOT ONLY ASSUMED. The single caller passes an
    // already-realpath'd root, and the parameter name says so — but a caller that did not would get
    // SILENT TOTAL FAILURE: every path rejected as out-of-repo, no error, an empty collection that
    // looks like a repository with nothing in it.
    //
    // Found because a positive control failed. On Windows a temp dir is handed back as the 8.3 short
    // name `C:\Users\ADMINI~1\...` while its realpath is `C:\Users\Administrator\...`, so an
    // IN-REPO file compared against the raw root and was refused. realpath is idempotent, so this
    // costs one call and removes a trap that produces no diagnostic at all.
    const root = realpath(realRoot);
    const rel = path.relative(root, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/');
  } catch { /* not a usable path — treated as out-of-repo below */ }
  return null;
}

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}
function rangeFromLsp(range) {
  if (!range) return null;
  return { start: { line: range.start.line + 1, col: range.start.character + 1 }, end: { line: range.end.line + 1, col: range.end.character + 1 } };
}
// (Removed) `uriToRepoRelative` lived here with its arguments REVERSED —
// `toRepoRelative(uri, projectRoot)` — and passing a `file://` URI where a
// filesystem path was expected. It was never called, which is the only reason it
// never produced a wrong path. Deleted rather than corrected: a plausible-looking
// helper with inverted arguments is a trap for the next caller, and the correct
// implementation already exists as uriToRepoRelativeSafe in
// ingest/code-intel/paths.js.
//
// ⛔⛔ AND THE SAME BUG WAS LIVE TEN LINES ABOVE THIS NOTE FOR THE WHOLE TIME IT STOOD.
// `relativizeUri`'s fallback made the identical reversed call, and unlike this deleted helper it
// WAS called — on every definition and reference a language server returned. It leaked raw
// percent-encoded file:// URIs into `file_path` for anything resolving outside the repository.
//
// ⇒ This note diagnosed the defect precisely, explained why the dead copy was harmless, and did
// not prevent the live one. The author was reading the unused helper, not the used one.
// ⇒ A comment is not an instrument. See the tests for `relativizeUri`, which are.
function severityFromLsp(sev) {
  return ({ 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' })[sev] || 'info';
}
function symbolIdFor(file, line, col) {
  return `${file}:${line}:${col}`;
}

// Flatten DocumentSymbol[] (hierarchical, with .children) OR SymbolInformation[]
// (flat). tsserver/pyright return nested DocumentSymbols; clangd returns flat.
function flattenSymbols(symbols, out = []) {
  for (const s of symbols || []) {
    out.push(s);
    if (Array.isArray(s.children) && s.children.length) flattenSymbols(s.children, out);
  }
  return out;
}

// Derive the query position + body range for a symbol, normalizing the two LSP
// shapes (SymbolInformation has location.range only; DocumentSymbol has
// selectionRange at the identifier).
function positionFor(sym, projectRoot, rel, loadSourceLines) {
  if (sym.location && sym.location.range) {
    const bodyRange = sym.location.range;
    // Shared with the clangd provider. This used to be `declLine.indexOf(name)` —
    // the first SUBSTRING hit — which sent every request to the wrong token
    // whenever the name occurred inside a longer identifier on the same line
    // (`Builder Builder::build()`). See identifier-position.js.
    const found = findIdentifierPosition(loadSourceLines(), bodyRange.start.line, leafNameOf(sym.name));
    return {
      bodyRange,
      pos: { line: found.line, character: found.character },
      positionGuessed: found.guessed,
    };
  }
  const bodyRange = sym.selectionRange || sym.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  return { bodyRange, pos: bodyRange.start };
}

const DEFAULT_COLLECT_BUDGET_MS = 60000;
const DEFAULT_MAX_FILES = 200;

// ⛔ THE WALK BOUND IS NOT THE BATCH BOUND, AND CONFLATING THEM MADE RESUME A TREADMILL.
//
// `maxFiles` was passed to the ENUMERATOR, so the walk stopped at the first 200 files and the
// resume ledger was then subtracted from that truncated list. Once those 200 were collected, every
// later call enumerated the same 200, found nothing pending, and returned:
//
//     "nothing left to collect — all 200 enumerated file(s) are already recorded for this
//      configuration. The collection is COMPLETE; re-running is a no-op."
//
// Measured on this repo at dc26d13, by a loop written specifically to avoid being fooled:
//
//     first-party ts/js files    554
//     files with any records     210
//     files NEVER collected      352      <- and the run said CONVERGED
//
// ⇒ Resume could never advance past the cap. The 200 in `files_processed 200 / files_eligible 579`
// was never a choice the run made; it is the ceiling, reported as a total for the fifth time in
// this codebase — and this time my own recovery script believed it.
//
// So the walk gets its own ceiling, the ledger split happens over the WHOLE enumeration, and
// `maxFiles` caps the BATCH that is taken from what remains. Hitting the walk ceiling still marks
// the collection partial; it is a bound on one directory traversal, not on the corpus.
const ENUMERATION_CEILING = 20000;

// Shared with the clangd provider: a hub symbol's reference set is capped, and the
// cap is always reported on the record so a capped set reads as a FLOOR.
const MAX_REFS_PER_SYMBOL = 2000;

/**
 * Run a collection over a standard LSP server.
 * @param {object} o
 * @param {object} o.req            collect request ({ projectRoot, files?, scope?, operations?, maxFiles?, budgetMs? })
 * @param {string} o.language       'typescript' | 'python' | ...
 * @param {string} o.providerName
 * @param {string} o.providerVersion
 * @param {function} o.spawnFor     (projectRoot) -> { command, args }
 * @param {function} o.enumerateFiles (projectRoot, {maxFiles}) -> { files, stats }
 * @param {string} o.freshnessBasis 'tsconfig_hash' | 'mtime' | ...
 * @param {string} [o.freshnessValue]
 */
export async function collectViaLsp({ req, language, providerName, providerVersion, spawnFor, enumerateFiles, freshnessBasis, freshnessValue = '' }) {
  const collectionId = newCollectionId();
  const collectedAt = new Date().toISOString();
  const projectRoot = req.projectRoot;
  // Canonical root so server-returned URIs (which may use Windows 8.3 short
  // names or different casing) relativize cleanly.
  const realRoot = realpath(projectRoot);
  // HEAD at collect time so graph_health can detect commit-drift staleness.
  const indexedCommit = await getHeadCommit(projectRoot).catch(() => null);
  const envelopeBase = { schema_version: '0.2', collectionId, provider: providerName, providerVersion, projectRoot };
  const session0 = { collectedAt, indexedCommit, freshnessBasis, freshnessValue };

  // File resolution: explicit files[] wins; else enumerate for scope=all/changed.
  const maxFiles = Number.isFinite(req.maxFiles) ? req.maxFiles : DEFAULT_MAX_FILES;
  let files;
  let enumStats = null;
  // Resume bookkeeping — null for an explicit files[] request, which is the caller
  // stating what they want and must be honored verbatim.
  let ledger = null;
  let resumedFrom = 0;
  let enumeratedTotal = null;
  // Files this pass still owes AFTER the batch this call will process. Zero is convergence;
  // anything else is why the caller must come back.
  let batchRemainder = 0;
  if (req.files && req.files.length > 0) {
    files = req.files;
  } else if (req.scope === 'all' || req.scope === 'changed') {
    // Walk the whole corpus (up to the ceiling). The batch cap is applied further down, AFTER the
    // ledger has removed what previous batches already covered.
    const e = enumerateFiles(projectRoot, { maxFiles: ENUMERATION_CEILING });
    files = e.files; enumStats = e.stats;
    // REAL RESUME, same as the clangd path. Without this a budget-limited TS or
    // Python collection restarted at file 0 on every call — a warm redo, not a
    // continuation — and the budget-exhausted note promising otherwise was as
    // untrue here as it was for C++ before e341de0. The ledger module was already
    // language-agnostic; it had simply never been wired into this collector, so the
    // fix reached only one of three backends.
    //
    // Keyed by the freshness value (tsconfig hash / mtime basis) rather than a
    // compile-DB hash, which is this backend's equivalent notion of "the
    // configuration this coverage was gathered under".
    if (req.resume !== false) {
      // Same orphaning hazard as the clangd backend: a graph rebuild deletes the evidence and
      // leaves this ledger's claims about it intact, in a file that lives outside the database.
      ledger = readLedger(projectRoot, freshnessValue || freshnessBasis, graphEvidenceWitness(projectRoot));
      const split = pendingFiles(files, ledger);
      resumedFrom = split.alreadyCollected.length;
      enumeratedTotal = files.length;
      files = split.remaining;
    } else {
      enumeratedTotal = files.length;
    }
    // ⚠ THE BATCH CAP, APPLIED HERE AND NOWHERE EARLIER. `remaining` is what this pass still owes;
    // taking the first `maxFiles` of it is a batch, and the leftover is what makes the next call
    // productive instead of a no-op.
    if (files.length > maxFiles) {
      batchRemainder = files.length - maxFiles;
      files = files.slice(0, maxFiles);
    }
    enumStats = { ...enumStats, batch_cap: maxFiles, batch_remainder: batchRemainder };
  } else {
    return { ...envelopeBase, session: session0, operations: {}, status: 'ok',
      notes: [{ code: 'no_files', message: `no files to collect: pass files[] or scope=all/changed (scope was ${req.scope || 'unset'})` }],
      records: [] };
  }
  if (files.length === 0) {
    // ★ "NOTHING TO COLLECT" AND "ALREADY COLLECTED" ARE DIFFERENT ANSWERS.
    //
    // Found by dogfooding this collector on APG's own source: the second run
    // returned in 33ms with status ok and the note "no first-party source files
    // found to collect" — on a repo full of source. Resume had worked perfectly and
    // the remainder was legitimately empty, but the message asserted a cause that
    // was not true and every resume field came back undefined, so a caller could
    // not distinguish CONVERGED from BROKEN ENUMERATION.
    //
    // That is the same defect this pass has removed repeatedly: a message naming an
    // unverified cause, and a state the response could not express. It survived
    // because the early return predates resume and nobody re-read it after.
    const convergedByResume = resumedFrom > 0 || (enumeratedTotal != null && enumeratedTotal > 0);
    return {
      ...envelopeBase,
      session: {
        ...session0,
        enumeration: enumStats,
        filesProcessed: 0,
        filesTotal: 0,
        remaining: 0,
        // ⚠ NOT an unconditional `true`. If the WALK hit its ceiling there are files this pass was
        // never shown, and "nothing pending" describes the list rather than the repository.
        complete: !(enumStats && enumStats.truncated),
        resumedFrom,
        enumeratedTotal,
        resumeLedger: ledger ? 'active' : 'not_used',
      },
      operations: {},
      status: 'ok',
      notes: [convergedByResume
        ? {
          code: 'already_collected',
          message: `nothing left to collect — all ${resumedFrom || enumeratedTotal} enumerated file(s) are already recorded for this configuration. The collection is COMPLETE; re-running is a no-op.`,
          hint: 'pass resume:false to force a full re-collect, or files[] to target specific files',
        }
        : { code: 'no_files', message: 'no first-party source files found to collect' }],
      records: [],
    };
  }

  const budgetMs = Number.isFinite(req.budgetMs) ? req.budgetMs : DEFAULT_COLLECT_BUDGET_MS;
  const budgetStart = Date.now();
  const overBudget = () => (Date.now() - budgetStart) > budgetMs;

  const spawnConfig = spawnFor(projectRoot);
  const client = new LspClient({ ...spawnConfig, rootUri: pathToFileURL(projectRoot).toString(), timeoutMs: 30000 });

  const records = [];
  const operations = {};
  const requestedOps = new Set(req.operations || ['definitions', 'references', 'diagnostics']);
  for (const op of ['symbols', 'definitions', 'references', 'hover', 'diagnostics']) {
    if (requestedOps.has(op)) operations[op] = { status: 'ok', count: 0 };
  }
  const prov = `${providerName}@${providerVersion}`;
  const fresh = `${freshnessBasis}:${freshnessValue}`;
  let filesProcessed = 0;
  let budgetExhausted = false;
  let refsFoundSymbols = 0;
  let refsNotFoundSymbols = 0;
  // Symbols whose relations were DECLINED (position unplaceable) and hubs whose
  // reference set hit the cap. Reported so a coverage figure over this collection
  // reads as a FLOOR rather than a rate.
  let positionGuessSkipped = 0;
  let anonymousSkipped = 0;
  let refsTruncatedSymbols = 0;
  // ⚠ COUNTED AND REPORTED, NOT SILENTLY DROPPED. These are definitions and references that resolve
  // OUTSIDE the repository — pyright reaching the operator's installed site-packages and its own
  // typeshed stubs. They used to be stored with a raw file:// URI in `file_path`. Skipping them
  // without saying so would replace a wrong answer with an unexplained gap, so the count travels
  // with the collection: a reader can see the caller set is a floor for a NAMED reason.
  let outOfRepoSkipped = 0;
  let anyResult = false;

  try {
    await client.start();

    for (const rel of files) {
      if (overBudget()) { budgetExhausted = true; break; }
      const abs = path.isAbsolute(rel) ? rel : path.join(realRoot, rel);
      const uri = pathToFileURL(abs).toString();
      // ⚠ An enumerated file is inside the repo by construction, so `null` here means the path
      // could not be read at all — skip rather than record a file we cannot name.
      const relPath = path.isAbsolute(rel) ? relativizeUri(uri, realRoot) : rel.replace(/\\/g, '/');
      if (!relPath) { outOfRepoSkipped += 1; continue; }
      let text = '';
      try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      await client.didOpen(uri, language, text);
      // Wait briefly for the server's first diagnostics publish = parse-ready.
      try {
        const pc = client.diagnosticPublishCount(uri);
        await client.waitForDiagnostics(uri, pc, 1500);
      } catch { /* server may not publish; requests below still block until ready */ }

      let sourceLines = null;
      const loadSourceLines = () => {
        if (sourceLines !== null) return sourceLines;
        try { sourceLines = text.split(/\r?\n/u); } catch { sourceLines = []; }
        return sourceLines;
      };

      let symbols = [];
      if (requestedOps.has('symbols') || requestedOps.has('definitions') || requestedOps.has('references')) {
        try { symbols = flattenSymbols((await client.documentSymbol(uri)) || []); } catch { symbols = []; }
      }

      for (const sym of symbols) {
        if (overBudget()) { budgetExhausted = true; break; }
        const { bodyRange, pos, positionGuessed } = positionFor(sym, projectRoot, relPath, loadSourceLines);
        const symbolId = symbolIdFor(relPath, pos.line + 1, pos.character + 1);
        const qname = sym.name || '<anon>';
        anyResult = true;

        if (requestedOps.has('symbols')) {
          records.push({ ...recordBase(collectionId, language, prov), kind: 'symbol', symbolId, qname, name: sym.name, file: relPath, range: rangeFromLsp(bodyRange), confidence: 'high', freshness: fresh, result_state: 'found' });
          operations.symbols.count += 1;
        }

        // A POSITION WE CANNOT PLACE MUST NOT BE QUERIED — same guard the clangd
        // provider carries. This backend serves TypeScript/JS and Python, and the
        // failure is language-independent: when the identifier column cannot be
        // located we fall back to column 0, which is whatever token sits there. The
        // server answers truthfully about the WRONG symbol and we would record it
        // under this one. On C++ that produced ~35,190 refs/file against a healthy
        // ~51 (field, 2026-07-30) — nothing about that mechanism is C++-specific.
        if (positionGuessed) {
          // See identifier-position.js: an anonymous callback has no name in the
          // source, so it is not a symbol we FAILED to place.
          if (isAnonymousSymbolName(sym.name)) { anonymousSkipped += 1; continue; }
          positionGuessSkipped += 1;
          records.push({
            ...recordBase(collectionId, language, prov), kind: 'symbol', symbolId, qname,
            name: sym.name, file: relPath, range: rangeFromLsp(bodyRange),
            confidence: 'low', result_state: 'position_unresolved',
            note: 'identifier column could not be located; definitions/references were NOT queried',
          });
          continue;
        }
        if (requestedOps.has('definitions')) {
          try {
            const defs = (await client.definition(uri, pos)) || [];
            for (const d of (Array.isArray(defs) ? defs : [defs])) {
              if (!d?.uri) continue;
              // A definition that resolves OUTSIDE the repository is real information, but it is
              // not a node in THIS graph. pyright resolves imports into the operator's installed
              // site-packages and its own typeshed stubs; recording those as repo files is what
              // produced the raw file:// URIs in `file_path`.
              const defFile = relativizeUri(d.uri, realRoot);
              if (!defFile) { outOfRepoSkipped += 1; continue; }
              records.push({ ...recordBase(collectionId, language, prov), kind: 'definition', symbolId, qname, file: defFile, range: rangeFromLsp(d.range), confidence: 'high', freshness: fresh, result_state: 'found' });
              operations.definitions.count += 1;
            }
          } catch { /* per-symbol */ }
        }
        if (requestedOps.has('references')) {
          try {
            let refs = (await client.references(uri, pos)) || [];
            if (refs.length === 0) { await new Promise(r => setTimeout(r, 30)); refs = (await client.references(uri, pos)) || []; }
            if (refs.length === 0) {
              refsNotFoundSymbols += 1;
              records.push({ ...recordBase(collectionId, language, prov), kind: 'reference', symbolId, qname, confidence: 'low', result_state: 'not_found_after_retry' });
            } else {
              refsFoundSymbols += 1;
              // Per-symbol cap, reported never silent. A widely-used type or a
              // framework base method returns tens of thousands of references, and
              // the import is O(records). A silently capped set read as "no other
              // callers" is the false-completeness failure this codebase exists to
              // prevent.
              const kept = refs.slice(0, MAX_REFS_PER_SYMBOL);
              const droppedRefs = refs.length - kept.length;
              if (droppedRefs > 0) refsTruncatedSymbols += 1;
              for (const ref of kept) {
                // A reference from OUTSIDE the repository is a real fact about the wider world and
                // not an edge in THIS graph. Recording it stored a raw file:// URI in `file_path`,
                // pointing at a different copy of the library than the one under edit.
                const refFile = relativizeUri(ref.uri, realRoot);
                if (!refFile) { outOfRepoSkipped += 1; continue; }
                records.push({ ...recordBase(collectionId, language, prov), kind: 'reference', symbolId, qname, file: refFile, range: rangeFromLsp(ref.range), context: 'call_expr', confidence: 'high', freshness: fresh, result_state: 'found',
                  ...(droppedRefs > 0 ? { truncated: droppedRefs, totalReferences: refs.length } : {}) });
              }
              operations.references.count += kept.length;
              if (droppedRefs > 0) operations.references.status = 'partial';
            }
          } catch { /* per-symbol */ }
        }
        if (requestedOps.has('hover')) {
          try {
            const hov = await client.hover(uri, pos);
            if (hov && hov.contents) {
              records.push({ ...recordBase(collectionId, language, prov), kind: 'hover', symbolId, qname, file: relPath, range: rangeFromLsp(hov.range || bodyRange), message: typeof hov.contents === 'string' ? hov.contents : (hov.contents.value || ''), confidence: 'high', result_state: 'found' });
              operations.hover.count += 1;
            }
          } catch { /* per-symbol */ }
        }
      }

      if (requestedOps.has('diagnostics')) {
        for (const d of (client.diagnosticsFor(uri) || [])) {
          records.push({ ...recordBase(collectionId, language, prov), kind: 'diagnostic', file: relPath, severity: severityFromLsp(d.severity), message: d.message || '', range: rangeFromLsp(d.range), freshness: fresh });
          operations.diagnostics.count += 1;
        }
      }
      filesProcessed += 1;
      // Marked AFTER every requested op ran for this file. Marking earlier would let
      // a budget cut mid-file record it as done, and the next resume would skip a
      // file that was never finished — a silent coverage hole, strictly worse than
      // redoing work.
      if (ledger) ledger.collected.add(rel);
    }
  } finally {
    try { await client.shutdown(); } catch { /* ignore */ }
  }

  // Audit 2026-06-12 B3: file enumeration hitting the maxFiles cap is a partial
  // collection too — not just a budget timeout. The cpp provider already promotes
  // truncation → partial; mirror that here so a >maxFiles TS/Python repo can't
  // report status:'ok'/indexReady and have downstream trust banners treat a
  // partial index as a complete one.
  const enumTruncated = Boolean(enumStats && enumStats.truncated && !(req.files && req.files.length > 0));
  // A batch that left work behind is partial in exactly the sense callers care about: come back.
  const batchIncomplete = batchRemainder > 0;
  const incomplete = budgetExhausted || enumTruncated || batchIncomplete;
  if (incomplete) {
    const reason = budgetExhausted
      ? `budget_exhausted_${filesProcessed}_of_${files.length}_files`
      : enumTruncated
        ? `enumeration_truncated_at_${enumStats.after_filter}_of_${enumStats.total}_files_cap_${enumStats.max_files}`
        : `batch_capped_${files.length}_of_${files.length + batchRemainder}_pending_files`;
    for (const op of Object.keys(operations)) { if (operations[op].status === 'ok') { operations[op].status = 'partial'; operations[op].reason = reason; } }
  }
  const status = incomplete ? 'partial' : 'ok';
  const notes = [];
  if (budgetExhausted) notes.push({ code: 'budget_exhausted', message: `partial: ${filesProcessed}/${files.length} files within ${budgetMs}ms — run graph_collect_code_intel again to continue.` });
  if (batchIncomplete) notes.push({ code: 'batch_capped', message: `partial: this batch took ${files.length} of ${files.length + batchRemainder} pending files (maxFiles=${maxFiles}) — run graph_collect_code_intel again to continue. Coverage so far is a FLOOR.` });
  if (enumTruncated) notes.push({ code: 'enumeration_truncated', message: `partial: enumeration capped at ${enumStats.after_filter}/${enumStats.total} files (max_files=${enumStats.max_files}) — raise maxFiles or pass an explicit files[] for full coverage. Caller sets are a FLOOR.` });

  // Persist the resume point BEFORE assembling the envelope, so a caller who kills
  // us after the response still keeps the progress. Best-effort by design: a write
  // failure degrades to redoing work, never to a failed collection.
  if (ledger) writeLedger(projectRoot, ledger, collectedAt);

  return {
    ...envelopeBase,
    session: {
      ...session0,
      warmedFiles: files.length,
      // tsserver/pyright block their LSP responses until the file is analyzed,
      // so a non-empty result IS index-ready. Null when nothing resolved.
      indexReady: anyResult ? true : null,
      refsFoundSymbols, refsNotFoundSymbols,
      // What was never asked — see the guards above. Without these a coverage
      // percentage over this collection reads as a rate when it is a FLOOR.
      positionGuessSkipped, anonymousSkipped, refsTruncatedSymbols, outOfRepoSkipped,
      filesProcessed, filesTotal: files.length,
      // Resume state — resumedFrom climbing toward enumeratedTotal is the
      // convergence signal; filesProcessed resets every call and cannot show it.
      resumedFrom, enumeratedTotal, resumeLedger: ledger ? 'active' : 'not_used',
      // What this pass still owes after this call. The convergence signal, stated rather than
      // inferred from `filesProcessed === 0` — which is what a capped walk made unreliable.
      remaining: batchRemainder,
      // ⛔⛔ SCOPE OF AUTHORITY — THIS FIELD WAS ABSENT AND IT COST THE SPINE TWICE IN ONE NIGHT.
      //
      // This provider emitted NO `scope` at all, so every collection read as repo-wide. The
      // importer's invalidation is unscoped without it, and a batch that walked 154 files deleted
      // the LSP edges for all 554. Measured at 869cf41, one line per batch of the same run:
      //
      //     batch 1   processed 200   lspEdges 22200
      //     batch 2   processed 154   lspEdges 10053   <- batch 1's edges gone
      //     batch 3   processed   1   lspEdges   814   <- batch 2's edges gone
      //
      // 166,992 records across 554 files, and 814 edges standing on them. Each batch was honest,
      // succeeded, and destroyed its predecessor's work.
      //
      // ★ AND THE CPP PROVIDER HAS SAID SO IN A COMMENT SINCE e341de0: "Claiming repo-wide
      // authority there would make the importer invalidate every clangd edge." The reasoning was
      // written down, correct, and one file away — the same shape as this file's own note that
      // the resume fix "reached only one of three backends". A second backend is a second place
      // the rule has to be re-derived, and it was not.
      //
      // Authority is what this call actually WALKED. A run is a slice whenever it resumed, left a
      // remainder, or covered less than it enumerated; only a cold full sweep is repo-wide.
      scope: (Boolean(req.files && req.files.length > 0)
        || resumedFrom > 0
        || batchRemainder > 0
        || (enumeratedTotal != null && files.length < enumeratedTotal))
        ? { kind: 'files', files }
        : { kind: 'repo' },
      enumeration: enumStats,
    },
    operations,
    status,
    notes,
    records,
  };
}

function recordBase(collectionId, language, provenance) {
  return { schema_version: '0.2', collectionId, language, provenance };
}
