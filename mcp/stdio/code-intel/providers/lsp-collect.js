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
import { toRepoRelative } from '../../ingest/code-intel/paths.js';
import { getHeadCommit } from '../../freshness/git.js';
import { findIdentifierPosition, leafNameOf } from '../identifier-position.js';

function realpath(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}

// Relativize a server-returned file URI against the project root, reconciling
// Windows 8.3 short paths vs long paths (and case) by realpath-ing both sides.
function relativizeUri(uri, realRoot) {
  try {
    let p = String(uri).startsWith('file:') ? fileURLToPath(uri) : uri;
    p = realpath(p);
    const rel = path.relative(realRoot, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/');
  } catch { /* fall through */ }
  try { return toRepoRelative(uri, realRoot); } catch { return uri; }
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
  if (req.files && req.files.length > 0) {
    files = req.files;
  } else if (req.scope === 'all' || req.scope === 'changed') {
    const e = enumerateFiles(projectRoot, { maxFiles });
    files = e.files; enumStats = e.stats;
  } else {
    return { ...envelopeBase, session: session0, operations: {}, status: 'ok',
      notes: [{ code: 'no_files', message: `no files to collect: pass files[] or scope=all/changed (scope was ${req.scope || 'unset'})` }],
      records: [] };
  }
  if (files.length === 0) {
    return { ...envelopeBase, session: { ...session0, enumeration: enumStats }, operations: {}, status: 'ok',
      notes: [{ code: 'no_files', message: 'no first-party source files found to collect' }], records: [] };
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
  let anyResult = false;

  try {
    await client.start();

    for (const rel of files) {
      if (overBudget()) { budgetExhausted = true; break; }
      const abs = path.isAbsolute(rel) ? rel : path.join(realRoot, rel);
      const uri = pathToFileURL(abs).toString();
      const relPath = path.isAbsolute(rel) ? relativizeUri(uri, realRoot) : rel.replace(/\\/g, '/');
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
        const { bodyRange, pos } = positionFor(sym, projectRoot, relPath, loadSourceLines);
        const symbolId = symbolIdFor(relPath, pos.line + 1, pos.character + 1);
        const qname = sym.name || '<anon>';
        anyResult = true;

        if (requestedOps.has('symbols')) {
          records.push({ ...recordBase(collectionId, language, prov), kind: 'symbol', symbolId, qname, name: sym.name, file: relPath, range: rangeFromLsp(bodyRange), confidence: 'high', freshness: fresh, result_state: 'found' });
          operations.symbols.count += 1;
        }
        if (requestedOps.has('definitions')) {
          try {
            const defs = (await client.definition(uri, pos)) || [];
            for (const d of (Array.isArray(defs) ? defs : [defs])) {
              if (!d?.uri) continue;
              records.push({ ...recordBase(collectionId, language, prov), kind: 'definition', symbolId, qname, file: relativizeUri(d.uri, realRoot), range: rangeFromLsp(d.range), confidence: 'high', freshness: fresh, result_state: 'found' });
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
              for (const ref of refs) {
                records.push({ ...recordBase(collectionId, language, prov), kind: 'reference', symbolId, qname, file: relativizeUri(ref.uri, realRoot), range: rangeFromLsp(ref.range), context: 'call_expr', confidence: 'high', freshness: fresh, result_state: 'found' });
              }
              operations.references.count += refs.length;
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
  const incomplete = budgetExhausted || enumTruncated;
  if (incomplete) {
    const reason = budgetExhausted
      ? `budget_exhausted_${filesProcessed}_of_${files.length}_files`
      : `enumeration_truncated_at_${enumStats.after_filter}_of_${enumStats.total}_files_cap_${enumStats.max_files}`;
    for (const op of Object.keys(operations)) { if (operations[op].status === 'ok') { operations[op].status = 'partial'; operations[op].reason = reason; } }
  }
  const status = incomplete ? 'partial' : 'ok';
  const notes = [];
  if (budgetExhausted) notes.push({ code: 'budget_exhausted', message: `partial: ${filesProcessed}/${files.length} files within ${budgetMs}ms — run graph_collect_code_intel again to continue.` });
  if (enumTruncated) notes.push({ code: 'enumeration_truncated', message: `partial: enumeration capped at ${enumStats.after_filter}/${enumStats.total} files (max_files=${enumStats.max_files}) — raise maxFiles or pass an explicit files[] for full coverage. Caller sets are a FLOOR.` });

  return {
    ...envelopeBase,
    session: {
      ...session0,
      warmedFiles: files.length,
      // tsserver/pyright block their LSP responses until the file is analyzed,
      // so a non-empty result IS index-ready. Null when nothing resolved.
      indexReady: anyResult ? true : null,
      refsFoundSymbols, refsNotFoundSymbols,
      filesProcessed, filesTotal: files.length,
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
