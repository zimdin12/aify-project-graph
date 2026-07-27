// graph_collect_code_intel — public action verb agents and bridge call to
// run a code-intel collection. Public per superplan invariant #6: APG owns
// artifacts; bridge triggers the same verb agents call.
//
// Side effect on success: when the response is `ok` or `partial`, the
// collection is also imported into the local APG graph DB so it's
// immediately visible to graph_health.codeIntel, graph_pull's code_intel
// layer, graph_change_plan ranking, and packet evidence blocks.
//
// HIGH-2 (gtest-claude 2026-05-31) — the verb USED to return the full v0.2
// envelope (status, errors, records[]). On a unity-expanded TU (e.g. GPU.cpp)
// that envelope is multi-MB / tens of thousands of lines of records[], which
// blew the MCP token limit and head-of-line-blocked the session. The full
// envelope is still needed for the DB IMPORT (internal), but the MCP RESPONSE
// to the agent is now a BUDGETED SUMMARY: status, collectionId, per-operation
// counts, edges/nodes created+invalidated, indexReady + budget/resume note, the
// files-processed/total counters, and a SMALL sample of created edges — a few
// hundred tokens, never the raw records[]. For raw records, use code_intel_replay
// / the DB (graph_pull's code_intel layer).

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { runCollection } from '../../code-intel/runner.js';
import { registerProvider, getProvider } from '../../code-intel/providers/index.js';
import { createCppClangdProvider } from '../../code-intel/providers/cpp-clangd.js';
import { createTsLangServerProvider } from '../../code-intel/providers/ts-langserver.js';
import { createPyrightProvider } from '../../code-intel/providers/pyright.js';
import { openDb, openExistingDb } from '../../storage/db.js';
import { importV02Collection } from '../../ingest/code-intel/importer.js';

// FIX 2 (test-round-2026-05-31): `language` used to be required-with-no-default,
// inconsistent with every other code_intel_* verb (which default to 'cpp').
// We now default to 'cpp' (the games are C++) and, when files[] are given,
// infer from their extensions so a TS/JS file list selects the right provider
// without the caller restating it. Explicit `language` always wins.
const EXT_LANGUAGE = new Map([
  ['.cpp', 'cpp'], ['.cc', 'cpp'], ['.cxx', 'cpp'], ['.c', 'cpp'],
  ['.h', 'cpp'], ['.hpp', 'cpp'], ['.hh', 'cpp'], ['.hxx', 'cpp'], ['.inl', 'cpp'],
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.mts', 'typescript'], ['.cts', 'typescript'],
  ['.js', 'typescript'], ['.jsx', 'typescript'], ['.mjs', 'typescript'], ['.cjs', 'typescript'],
  ['.py', 'python'], ['.pyi', 'python']
]);

