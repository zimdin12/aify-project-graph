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

function uriToRel(uri, projectRoot) {
  try { return toRepoRelative(projectRoot, fileURLToPath(uri)); } catch { return uri; }
}

/** Diagnostics for a bounded set of files. */
export async function codeIntelDiagnostics({ repoRoot, language = 'cpp', files = [], spawn }) {
  if (!repoRoot) return errorResponse('internal_error', 'repoRoot required');
  if (!Array.isArray(files) || files.length === 0) return { status: 'ok', files: [], diagnostics: [] };
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  await batchWarmup(session, files);
  const out = [];
  for (const f of files) {
    const uri = await openIfNeeded(session, f);
    const diags = session.client.diagnosticsFor(uri);
    for (const d of diags) {
      out.push({
        file: f,
        severity: ['', 'error', 'warning', 'info', 'hint'][d.severity] || 'info',
        message: d.message || '',
        range: rangeFromLsp(d.range)
      });
    }
  }
  return { status: 'ok', files, diagnostics: out };
}

/** References for a symbol at a position. Symbol-aware via clangd. */
export async function codeIntelReferences({ repoRoot, language = 'cpp', file, line, col, spawn }) {
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  const uri = await openIfNeeded(session, file);
  await new Promise(r => setTimeout(r, 50)); // warmup
  const pos = { line: line - 1, character: (col || 1) - 1 };
  let refs = (await session.client.references(uri, pos)) || [];
  let resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
  if (refs.length === 0) {
    await new Promise(r => setTimeout(r, 40));
    refs = (await session.client.references(uri, pos)) || [];
    resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
  }
  return {
    status: 'ok',
    result_state: resultState,
    references: refs.map(r => ({ file: uriToRel(r.uri, repoRoot), range: rangeFromLsp(r.range), provenance: 'clangd@live', confidence: 'high' }))
  };
}

/** Definitions for a symbol at a position. */
export async function codeIntelDefinitions({ repoRoot, language = 'cpp', file, line, col, spawn }) {
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  const defs = await session.client.definition(uri, pos);
  const list = Array.isArray(defs) ? defs : (defs ? [defs] : []);
  return {
    status: 'ok',
    definitions: list.filter(d => d?.uri).map(d => ({ file: uriToRel(d.uri, repoRoot), range: rangeFromLsp(d.range), provenance: 'clangd@live', confidence: 'high' }))
  };
}

/** Hover (type + docstring) at a position. */
export async function codeIntelHover({ repoRoot, language = 'cpp', file, line, col, spawn }) {
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  const hov = await session.client.hover(uri, pos);
  if (!hov) return { status: 'ok', hover: null };
  const content = typeof hov.contents === 'string' ? hov.contents : (hov.contents?.value ?? '');
  return { status: 'ok', hover: { content, range: rangeFromLsp(hov.range), provenance: 'clangd@live', confidence: 'high' } };
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
