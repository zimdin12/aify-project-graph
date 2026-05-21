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
import { selectCppPrewarmFiles } from '../../code-intel/prewarm/cpp.js';

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

// Plan #11 Fix 3: clangd runs with --background-index=false, so the first
// call against a cold session can return empty diagnostics while the index
// catches up. Reference parity (agent-code-intel bumped its TS wait
// 1000→3000 and uses one longer cold warm-up): generous bounded waits, not
// a hardcoded 250ms.
const DEFAULT_DIAGNOSTICS_WAIT_MS = 3000;
const DEFAULT_WARMUP_MS = 80;
const COLD_WARMUP_MS = 1500;

// Plan #11 Fix 1: 'unknown' is the default freshness when clangd emits no
// $/progress — it does NOT mean the answer is worthless; an empty result
// under 'unknown' is a genuine negative. Only explicit 'stale'/'timeout'
// means the server could not produce a current answer. Reference parity:
// agent-code-intel keys "no value" off a bounded freshness signal, never
// off index-readiness.
function isLowConfidenceFreshness(freshness) {
  return freshness === 'stale' || freshness === 'timeout';
}

// Plan #14 Step A: references evidence contract. Mirrors agent-code-intel
// 0.1.21's load-bearing primitive — only `evidence.exhaustive === true`
// is a safe signal that empty/short results justify an absence claim
// ("no callers", "dead code"). Structured causes let agents recover
// (their `fallback` field) instead of guessing.
//
// noValueAdded is kept as a one-release compat shim so existing callers
// don't break in lockstep; new code MUST read `evidence.exhaustive`.
//
// Cause enum (semantics tight per senior-dev review):
//   cold_index       — no workspace-warm evidence yet (or freshness=cold/unknown w/ empty)
//   timeout          — server didn't respond within bound
//   unsupported      — no LSP / language unsupported / capability missing
//   definition_only  — refs returned only contain the symbol's declaration, no callsites
//   stale_index      — index reported stale during request
//   unknown          — adapter could not classify (old freshness signal)
function locationKey(file, range) {
  if (!file || !range) return '';
  return `${file}:${range.start?.line}:${range.start?.col}-${range.end?.line}:${range.end?.col}`;
}

export function splitDefinitionFromReferences(refs, defs) {
  // Build a set of (file, range) keys for the symbol's definitions so we
  // can subtract them from the references list. clangd/LSP often include
  // the declaration in references results.
  const defKeys = new Set();
  for (const d of (defs || [])) {
    if (d?.file && d?.range) defKeys.add(locationKey(d.file, d.range));
  }
  const callsiteLocations = [];
  const definitionLocations = [];
  for (const r of refs) {
    if (defKeys.has(locationKey(r.file, r.range))) definitionLocations.push(r);
    else callsiteLocations.push(r);
  }
  return { callsiteLocations, definitionLocations };
}

export function buildReferencesEvidence({ freshness, callsiteCount, defCount, resultState }) {
  const warnings = [];
  // Exhaustive requires: ready (fresh), at least one callsite OR an
  // honest empty in a freshly-warmed context, and no degraded cause.
  if (freshness === 'fresh' && callsiteCount > 0) {
    return { ready: true, degraded: false, cause: null, confidence: 'high', exhaustive: true, fallback: null, warnings };
  }
  if (freshness === 'fresh' && callsiteCount === 0 && defCount > 0) {
    warnings.push('definition-only references are not safe evidence of no callers');
    return {
      ready: true, degraded: true, cause: 'definition_only', confidence: 'low',
      exhaustive: false, fallback: 'pass warmupFiles[] of likely callers and retry; fall back to grep for low-confidence sweep', warnings
    };
  }
  if (freshness === 'stale') {
    return {
      ready: false, degraded: true, cause: 'stale_index', confidence: 'low',
      exhaustive: false, fallback: 'wait_for_ready (raise waitForReadyMs), retry; treat absence as unsafe', warnings
    };
  }
  if (freshness === 'timeout') {
    return {
      ready: false, degraded: true, cause: 'timeout', confidence: 'low',
      exhaustive: false, fallback: 'raise waitForReadyMs / retry; absence not safe', warnings
    };
  }
  if (freshness === 'cold' || (freshness === 'unknown' && callsiteCount === 0)) {
    return {
      ready: false, degraded: true, cause: 'cold_index', confidence: 'low',
      exhaustive: false, fallback: 'pass warmupFiles[] (callers + headers), or wait_for_ready, then retry; absence not safe until evidence.ready=true', warnings
    };
  }
  // freshness='unknown' with callsites — server gave us data, just no readiness signal
  return {
    ready: false, degraded: false, cause: 'unknown', confidence: 'medium',
    exhaustive: false, fallback: 'absence claims unsafe without readiness signal; result is otherwise usable', warnings
  };
}