// Infer a language from a files[] list by majority extension vote. Returns null
// when files[] is empty or no extension is recognized (caller falls back to the
// default). Exported for unit coverage.
export function inferLanguageFromFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  const tally = new Map();
  for (const f of files) {
    if (typeof f !== 'string') continue;
    const dot = f.lastIndexOf('.');
    if (dot < 0) continue;
    const lang = EXT_LANGUAGE.get(f.slice(dot).toLowerCase());
    if (!lang) continue;
    tally.set(lang, (tally.get(lang) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [lang, n] of tally) {
    if (n > bestN) { best = lang; bestN = n; }
  }
  return best;
}

// HIGH-2 — per-operation counts from the v0.2 envelope's `operations` map.
// Each operation entry is { status, count?, reason? }. We surface the count
// per op (definitions/references/symbols/diagnostics/hover) without serializing
// any records. Exported for unit coverage.
export function operationCounts(operations) {
  const out = {};
  if (operations && typeof operations === 'object') {
    for (const [op, info] of Object.entries(operations)) {
      out[op] = {
        status: info?.status ?? null,
        count: Number.isFinite(Number(info?.count)) ? Number(info.count) : null,
        ...(info?.reason ? { reason: info.reason } : {})
      };
    }
  }
  return out;
}

// HIGH-2 — a SMALL sample (≤ cap) of created LSP_VERIFIED CALLS edges, read
// back from the DB after import so the agent sees concrete evidence the collect
// produced edges without the full records[] flood. Best-effort: never throws.
function sampleLspEdges(db, { cap = 10 } = {}) {
  try {
    const rows = db.all(
      `SELECT e.source_file AS file, e.source_line AS line,
              cn.label AS caller, tn.label AS callee
         FROM edges e
         LEFT JOIN nodes cn ON cn.id = e.from_id
         LEFT JOIN nodes tn ON tn.id = e.to_id
        WHERE e.provenance = 'LSP_VERIFIED' AND e.relation = 'CALLS'
        ORDER BY e.source_file, e.source_line
        LIMIT $cap`,
      { cap }
    );
    return (rows || []).map(r => ({
      caller: r.caller || '?',
      callee: r.callee || '?',
      at: `${r.file || '?'}:${r.line ?? '?'}`
    }));
  } catch {
    return [];
  }
}

let providersRegistered = false;
function ensureBuiltinProviders() {
  if (providersRegistered) return;
  if (!getProvider('cpp-clangd')) {
    registerProvider('cpp-clangd', () => createCppClangdProvider());
  }
  if (!getProvider('ts-langserver')) {
    registerProvider('ts-langserver', () => createTsLangServerProvider());
  }
  if (!getProvider('pyright')) {
    registerProvider('pyright', () => createPyrightProvider());
  }
  providersRegistered = true;
}

// Detect the dominant code-intel language of a repo from root markers, for the
// scope=all case where there is no files[] to vote on. compile_commands.json is
// checked in the common build dirs (mirrors the C++ compile-DB probe).
export function detectRepoLanguage(repoRoot) {
  const has = (rel) => { try { return existsSync(join(repoRoot, rel)); } catch { return false; } };
  for (const d of ['', 'build', 'build-linux', 'build-debug', 'out', 'cmake-build-debug']) {
    if (has(join(d, 'compile_commands.json'))) return 'cpp';
  }
  if (has('tsconfig.json') || has('jsconfig.json')) return 'typescript';
  if (has('pyproject.toml') || has('setup.py') || has('setup.cfg') || has('requirements.txt') || has('Pipfile') || has('pyrightconfig.json')) return 'python';
  if (has('package.json')) return 'typescript';
  return null;
}

export async function graphCollectCodeIntel({ repoRoot, language, scope = 'changed', files, since, operations, budgetMs }) {
  if (!repoRoot) return { schema_version: '0.2', status: 'error', errors: [{ code: 'internal_error', message: 'repoRoot required' }], records: [] };

  // FIX 2: language defaults instead of hard-failing. Explicit wins; otherwise
  // infer from files[] extensions; otherwise default to 'cpp' (the games are
  // C++) — matching the other code_intel_* verbs' default.
  if (!language) {
    // Explicit wins; else infer from files[] extensions; else detect from repo
    // markers (so scope=all works without files[]); else default cpp.
    language = inferLanguageFromFiles(files) || detectRepoLanguage(repoRoot) || 'cpp';
  }

  ensureBuiltinProviders();

  // P0-1: thread the optional total time budget down to the provider so the
  // collect ALWAYS returns inside it (default ~40s via APG_COLLECT_BUDGET_MS),
  // never blocking past the MCP host's tool-call timeout on a cold index.
  const result = await runCollection({
    language,
    projectRoot: repoRoot,
    scope,
    files: Array.isArray(files) && files.length > 0 ? files : undefined,
    since,
    operations: operations || ['definitions', 'references', 'diagnostics'],
    ...(Number.isFinite(Number(budgetMs)) ? { budgetMs: Number(budgetMs) } : {})
  });

  // An error envelope carries no records and is already tiny — return as-is so
  // the error code/message reaches the agent unchanged (no import attempted).
  if (result.status === 'error') {
    return {
      schema_version: '0.2',
      status: 'error',
      collectionId: result.collectionId ?? null,
      provider: result.provider ?? null,
      errors: result.errors || [],
    };
  }

  // Import the FULL envelope into the local graph (internal — the DB IMPORT
  // needs every record). The importer returns the edge/node counts we surface
  // in the summary; the raw records[] never leave this function.
  let importStats = null;
  let edgeSample = [];
  let importError = null;
  try {
    const graphDir = join(repoRoot, '.aify-graph');
    mkdirSync(graphDir, { recursive: true });
    const dbPath = join(graphDir, 'graph.sqlite');
    if (!existsSync(dbPath)) {
      const db = openDb(dbPath);
      db.close();
    }
    // BLOCKER (field report, 10k-node C++ repo): this used to
    // `writeFileSync(tmp, JSON.stringify(result))` and re-read it. At 1.35M
    // records JSON.stringify exceeds V8's max string length and throws
    // "Invalid string length" — DETERMINISTICALLY, so retrying never helps.
    // The perverse consequence: the import succeeded only while the collection
    // was INCOMPLETE (a killed, partial run imported fine), so on a large repo
    // the trust spine could never reach full coverage — capping the whole
    // exhaustiveness story at ~24% verified.
    //
    // importV02Collection takes the envelope OBJECT, so the serialize →
    // write → read → parse round-trip was pure overhead. Removing it also stops
    // us leaving a full copy of every collection on disk (452MB of leftover
    // code-intel-*.json envelopes measured on that repo).
    const db = openExistingDb(dbPath, { readonly: false });
    try {
      importStats = importV02Collection(result, db);
      edgeSample = sampleLspEdges(db, { cap: 10 });
    } finally { db.close(); }
  } catch (err) {
    importError = { code: 'internal_error', message: `import failed: ${err.message}`, hint: 'collection succeeded but local import failed; re-run or import manually' };
  }

  // P0-1: when the provider hit the time budget, surface the resume note so MCP
  // hosts/agents that only render errors still get the "run again to complete"
  // signal. status stays 'partial', not 'error'.
  const sess = result.session || {};
  const notes = [];
  let budgetNote = null;
  if (sess.budgetExhausted) {
    const note = Array.isArray(result.notes)
      ? result.notes.find(n => n.code === 'budget_exhausted')
      : null;
    if (note) {
      budgetNote = {
        code: 'budget_exhausted',
        message: note.message,
        hint: 'partial result is already imported; re-run graph_collect_code_intel (warm) to continue/complete'
      };
    }
  }

  // HIGH-2 — BUDGETED SUMMARY. NEVER serialize result.records[] (the multi-MB
  // unity-TU flood). Surface only counts + a small edge sample. Raw records live
  // in the DB; use code_intel_replay / graph_pull's code_intel layer for them.
  const errors = [];
  if (importError) errors.push(importError);
  if (budgetNote && !errors.some(e => e.code === 'budget_exhausted')) errors.push(budgetNote);

  const summary = {
    schema_version: '0.2',
    summary: true, // explicit marker: this is the budgeted summary, not the raw envelope
    // A failed import must NOT read as `ok`. The collection may have succeeded,
    // but nothing landed in the graph — so the trust spine is unchanged and any
    // caller treating `ok` as "the spine now covers this" is misled. That is the
    // same shape of lie the exhaustiveness work removed: a green envelope over a
    // failed operation. Downgrade to 'error'; the details stay in errors[].
    status: importError ? 'error' : result.status, // 'ok' | 'partial' | 'error'
    importFailed: Boolean(importError),
    collectionId: result.collectionId,
    provider: result.provider ?? null,
    providerVersion: result.providerVersion ?? null,
    operations: operationCounts(result.operations),
    imported: importStats
      ? {
          recordsImported: importStats.recordsImported ?? null,
          edgesCreated: importStats.edgesCreated ?? 0,
          nodesCreated: importStats.nodesCreated ?? 0,
          edgesInvalidated: importStats.edgesInvalidated ?? 0,
        }
      : null,
    index: {
      indexReady: sess.indexReady ?? null,
      mode: sess.mode ?? null,
      budgetExhausted: !!sess.budgetExhausted,
      filesProcessed: sess.filesProcessed ?? null,
      filesTotal: sess.filesTotal ?? null,
    },
    sampleEdges: edgeSample, // ≤10 created LSP_VERIFIED CALLS edges (concrete evidence)
    recordCount: Array.isArray(result.records) ? result.records.length : 0,
    note: 'Compact summary — raw records[] are imported to the DB, not returned. Query them with code_intel_replay or graph_pull (code_intel layer).',
    ...(errors.length ? { errors } : {}),
    ...(notes.length ? { notes } : {}),
  };
  return summary;
}
