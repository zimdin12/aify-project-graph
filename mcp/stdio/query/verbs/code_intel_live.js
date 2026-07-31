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
import { computeCoverage, coverageCause } from '../../code-intel/coverage.js';
import { inferLanguage } from '../../code-intel/backends.js';
import { toRepoRelative, uriToRepoRelativeSafe } from '../../ingest/code-intel/paths.js';
import { selectCppPrewarmFiles } from '../../code-intel/prewarm/cpp.js';

const HINTS = {
  language_unsupported: 'no live LSP session registered for this language; supported: cpp, typescript/javascript, python',
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

// L1: clangd now runs with --background-index ON (see live.js cppSpawnFor),
// so a cold session warms the index in the background; the first call can
// still return empty diagnostics while indexing catches up. Reference parity
// (agent-code-intel bumped its TS wait 1000→3000 and uses one longer cold
// warm-up): generous bounded waits, not a hardcoded 250ms.
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

// THE VERDICT IS STRUCTURED; THE REASONING MUST NOT BE SAID TWICE.
//
// Field feedback (ef-manager, 2026-07-30) named this the single most ANNOYING thing
// about the tool. `exhaustive` is perfect — one field, branch on it, done — and
// sitting beside it was a ~300-word prose paragraph duplicated BYTE-FOR-BYTE between
// `fallback` and `warnings[0]`, on every degraded call. The reader must scan the wall
// of text to discover whether the structured field they already hold means anything,
// and then reads the identical text a second time.
//
// Friction like this decides whether a tool gets reached for, and it is invisible to
// every correctness test — a full day of them passed over it. One choke point rather
// than fifteen return sites, so it cannot regress per-branch: `fallback` owns the
// actionable remedy, and `warnings` carries only what is NOT already said there.
export function buildReferencesEvidence(args) {
  return dedupeEvidenceProse(buildReferencesEvidenceInner(args));
}

export function dedupeEvidenceProse(ev) {
  if (!ev || !Array.isArray(ev.warnings) || ev.warnings.length === 0) return ev;
  const fallback = typeof ev.fallback === 'string' ? ev.fallback.trim() : null;
  const warnings = ev.warnings.filter((w) => typeof w === 'string' && w.trim() && w.trim() !== fallback);
  return warnings.length === ev.warnings.length ? ev : { ...ev, warnings };
}

function buildReferencesEvidenceInner({ freshness, callsiteCount, defCount, resultState, coverage }) {
  const warnings = [];
  // FALSE-EXHAUSTIVE GUARD (2026-06-02): a fresh index + >=1 callsite is NOT
  // enough to claim exhaustive. clangd's references only sees TUs its index
  // covers; when the compile DB is foreign (Linux/WSL DB on a host clangd) or a
  // unity build with absent per-source TUs, the index is silently PARTIAL and
  // real callers are invisible — so a non-empty set is a FLOOR, not a ceiling.
  // Downgrade to non-exhaustive with the concrete reason. (coverage may be
  // undefined for non-cpp / callers that don't pass it -> treated as trustworthy.)
  if (freshness === 'fresh' && callsiteCount > 0 && coverage && coverage.complete === false) {
    // CAUSE HONESTY (field report, 2026-07-27). We correctly said exhaustive:false,
    // then asserted cause "partial_compile_db_coverage" and prescribed "export
    // compile commands for all your targets" — on a case where ALL eight real
    // call sites were in the SAME TU as the definition, a TU clangd had demonstrably
    // indexed. Cross-TU coverage could not explain a single miss, and the
    // prescribed fix would have recovered ZERO of them. Someone spends a day
    // regenerating a compile DB and the number does not move.
    //
    // That is the same error the reporter had made by hand that morning: correctly
    // detecting something was missing, confidently wrong about WHY — and it is
    // worse from a tool, because a banner reads as machine-verified. An honest
    // exhaustive:false has to be honest about the cause too, or the remedy
    // misdirects.
    //
    // So: only attribute the repo-wide coverage gap when the queried file itself
    // is NOT covered. When the file IS covered, the gap may still hide callers in
    // other unindexed TUs — say that as a possibility — but do not name it as THE
    // cause or prescribe its fix, because it cannot explain a miss inside this file.
    const fileIsCovered = coverage.fileUncovered !== true;
    const ratioOnly = fileIsCovered
      && coverage.poorlyCovered === true
      && !coverage.foreignToolchain
      && !coverage.unityUnexpanded
      && !coverage.noFirstParty;
    if (ratioOnly) {
      const note = 'the caller set is INCOMPLETE but the cause is not established: this file IS in the compile DB, so '
        + 'misses inside it are NOT explained by compile-DB coverage and regenerating the DB may recover none of them. '
        + `Repo-wide coverage is partial (${coverage.reason ? 'see coverage detail' : 'some TUs unindexed'}), which could hide callers in OTHER files. `
        + 'Verify with rg before any "no callers / dead code / safe to delete" claim.';
      warnings.push(note);
      return {
        ready: true, degraded: true, cause: 'coverage_unknown', confidence: 'medium',
        exhaustive: false,
        fallback: note,
        warnings,
      };
    }
    warnings.push(coverage.reason || 'compile-DB coverage is incomplete — caller set may be a floor, not exhaustive');
    return {
      ready: true, degraded: true, cause: coverageCause(coverage), confidence: 'medium',
      exhaustive: false,
      fallback: coverage.reason || 'compile DB does not fully cover this repo; verify callers with rg before any delete/rename',
      warnings,
    };
  }
  // Misdiagnosis fix (2026-06-02): if the compile DB is known-incomplete, surface
  // the actionable remedy on EVERY degraded path below — not only the
  // fresh+callsites one (which already returned above). Without this, a foreign-DB
  // session that never warms past cold/unknown is told to "retry / pass
  // warmupFiles" forever instead of "fix the index (APG_CLANGD_WSL=1 / expand
  // unity)". Does NOT affect the exhaustive grant: that path requires fresh +
  // callsites, which with incomplete coverage already returned at the gate above.
  //
  // GAP CLOSED (field report, 2026-07-27): the cause-honesty fix above only
  // guarded the fresh+callsites branch, so the "FIX: export compile commands for
  // all your targets" text still reached users on the ready:false / cause
  // "unknown" path — for a file that IS in the compile DB. Same misdirection,
  // different branch: regenerate a DB that already contains the file, recover
  // nothing. The rule is the same everywhere — a repo-wide coverage gap can hide
  // callers in OTHER files, but never explains anything about THIS one when this
  // one is covered.
  if (coverage && coverage.complete === false && coverage.reason) {
    const fileCovered = coverage.fileUncovered !== true;
    const ratioOnly = fileCovered
      && coverage.poorlyCovered === true
      && !coverage.foreignToolchain
      && !coverage.unityUnexpanded
      && !coverage.noFirstParty;
    warnings.push(ratioOnly
      ? 'repo-wide compile-DB coverage is partial, which could hide callers in OTHER files — but this file IS in the compile DB, so it does not explain anything missing from this one (regenerating the DB may recover nothing here).'
      : coverage.reason);
  }
  // FAIL-CLOSED GATE (P0-2, 2026-07-26). Previously this branch granted
  // exhaustive whenever the index was fresh and returned >=1 callsite, and the
  // downgrade above only fired on `coverage.complete === false`. So UNKNOWN
  // coverage — undefined, null, or a probe that could not decide — was treated
  // as PROVEN coverage. That is the unsafe default on the one flag our contract
  // says licenses "no callers / dead code / safe to delete".
  //
  // `exhaustive:true` now requires POSITIVE proof. Silence is not proof.
  if (freshness === 'fresh' && callsiteCount > 0 && coverage?.complete !== true) {
    warnings.push(
      'compile-DB / project coverage could not be verified for this query, so the caller set is a FLOOR, '
      + 'not a complete set — it is NOT a completeness oracle. Verify with rg before any "no callers / '
      + 'dead code / safe to delete" claim.',
    );
    return {
      ready: true, degraded: true, cause: 'coverage_unknown', confidence: 'medium',
      exhaustive: false,
      fallback: 'coverage for this query is unproven; confirm with code_intel_references on the declaring TU or rg before absence claims',
      warnings,
    };
  }
  // Exhaustive requires: ready (fresh), at least one callsite, and PROVEN coverage.
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

export function buildDefinitionsEvidence({ freshness, defCount, coverage }) {
  // P0-2: this took NO coverage input at all, so a partial index yielded
  // "this is THE definition" unconditionally. Same fail-closed rule as
  // references — an unproven index cannot attest that a definition set is
  // complete (overloads / out-of-line definitions in unindexed TUs are exactly
  // what goes missing).
  if (freshness === 'fresh' && defCount > 0 && coverage?.complete !== true) {
    // M3: name the REAL cause. `coverage_unknown` means "we could not decide";
    // when coverage was decided and came back incomplete, the honest cause is
    // the specific one (partial_compile_db_coverage / partial_tsconfig_scope /
    // python_dynamic_dispatch) — same rule the references path uses.
    const decided = coverage?.complete === false;
    return {
      ready: true, degraded: true, cause: decided ? coverageCause(coverage) : 'coverage_unknown', confidence: 'medium',
      exhaustive: false,
      fallback: (decided && coverage.reason)
        || 'coverage for this query is unproven; the definition set may be incomplete (overloads / out-of-line definitions in unindexed TUs) — verify with rg before absence claims',
      warnings: [(decided && coverage.reason)
        || 'compile-DB / project coverage could not be verified for this query — the definition set is a FLOOR, not a complete set'],
    };
  }
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

export async function openIfNeeded(session, file) {
  const abs = path.isAbsolute(file) ? file : path.join(session.projectRoot, file);
  const uri = pathToFileURL(abs).toString();
  if (!session.openDocState) session.openDocState = new Map();
  let stat = null;
  try { stat = fs.statSync(abs); } catch { /* missing file — handled below */ }

  if (session.openedUris.has(uri)) {
    // Already open. Audit 2026-06-12 B2: re-sync if the file changed on disk
    // since we last sent it, otherwise the server answers references/diagnostics/
    // hierarchy against STALE text (drifted line/col, and exhaustive:true on code
    // that no longer exists). Cheap stat (mtime+size) gates the re-read.
    const prev = session.openDocState.get(uri);
    const cur = stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : null;
    const changed = cur && (!prev || prev.mtimeMs !== cur.mtimeMs || prev.size !== cur.size);
    if (changed) {
      let text = '';
      try { text = fs.readFileSync(abs, 'utf8'); } catch { /* leave empty */ }
      const version = (prev?.version || 1) + 1;
      try { await session.client.didChange(uri, text, version); } catch { /* best-effort */ }
      session.openDocState.set(uri, { version, mtimeMs: cur.mtimeMs, size: cur.size });
    }
    return uri;
  }

  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch { /* leave empty */ }
  await session.client.didOpen(uri, session.language, text);
  session.openedUris.add(uri);
  session.openDocState.set(uri, { version: 1, mtimeMs: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 });
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
  const uris = [];
  for (const f of files) uris.push(await openIfNeeded(session, f));

  // Plan #11 Fix 3: a cold session gets one longer warm-up; warm sessions
  // stay low-latency. Caller may override via warmupMs.
  const settle = Number.isFinite(warmupMs) ? Math.max(0, warmupMs)
    : (session.warmedOnce ? DEFAULT_WARMUP_MS : COLD_WARMUP_MS);

  // WAIT FOR THE PARSE SIGNAL, NOT FOR A DURATION.
  //
  // This slept a fixed `settle` and called it warm. A fixed sleep is a TIMING
  // PROXY for "the server has parsed these files", and it is only as good as the
  // machine is idle: under load — several language servers competing, a busy CI
  // box — the sleep expires before the AST exists and the cross-TU callers in
  // those files are legitimately absent from the answer. The caller then gets an
  // UNDERCOUNT that looks like a complete result, which is the failure this whole
  // trust layer exists to prevent.
  //
  // Surfaced as a test that failed only under full-suite concurrency; the same
  // race hits a real agent on a loaded machine, silently. clangd's first
  // diagnostics publish for a URI IS the parse-complete signal, and the hierarchy
  // verb already uses it for exactly this — so this is applying an existing
  // mechanism where it was missing, not inventing one.
  //
  // Falls back to the sleep when the client cannot report publishes, and the
  // settle remains the hard ceiling either way, so this can only ever return
  // sooner or equally warm — never later.
  const canWaitParse = typeof session.client.waitForDiagnostics === 'function'
    && typeof session.client.diagnosticPublishCount === 'function';
  if (canWaitParse && uris.length > 0) {
    const deadline = Date.now() + settle;
    await Promise.all(uris.filter(Boolean).map(async (uri) => {
      if (session.client.diagnosticPublishCount(uri) > 0) return; // already parsed
      const remaining = deadline - Date.now();
      if (remaining > 0) await session.client.waitForDiagnostics(uri, 0, remaining);
    }));
  } else {
    await new Promise(r => setTimeout(r, settle));
  }
  session.warmedOnce = true;
}

async function waitForReady(session, waitForReadyMs = 0) {
  if (typeof session.client.waitForReady !== 'function') return 'unknown';
  return session.client.waitForReady(Math.min(Math.max(Number(waitForReadyMs) || 0, 0), 30000));
}

// A bare `catch { return uri }` here shipped raw `file:///C:/...` URIs as if they
// were repo-relative paths whenever clangd's canonical form differed from
// repoRoot's (8.3 short names, junctions, drive-letter case). See
// uriToRepoRelativeSafe — it normalizes through realpath on both sides and never
// returns a URI for a path that IS inside the repo.
function uriToRel(uri, projectRoot) {
  return uriToRepoRelativeSafe(uri, projectRoot).path;
}

/** Diagnostics for a bounded set of files. */
export async function codeIntelDiagnostics({ repoRoot, language, files = [], diagnosticsWaitMs, warmupMs, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot) return errorResponse('internal_error', 'repoRoot required');
  if (!Array.isArray(files) || files.length === 0) return { status: 'ok', files: [], diagnostics: [] };
  const waitMs = Number.isFinite(diagnosticsWaitMs) && diagnosticsWaitMs >= 0
    ? diagnosticsWaitMs : DEFAULT_DIAGNOSTICS_WAIT_MS;
  const lang = language || inferLanguage(files[0]) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
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
export async function codeIntelReferences({ repoRoot, language, file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  // The file extension is authoritative for which language server to drive, so
  // agents don't have to pass `language` for TS/Python repos (default is cpp).
  const lang = language || inferLanguage(file) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
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
  const split = splitDefinitionFromReferences(allRefs, defLocations);
  const { callsiteLocations } = split;

  // ★ definitionLocations WAS STRUCTURALLY ALWAYS EMPTY.
  //
  // The split returns the INTERSECTION of references and definitions — reference
  // entries that happen to sit at a definition location. But we request references
  // with includeDeclaration=false, so a spec-compliant server never returns the
  // declaration, so the intersection is empty by construction. The only way the
  // field was ever populated was a server IGNORING the flag.
  //
  // Meanwhile textDocument/definition was already being called and its result used
  // ONLY as a filter — we had the definition in hand and threw it away. A field
  // tester queried a symbol AT its own definition and got definitionLocations: []
  // with a documented contract saying "declaration entries split out"
  // (ef-manager, echoes, 2026-07-30). He isolated it by elimination — full
  // coverage, non-degraded, still zero — which is what made the mechanism findable.
  //
  // Surface what we resolved, and say WHERE it came from, because "split out of the
  // reference set" and "resolved by a definition request" are different provenance
  // and a reader comparing counts deserves to know which they have.
  const definitionLocations = split.definitionLocations.length > 0
    ? split.definitionLocations
    : defLocations.map(d => ({ ...d, provenance: 'clangd@live', confidence: 'high' }));
  const definitionSource = split.definitionLocations.length > 0
    ? 'split_from_references'
    : (defLocations.length > 0 ? 'definition_request' : 'none');
  // FALSE-EXHAUSTIVE GUARD: gate the exhaustive claim on whether the compile DB
  // is trustworthy for completeness (native/WSL-clangd + expanded unity), so a
  // partial index over a foreign/unity DB can't be reported as a complete
  // caller set. Best-effort — never let coverage detection fail the query.
  // Pass the queried `file` so TS coverage checks the file is actually inside the
  // nearest tsconfig project (not just that a root tsconfig exists). On a
  // detection error FAIL CLOSED — a missing guard must not let a partial index be
  // reported as exhaustive (audit 2026-06-12).
  let coverage = null;
  try { coverage = computeCoverage({ language: lang, projectRoot: repoRoot, file }); }
  catch { coverage = { complete: false, partial: true, kind: 'unknown', foreignToolchain: false, unityUnexpanded: false, reason: 'coverage detection failed — treating as partial (fail-closed)' }; }
  const evidence = buildReferencesEvidence({
    freshness, callsiteCount: callsiteLocations.length, defCount: definitionLocations.length || defLocations.length, resultState, coverage
  });

  // Plan #14 Step D: sticky degraded state. Once a references call in
  // this session comes back degraded, subsequent results carry a
  // `previouslyDegraded` marker until a later ready+exhaustive result
  // clears the sticky state. The FIRST clean recovery still carries
  // the marker so an agent can see "we just recovered" — prevents
  // silently bumping confidence on a quietly-recovered cold index.
  const priorSticky = session.referencesStickyDegraded;
  if (evidence.degraded && evidence.cause) {
    // `since` tracks the FIRST degrade in an unbroken degraded streak (so it can
    // measure how long the session has been degraded), not the most recent call.
    // Preserve it across same-streak calls; only refresh cause.
    const since = (priorSticky && priorSticky.since) ? priorSticky.since : Date.now();
    session.referencesStickyDegraded = { cause: evidence.cause, since };
  } else if (evidence.ready && evidence.exhaustive) {
    if (priorSticky) {
      evidence.previouslyDegraded = priorSticky.cause;
      evidence.warnings = [
        ...evidence.warnings,
        `session recovered from prior ${priorSticky.cause}; earlier absence claims in this session may have been unsafe`
      ];
    }
    session.referencesStickyDegraded = null;
  } else if (priorSticky) {
    evidence.previouslyDegraded = priorSticky.cause;
    evidence.warnings = [
      ...evidence.warnings,
      `session previously saw ${priorSticky.cause} — verify before absence claims (sticky until ready+exhaustive)`
    ];
  }

  return markNoValueAdded({
    status: 'ok',
    freshness,
    result_state: resultState,
    warmedFiles: batch.length,
    // COMPAT ARRAY, DEDUPLICATED. `references` predates the
    // referenceLocations/definitionLocations split and is kept so existing callers
    // do not break. Field measurement (ef-manager, 2026-07-30): it was BYTE-IDENTICAL
    // to referenceLocations in 4 of 4 responses, doubling every payload for zero
    // information — and payload size is a real cost for an agent, not a cosmetic one.
    //
    // When the two are identical there is nothing to preserve, so emit the compat
    // key as a reference to the same array (callers reading either field get the
    // same data, and the serialized response carries it once). When they genuinely
    // differ — a server that returned the declaration among refs — the full array is
    // still emitted, because that is the case the compat field exists for.
    references: allRefs.length === callsiteLocations.length ? callsiteLocations : allRefs,
    referenceLocations: callsiteLocations, // non-declaration callsites
    definitionLocations,                   // the symbol's declaration/definition site(s)
    // 'split_from_references' (server returned the decl among refs) |
    // 'definition_request' (resolved via textDocument/definition — the normal case,
    // since we ask for references with includeDeclaration=false) | 'none'.
    definitionSource,
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
export async function codeIntelDefinitions({ repoRoot, language, file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  const lang = language || inferLanguage(file) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
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
  // Same fail-closed coverage input the references path uses (P0-2). Best-effort:
  // a failed probe yields complete:false, which under-claims rather than over-claims.
  let defCoverage = null;
  try { defCoverage = computeCoverage({ language: lang, projectRoot: repoRoot, file }); }
  catch { defCoverage = { complete: false, partial: true, kind: 'unknown', reason: 'coverage detection failed — treating as partial (fail-closed)' }; }
  const evidence = buildDefinitionsEvidence({ freshness, defCount: definitions.length, coverage: defCoverage });
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
export async function codeIntelHover({ repoRoot, language, file, line, col, warmupFiles = [], warmupMs, prewarmCap, waitForReadyMs = 0, spawn }) {
  const startedAt = Date.now();
  if (!repoRoot || !file || !line) return errorResponse('internal_error', 'repoRoot, file, line required');
  const lang = language || inferLanguage(file) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
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
export async function codeIntelSymbols({ repoRoot, language, file, spawn }) {
  if (!repoRoot || !file) return errorResponse('internal_error', 'repoRoot and file required');
  const lang = language || inferLanguage(file) || 'cpp';
  let session;
  try { session = await getLiveSession({ language: lang, projectRoot: repoRoot, spawn }); }
  catch (err) { return errorResponse(err.code || 'internal_error', err.message); }
  const uri = await openIfNeeded(session, file);
  const syms = (await session.client.documentSymbol(uri)) || [];
  return {
    status: 'ok',
    file,
    symbols: syms.map(s => ({ name: s.name, kind: s.kind, range: rangeFromLsp(s.range), selectionRange: rangeFromLsp(s.selectionRange || s.range) }))
  };
}