export function buildDefinitionsEvidence({ freshness, defCount }) {
  if (freshness === 'fresh' && defCount > 0) {
    return { ready: true, degraded: false, cause: null, confidence: 'high', exhaustive: true, fallback: null, warnings: [] };
  }
  if (freshness === 'stale') return { ready: false, degraded: true, cause: 'stale_index', confidence: 'low', exhaustive: false, fallback: 'wait_for_ready then retry', warnings: [] };
  if (freshness === 'timeout') return { ready: false, degraded: true, cause: 'timeout', confidence: 'low', exhaustive: false, fallback: 'raise waitForReadyMs / retry', warnings: [] };
  if (freshness === 'cold' || (freshness === 'unknown' && defCount === 0)) {
    return { ready: false, degraded: true, cause: 'cold_index', confidence: 'low', exhaustive: false, fallback: 'pass warmupFiles[] (declaring TU + headers), or wait_for_ready, then retry', warnings: [] };
  }
  return { ready: false, degraded: false, cause: 'unknown', confidence: 'medium', exhaustive: false, fallback: 'usable result; readiness signal missing', warnings: [] };
}

// Compat shim: noValueAdded was the Plan #11 single-bit signal. Keep
// emitting it for one release so existing callers don't break in
// lockstep; new code MUST read `evidence.exhaustive`. Removed in a
// follow-up after consumers migrate.
function markNoValueAdded(result) {
  if (result.status !== 'ok') return result;
  if (!isLowConfidenceFreshness(result.freshness)) return result;
  const emptySemanticResult =
    (Array.isArray(result.references) && result.references.length === 0)
    || (Array.isArray(result.definitions) && result.definitions.length === 0)
    || result.hover === null;
  if (emptySemanticResult) return { ...result, noValueAdded: true };
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

// Plan #14 Step B: bounded auto-prewarm for cold navigation sessions.
// Only fires when the session is cold (no workspace files opened yet)
// AND the caller didn't pass an explicit warmupFiles[] list. Honors
// APG_DISABLE_PREWARM=1. Returns { addedFiles[], stats } for telemetry.
function planAutoPrewarm(session, queriedFile, callerWarmupFiles, prewarmCap) {
  // Caller knew best — skip auto-prewarm.
  if (Array.isArray(callerWarmupFiles) && callerWarmupFiles.length > 0) {
    return { addedFiles: [], stats: { cap: prewarmCap ?? null, skipped: false, source: 'caller_provided' } };
  }
  // Already warm — no need to prewarm.
  if (session.client.workspaceWarmCount > 0) {
    return { addedFiles: [], stats: { cap: prewarmCap ?? null, skipped: false, source: 'already_warm' } };
  }
  if (session.language !== 'cpp') {
    return { addedFiles: [], stats: { cap: prewarmCap ?? null, skipped: false, source: 'unsupported_language' } };
  }
  const result = selectCppPrewarmFiles({
    projectRoot: session.projectRoot,
    queriedFile,
    cap: prewarmCap
  });
  return { addedFiles: result.files, stats: result.stats };
}

async function batchWarmup(session, files, warmupMs) {
  // Open every requested file before collection — closes the transient
  // unresolved-symbol noise window on newly added cross-file symbols.
  for (const f of files) await openIfNeeded(session, f);
  // Plan #11 Fix 3: a cold session gets one longer warm-up; warm sessions
  // stay low-latency. Caller may override via warmupMs.
  let settle = Number.isFinite(warmupMs) ? Math.max(0, warmupMs)
    : (session.warmedOnce ? DEFAULT_WARMUP_MS : COLD_WARMUP_MS);
  await new Promise(r => setTimeout(r, settle));
  session.warmedOnce = true;
}

async function waitForReady(session, waitForReadyMs = 0) {
  if (typeof session.client.waitForReady !== 'function') return 'unknown';
  return session.client.waitForReady(Math.min(Math.max(Number(waitForReadyMs) || 0, 0), 30000));
}

function uriToRel(uri, projectRoot) {
  try { return toRepoRelative(projectRoot, fileURLToPath(uri)); } catch { return uri; }
}

/** Diagnostics for a bounded set of files. */
export async function codeIntelDiagnostics({ repoRoot, language = 'cpp', files = [], diagnosticsWaitMs, warmupMs, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot) return errorResponse('internal_error', 'repoRoot required');
  if (!Array.isArray(files) || files.length === 0) return { status: 'ok', files: [], diagnostics: [] };
  const waitMs = Number.isFinite(diagnosticsWaitMs) && diagnosticsWaitMs >= 0
    ? diagnosticsWaitMs : DEFAULT_DIAGNOSTICS_WAIT_MS;
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  const publishCounts = new Map();
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(repoRoot, f);
    const uri = pathToFileURL(abs).toString();
    publishCounts.set(f, session.client.diagnosticPublishCount?.(uri) ?? 0);
  }

  await batchWarmup(session, files, warmupMs);
  const out = [];
  const fileResults = [];
  for (const f of files) {
    const uri = await openIfNeeded(session, f);
    const diagnosticsResult = typeof session.client.diagnostics === 'function'
      ? await session.client.diagnostics(uri, waitMs, { sincePublishCount: publishCounts.get(f) ?? 0 })
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
      freshness: freshnessCounts(fileResults.map(f => f.freshness)),
      diagnosticsWaitMs: waitMs
    }
  };
  // Plan #11 Fix 1: only flag no-value when every file's freshness is an
  // explicit low-confidence signal (stale/timeout). 'unknown' + 0 diagnostics
  // is a genuine clean result, not a failure to answer.
  const allFilesAddedNoValue = fileResults.length > 0
    && out.length === 0
    && fileResults.every(f => isLowConfidenceFreshness(f.freshness));
  return allFilesAddedNoValue ? { ...result, noValueAdded: true } : result;
}

