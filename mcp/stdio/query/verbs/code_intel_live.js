// Plan #6: bounded agent-facing code-intel verbs.
// Each verb drives the live LspClient session directly — no collect/import
// round-trip. Returns bounded JSON for atomic C++ questions during editing.
//
// Reference parity: matches agent-code-intel's `agent_code_intel` action set
// (diagnostics, references, definitions, hover, symbols). APG-owned, drives
// clangd through the existing wrapper resolution chain.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getLiveSession } from '../../code-intel/live.js';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';

const HINTS = {
  language_unsupported: 'no live LSP session registered for this language; supported: cpp',
  language_server_missing: 'install the language server (e.g. clangd) and ensure it is on PATH; run `apg code-intel doctor` for details',
  internal_error: 'see message'
};

function errorResponse(code, message) {
  return { status: 'error', errors: [{ code, message, hint: HINTS[code] || '' }] };
}

function emptyFreshnessCounts() {
  return { fresh: 0, stale: 0, timeout: 0, unknown: 0 };
}

function latencyMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function freshnessCounts(values) {
  const counts = emptyFreshnessCounts();
  for (const value of values) {
    if (Object.hasOwn(counts, value)) counts[value] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function markNoValueAdded(result) {
  if (result.status !== 'ok') return result;
  const staleOrUnknown = result.freshness && result.freshness !== 'fresh';
  const emptySemanticResult =
    (Array.isArray(result.references) && result.references.length === 0)
    || (Array.isArray(result.definitions) && result.definitions.length === 0)
    || result.hover === null;
  if (staleOrUnknown && emptySemanticResult) return { ...result, noValueAdded: true };
  return result;
}

function rangeFromLsp(r) {
  if (!r) return null;
  return { start: { line: r.start.line + 1, col: r.start.character + 1 }, end: { line: r.end.line + 1, col: r.end.character + 1 } };
}

async function openIfNeeded(session, file) {
  const abs = path.isAbsolute(file) ? file : path.join(session.projectRoot, file);
  const uri = pathToFileURL(abs).toString();
  if (session.openedUris.has(uri)) return uri;
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch { /* leave empty */ }
  await session.client.didOpen(uri, session.language, text);
  session.openedUris.add(uri);
  return uri;
}

async function batchWarmup(session, files) {
  // Open every requested file before collection — closes the transient
  // unresolved-symbol noise window on newly added cross-file symbols.
  for (const f of files) await openIfNeeded(session, f);
  await new Promise(r => setTimeout(r, 80));
}

async function waitForReady(session, waitForReadyMs = 0) {
  if (typeof session.client.waitForReady !== 'function') return 'unknown';
  return session.client.waitForReady(Math.min(Math.max(Number(waitForReadyMs) || 0, 0), 30000));
}

function uriToRel(uri, projectRoot) {
  try { return toRepoRelative(projectRoot, fileURLToPath(uri)); } catch { return uri; }
}

/** Diagnostics for a bounded set of files. */
export async function codeIntelDiagnostics({ repoRoot, language = 'cpp', files = [], spawn }) {
  const startedAt = Date.now();
  if (!repoRoot) return errorResponse('internal_error', 'repoRoot required');
  if (!Array.isArray(files) || files.length === 0) return { status: 'ok', files: [], diagnostics: [] };
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  const publishCounts = new Map();
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(repoRoot, f);
    const uri = pathToFileURL(abs).toString();
    publishCounts.set(f, session.client.diagnosticPublishCount?.(uri) ?? 0);
  }

  await batchWarmup(session, files);
  const out = [];
  const fileResults = [];
  for (const f of files) {
    const uri = await openIfNeeded(session, f);
    const diagnosticsResult = typeof session.client.diagnostics === 'function'
      ? await session.client.diagnostics(uri, 250, { sincePublishCount: publishCounts.get(f) ?? 0 })
      : { freshness: 'unknown', diagnostics: session.client.diagnosticsFor(uri) };
    fileResults.push({ file: f, freshness: diagnosticsResult.freshness, diagnostics: diagnosticsResult.diagnostics.length });
    const diags = diagnosticsResult.diagnostics;
    for (const d of diags) {
      out.push({
        file: f,
        severity: ['', 'error', 'warning', 'info', 'hint'][d.severity] || 'info',
        message: d.message || '',
        range: rangeFromLsp(d.range)
      });
    }
  }
  const result = {
    status: 'ok',
    files: fileResults,
    diagnostics: out,
    telemetry: {
      operation: 'diagnostics',
      files: fileResults.length,
      diagnostics: out.length,
      latencyMs: latencyMs(startedAt),
      freshness: freshnessCounts(fileResults.map(f => f.freshness))
    }
  };
  const allFilesAddedNoValue = fileResults.length > 0
    && out.length === 0
    && fileResults.every(f => f.freshness !== 'fresh');
  return allFilesAddedNoValue ? { ...result, noValueAdded: true } : result;
}

/** References for a symbol at a position. Symbol-aware via clangd.
 *  Cross-file refs require clangd to have indexed candidate callers. Pass
 *  `warmupFiles[]` (e.g. ['src/foo.cpp', 'src/bar.cpp', 'src/foo.h']) when
 *  background-index is disabled and you need clangd to consider those files. */
export async function codeIntelReferences({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  // Always include the queried file in the warmup batch. Open warmup files
  // first so clangd has them in working memory before the references query.
  const batch = [file, ...(Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [])];
  for (const f of batch) await openIfNeeded(session, f);
  await new Promise(r => setTimeout(r, 80));
  const freshness = await waitForReady(session, waitForReadyMs);

  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  let refs = (await session.client.references(uri, pos)) || [];
  let resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
  if (refs.length === 0) {
    await new Promise(r => setTimeout(r, 60));
    refs = (await session.client.references(uri, pos)) || [];
    resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
  }
  return markNoValueAdded({
    status: 'ok',
    freshness,
    result_state: resultState,
    warmedFiles: batch.length,
    references: refs.map(r => ({ file: uriToRel(r.uri, repoRoot), range: rangeFromLsp(r.range), provenance: 'clangd@live', confidence: 'high' })),
    telemetry: { operation: 'references', references: refs.length, warmedFiles: batch.length, latencyMs: latencyMs(startedAt), freshness }
  });
}

/** Definitions for a symbol at a position. Pass warmupFiles[] for cross-TU resolution. */
export async function codeIntelDefinitions({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const batch = [file, ...(Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [])];
  for (const f of batch) await openIfNeeded(session, f);
  await new Promise(r => setTimeout(r, 80));
  const freshness = await waitForReady(session, waitForReadyMs);
  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  const defs = await session.client.definition(uri, pos);
  const list = Array.isArray(defs) ? defs : (defs ? [defs] : []);
  return markNoValueAdded({
    status: 'ok',
    freshness,
    warmedFiles: batch.length,
    definitions: list.filter(d => d?.uri).map(d => ({ file: uriToRel(d.uri, repoRoot), range: rangeFromLsp(d.range), provenance: 'clangd@live', confidence: 'high' })),
    telemetry: { operation: 'definitions', definitions: list.filter(d => d?.uri).length, warmedFiles: batch.length, latencyMs: latencyMs(startedAt), freshness }
  });
}

/** Hover (type + docstring) at a position. Pass warmupFiles[] when the symbol is declared in another TU. */
export async function codeIntelHover({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const batch = [file, ...(Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [])];
  for (const f of batch) await openIfNeeded(session, f);
  await new Promise(r => setTimeout(r, 60));
  const freshness = await waitForReady(session, waitForReadyMs);
  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  const hov = await session.client.hover(uri, pos);
  if (!hov) return markNoValueAdded({ status: 'ok', freshness, warmedFiles: batch.length, hover: null, telemetry: { operation: 'hover', hover: 0, warmedFiles: batch.length, latencyMs: latencyMs(startedAt), freshness } });
  const content = typeof hov.contents === 'string' ? hov.contents : (hov.contents?.value ?? '');
  return { status: 'ok', freshness, warmedFiles: batch.length, hover: { content, range: rangeFromLsp(hov.range), provenance: 'clangd@live', confidence: 'high' }, telemetry: { operation: 'hover', hover: 1, warmedFiles: batch.length, latencyMs: latencyMs(startedAt), freshness } };
}

/** Symbol outline for one file. */
export async function codeIntelSymbols({ repoRoot, language = 'cpp', file, spawn }) {
  if (!repoRoot || !file) return errorResponse('internal_error', 'repoRoot and file required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const uri = await openIfNeeded(session, file);
  const syms = (await session.client.documentSymbol(uri)) || [];
  return {
    status: 'ok',
    file,
    symbols: syms.map(s => ({ name: s.name, kind: s.kind, range: rangeFromLsp(s.range), selectionRange: rangeFromLsp(s.selectionRange || s.range) }))
  };
}