/** References for a symbol at a position. Symbol-aware via clangd.
 *  Cross-file refs require clangd to have indexed candidate callers. Pass
 *  `warmupFiles[]` (e.g. ['src/foo.cpp', 'src/bar.cpp', 'src/foo.h']) when
 *  background-index is disabled and you need clangd to consider those files. */
export async function codeIntelReferences({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }

  // Plan #14 Step B: auto-prewarm bounded set when session is cold and
  // caller didn't pass warmupFiles[]. Bounded to ≤ prewarmCap (default 15)
  // per senior-dev review — same-dir + compile_commands siblings only,
  // no whole-component sweep.
  const prewarm = planAutoPrewarm(session, file, warmupFiles, prewarmCap);
  const callerProvided = Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [];
  const batch = [file, ...callerProvided, ...prewarm.addedFiles.filter(f => f !== file && !callerProvided.includes(f))];
  await batchWarmup(session, batch, warmupMs);
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

  // Plan #14 Step A: paired definition lookup so we can split callsites
  // from declaration entries (defensive — clangd under includeDeclaration:
  // false should already exclude the decl, but some servers don't honor
  // that flag). Result lets agents distinguish "no callers at all" from
  // "only the definition came back" — the latter is degraded.
  let defLocations = [];
  try {
    const defs = await session.client.definition(uri, pos);
    const defList = Array.isArray(defs) ? defs : (defs ? [defs] : []);
    defLocations = defList
      .filter(d => d?.uri)
      .map(d => ({ file: uriToRel(d.uri, repoRoot), range: rangeFromLsp(d.range) }));
  } catch { /* definition lookup is best-effort; absence shouldn't fail refs */ }

  const allRefs = refs.map(r => ({ file: uriToRel(r.uri, repoRoot), range: rangeFromLsp(r.range), provenance: 'clangd@live', confidence: 'high' }));
  const { callsiteLocations, definitionLocations } = splitDefinitionFromReferences(allRefs, defLocations);
  const evidence = buildReferencesEvidence({
    freshness, callsiteCount: callsiteLocations.length, defCount: definitionLocations.length || defLocations.length, resultState
  });

  return markNoValueAdded({
    status: 'ok',
    freshness,
    result_state: resultState,
    warmedFiles: batch.length,
    references: allRefs,                  // compat: full LSP-shape array
    referenceLocations: callsiteLocations, // non-declaration callsites
    definitionLocations,                   // declaration entries pulled out of refs
    evidence,                              // Plan #14 contract — read this for absence claims
    telemetry: {
      operation: 'references', references: allRefs.length, callsites: callsiteLocations.length,
      definitions: definitionLocations.length, warmedFiles: batch.length, latencyMs: latencyMs(startedAt), freshness,
      prewarmFiles: prewarm.addedFiles, prewarmCap: prewarm.stats.cap,
      prewarmSkipped: prewarm.stats.skipped, prewarmSource: prewarm.stats.source
    }
  });
}

/** Definitions for a symbol at a position. Pass warmupFiles[] for cross-TU resolution. */
export async function codeIntelDefinitions({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const prewarm = planAutoPrewarm(session, file, warmupFiles, prewarmCap);
  const callerProvided = Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [];
  const batch = [file, ...callerProvided, ...prewarm.addedFiles.filter(f => f !== file && !callerProvided.includes(f))];
  await batchWarmup(session, batch, warmupMs);
  const freshness = await waitForReady(session, waitForReadyMs);
  const uri = await openIfNeeded(session, file);
  const pos = { line: line - 1, character: (col || 1) - 1 };
  const defs = await session.client.definition(uri, pos);
  const list = Array.isArray(defs) ? defs : (defs ? [defs] : []);
  const definitions = list.filter(d => d?.uri).map(d => ({ file: uriToRel(d.uri, repoRoot), range: rangeFromLsp(d.range), provenance: 'clangd@live', confidence: 'high' }));
  const evidence = buildDefinitionsEvidence({ freshness, defCount: definitions.length });
  return markNoValueAdded({
    status: 'ok',
    freshness,
    warmedFiles: batch.length,
    definitions,
    evidence,  // Plan #14 contract — exhaustive:true means trustworthy "this is THE definition"
    telemetry: {
      operation: 'definitions', definitions: definitions.length, warmedFiles: batch.length,
      latencyMs: latencyMs(startedAt), freshness,
      prewarmFiles: prewarm.addedFiles, prewarmCap: prewarm.stats.cap,
      prewarmSkipped: prewarm.stats.skipped, prewarmSource: prewarm.stats.source
    }
  });
}

/** Hover (type + docstring) at a position. Pass warmupFiles[] when the symbol is declared in another TU. */
export async function codeIntelHover({ repoRoot, language = 'cpp', file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  let session;
  try { session = await getLiveSession({ language, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const prewarm = planAutoPrewarm(session, file, warmupFiles, prewarmCap);
  const callerProvided = Array.isArray(warmupFiles) ? warmupFiles.filter(f => f && f !== file) : [];
  const batch = [file, ...callerProvided, ...prewarm.addedFiles.filter(f => f !== file && !callerProvided.includes(f))];
  await batchWarmup(session, batch, warmupMs);
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
