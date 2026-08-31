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
import { loadEffectiveIgnoredDirs, pathContainsIgnoredDir } from '../../ingest/ignored-dirs.js';

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

// THE BUDGET IS FOR THE VERB, NOT FOR ONE PHASE OF IT.
//
// `budgetMs` was threaded to runCollection only. The IMPORT that follows is
// unbounded and O(records) — on a 1.35M-record collection it dominates the wall
// clock. The observable result: the collect phase honestly reports
// `budgetExhausted: false` while the verb runs for half an hour, and the caller
// has no field telling them which phase ate the time. Sand Castle's full collect
// blew a 1800s host abort with the collect phase reporting itself well inside
// budget — which is the same shape of lie the exhaustiveness work removed, a green
// signal over an operation that did not fit.
//
// Two changes, both cheap:
//   1. When a caller sets budgetMs, reserve a share of it for the import so the
//      collection stops early enough that the WHOLE verb fits. A budget the verb
//      routinely overruns is not a budget.
//   2. Always report measured `timings`, so the phase that overran is a number
//      rather than an inference. This is what makes the reserve share tunable with
//      evidence instead of by feel.
const IMPORT_BUDGET_SHARE = 0.35;
// Never starve the collect phase into uselessness: below this it cannot warm
// clangd and resolve anything, so a tiny budget is better spent entirely on the
// collect and reported as overrun than split into two useless halves.
const MIN_COLLECT_BUDGET_MS = 5000;

// Records-per-file above which a collection looks like a per-symbol blowup rather
// than a big repo. Healthy C++ measures ~50-150/file; the 2026-07-30 explosion hit
// ~7,200/file. Set well clear of both so it fires on the class, not on outliers.
// Which file extensions a provider's language can collect. Used ONLY to size the eligible
// denominator for a coverage claim — not to select files, which the provider owns.
export const LANGUAGE_FILE_EXTENSIONS = Object.freeze({
  typescript: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
});

const RECORDS_PER_FILE_ANOMALY = 1000;

export function splitCollectBudget(budgetMs) {
  const total = Number(budgetMs);
  if (!Number.isFinite(total) || total <= 0) return { collectBudgetMs: null, importReserveMs: 0 };
  const collect = Math.round(total * (1 - IMPORT_BUDGET_SHARE));
  if (collect < MIN_COLLECT_BUDGET_MS) return { collectBudgetMs: total, importReserveMs: 0 };
  return { collectBudgetMs: collect, importReserveMs: total - collect };
}

/**
 * How many files a coverage claim is ABOUT — the denominator, counted from the graph and then
 * narrowed to the corpus.
 *
 * ⛔ IT USED TO BE `COUNT(DISTINCT file_path)` OVER EVERY NODE WITH A MATCHING EXTENSION, so it
 * counted files the corpus EXCLUDES. the field test flagged `files_eligible: 579` for this and I
 * replied it would resolve as a side effect of fixing the collector's enumeration. That reply was
 * WRONG: the enumerator decides what to WALK, this counts what is already in `nodes`, and the two
 * populations are reached by different routes.
 *
 * ⚠ The surviving route is RESOLUTION, not enumeration. A language server resolves a first-party
 * reference to a declaration in `node_modules/typescript/lib/lib.es5.d.ts`, and the record names
 * where the declaration actually is. Those nodes are honest — you cannot describe a reference to
 * `Array.prototype.map` without naming the file that declares it — but they are NOT part of the
 * population the claim is about.
 *
 * ⚠ NULL ON FAILURE OR EMPTY, NEVER 0. A zero denominator makes any ratio read as total coverage,
 * which is the failure this number exists to prevent.
 */
/**
 * The DISTINCT file paths matching these extensions, straight from the graph. NOTHING ELSE.
 *
 * ⛔ SPLIT OUT SO A PINNED READ CAN BE SHORT. `eligibleFileCount` reads the database AND calls
 * loadEffectiveIgnoredDirs, which walks the filesystem. graph_health called it inside
 * captureExistingSnapshot, so the WAL reader stayed open across that filesystem work — the exact
 * cost the pinned-snapshot helper exists to avoid, in the function that consolidated the authority
 * reads. A caller that needs this under a pin takes the ROWS there and filters after it closes.
 *
 * @returns {string[]} the paths, unfiltered
 * @returns {null}     no extensions to match — the caller asked nothing answerable
 */
export function eligibleFilePaths(db, { exts }) {
  if (!Array.isArray(exts) || exts.length === 0) return null;
  const clauses = exts.map((_, i) => `file_path LIKE $e${i}`).join(' OR ');
  const params = Object.fromEntries(exts.map((e, i) => [`e${i}`, `%${e}`]));
  return db.all(
    `SELECT DISTINCT file_path AS f FROM nodes WHERE file_path != '' AND (${clauses})`,
    params,
  ).map((r) => r.f);
}

/** Every DISTINCT file holding code-intel evidence, straight from the graph. NOTHING ELSE. */
export function coveredFilePaths(db) {
  return db.all(
    "SELECT DISTINCT file AS f FROM code_intel_records WHERE file IS NOT NULL AND file != ''",
  ).map((r) => r.f);
}

/**
 * Narrow an ALREADY-READ path list to the corpus. Filesystem work, no database handle — the other
 * half of the split above, and the half that must run after a snapshot closes.
 *
 * ⚠ NULL ON EMPTY, NEVER 0, for the same reason the counts below do: a zero denominator makes any
 * ratio read as total coverage.
 */
export function countInCorpus(paths, { repoRoot, exts = null }) {
  if (!Array.isArray(paths)) return null;
  // The same derived exclusion the sweep and the collector use, so "is this file in the corpus"
  // keeps having ONE answer rather than a third opinion here.
  const ignored = loadEffectiveIgnoredDirs(repoRoot);
  const n = paths
    .filter((f) => (exts === null ? true : exts.some((e) => String(f).toLowerCase().endsWith(e))))
    .filter((f) => !pathContainsIgnoredDir(f, ignored)).length;
  return n > 0 ? n : null;
}

export function eligibleFileCount(db, { exts, repoRoot }) {
  try {
    const paths = eligibleFilePaths(db, { exts });
    if (paths === null) return null;
    return countInCorpus(paths, { repoRoot });
  } catch {
    return null;
  }
}

/**
 * How many DISTINCT in-corpus files hold code-intel evidence right now — the numerator, counted
 * across every live collection.
 *
 * ⛔ HEALTH USED `latest.filesProcessed`, AND MY OWN PRUNE GUARDS BROKE THAT. It was a fair proxy
 * while the prune left exactly one collection standing: latest WAS everything. Once a continuation
 * and a file-scoped run were both correctly forbidden from superseding, collections accumulated —
 * 8 on this repo — and "the latest collection" became the last thing that ran rather than the sum
 * of what is known.
 *
 *     health said        3 of 557        the 3-file targeted collect, which is the latest
 *     actually covered   554 of 556      across all live collections
 *
 * A true statement about a collection, read as a statement about the repository. The same noun
 * error as `filesTotal` being the scope's denominator — and this time I introduced it, three
 * commits after fixing the denominator half of the same ratio.
 *
 * ⚠ Restricted to the corpus for the same reason the denominator is: resolution targets in
 * `node_modules` hold records and are not part of the population the claim is about. Counting them
 * in the numerator but not the denominator would push coverage ABOVE 100%.
 */
export function coveredFileCount(db, { exts, repoRoot }) {
  try {
    if (!Array.isArray(exts) || exts.length === 0) return null;
    return countInCorpus(coveredFilePaths(db), { repoRoot, exts });
  } catch {
    return null;
  }
}

export async function graphCollectCodeIntel({ repoRoot, language, scope = 'changed', files, since, operations, budgetMs }) {
  if (!repoRoot) return { schema_version: '0.2', status: 'error', errors: [{ code: 'invalid_request', message: 'repoRoot is required' }], records: [] };

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
  //
  // The provider only ever sees the COLLECT share — the rest is held back for the
  // import, which used to run outside every bound (see splitCollectBudget).
  const { collectBudgetMs, importReserveMs } = splitCollectBudget(budgetMs);
  const collectStartedAt = Date.now();
  const result = await runCollection({
    language,
    projectRoot: repoRoot,
    scope,
    files: Array.isArray(files) && files.length > 0 ? files : undefined,
    since,
    operations: operations || ['definitions', 'references', 'diagnostics'],
    ...(collectBudgetMs != null ? { budgetMs: collectBudgetMs } : {})
  });
  const collectMs = Date.now() - collectStartedAt;

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
  let explosionWarning = null;
  const importStartedAt = Date.now();
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
      // EXPLOSION CANARY, checked BEFORE the import rather than inferred from its
      // duration afterwards.
      //
      // The import is O(records) and cannot be safely truncated: a half-imported
      // collection is missing edges, and missing edges read as "no callers" — the
      // exact false-absence this tool exists to prevent. So the bound belongs on
      // the INPUT, and the budget split already caps the collect phase that
      // produces it.
      //
      // What that split cannot catch is a per-symbol BLOWUP, where few files yield
      // enormous records. That is what happened on 2026-07-30: guessed identifier
      // positions made clangd answer about the wrong symbol, and 46 files produced
      // 330,794 records and a 6.3-minute import against a 100s budget. The fix for
      // the cause shipped (103020f) and the same batch now yields ~7,400 records in
      // 2.3s — but a canary is what turns the NEXT bug of that class into a
      // reported anomaly instead of a mysterious stall.
      //
      // Warn rather than refuse: a genuinely huge repo is allowed to be huge, and a
      // refusal here would block real work over a heuristic.
      const recordCount = Array.isArray(result.records) ? result.records.length : 0;
      const filesSeen = Number(result.session?.filesProcessed) || 0;
      const perFile = filesSeen > 0 ? recordCount / filesSeen : 0;
      if (perFile > RECORDS_PER_FILE_ANOMALY) {
        explosionWarning = {
          code: 'record_volume_anomaly',
          message: `${recordCount} records from ${filesSeen} files (~${Math.round(perFile)}/file) is far above the typical ~50-150/file`
            + ' — this is the signature of a per-symbol reference blowup, not a large repo.',
          // ⚠ THE UNIT IS SYMBOLS, AND SAYING SO IS THE WHOLE POINT OF THIS EDIT. Review read
          // `positionGuessSkipped: 25` on a 79-file collection and had to correct me: I reported it
          // as "every one of 25 processed FILES skipped a guess". It counts SYMBOL records whose
          // identifier column could not be located, so definitions/references were never issued for
          // them. There is no per-file distribution in that scalar.
          //
          // ⇒ A count whose unit a reader must guess is a count they will guess wrong, and the name
          // does not carry it. Naming the unit at the point of use costs one clause.
          hint: 'check index.positionGuessSkipped and index.refsTruncatedSymbols in this response.'
            + ' BOTH ARE COUNTS OF SYMBOLS, not files: positionGuessSkipped is the number of SYMBOL'
            + ' records whose identifier column could not be located, so definitions/references were'
            + ' NOT queried for them and their relations sit outside the collected numerator.'
            + ' A high value means symbols were queried at positions that could not be placed, so the'
            + ' references may belong to the wrong symbols.',
        };
      }
      // ⛔ THE DENOMINATOR A COVERAGE CLAIM IS ABOUT, ATTACHED BEFORE IMPORT.
      //
      // `session.filesTotal` is the SCOPE's total — a `scope:"files"` run with three paths
      // reports 3 of 3, which reads as 100%. Nothing recorded how many files the provider COULD
      // have collected, so a 3-file run and a 484-file run were indistinguishable once stored,
      // and graph_health concluded "a collection exists, therefore nothing to warn about".
      //
      // Counted from the GRAPH rather than from the filesystem: the eligible population is the
      // files this provider's language actually has nodes for, which is the same population a
      // caller's question is about. Null on failure, NEVER 0 — a zero denominator would make any
      // ratio computed from it read as total coverage, which is the failure this exists to stop.
      result.session = result.session || {};
      if (result.session.filesEligible == null) {
        try {
          const exts = LANGUAGE_FILE_EXTENSIONS[language] ?? [];
          if (exts.length > 0) {
            // ⛔ COUNTED FROM THE GRAPH, SO IT COUNTS WHAT THE GRAPH HOLDS — INCLUDING FILES THE
            // CORPUS EXCLUDES. the field test flagged `files_eligible: 579` as counting excluded
            // trees, and I replied it would resolve as a side effect of fixing the collector's
            // enumeration. IT DID NOT, AND THAT REPLY WAS WRONG: the enumerator decides what to
            // WALK, this query counts what is already in `nodes`, and the two populations are
            // reached by different routes.
            //
            // ⚠ The route that survives is RESOLUTION, not enumeration: a language server resolves
            // a first-party reference to a declaration in `node_modules/typescript/lib/lib.es5.d.ts`
            // and the record names where the declaration actually is. Those nodes are honest — you
            // cannot describe a reference to `Array.prototype.map` without naming the file that
            // declares it — but they are NOT part of the population a coverage claim is about, and
            // counting them makes the denominator quietly wrong in the safe-looking direction.
            //
            // Same derived exclusion the sweep and the collector use, so "is this file in the
            // corpus" keeps having ONE answer.
            result.session.filesEligible = eligibleFileCount(db, { exts, repoRoot });
          }
        } catch { result.session.filesEligible = null; }
      }
      importStats = importV02Collection(result, db);
      edgeSample = sampleLspEdges(db, { cap: 10 });
    } finally { db.close(); }
  } catch (err) {
    importError = { code: 'internal_error', message: `import failed: ${err.message}`, hint: 'collection succeeded but local import failed; re-run or import manually' };
  }
  const importMs = Date.now() - importStartedAt;
  const totalMs = collectMs + importMs;

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
      // ⛔ THE CALLER WAS LEFT TO COMPUTE ITS OWN REMAINDER, AND THE FIELDS INVITE GETTING IT WRONG.
      // `filesProcessed` resets every call and `filesTotal` is the SCOPE's total, so "how much is
      // left" is derivable only by combining three fields correctly. Measured on click: processed
      // 25, enumerated 79, resumedFrom 0 — 54 remain, and nothing said so.
      //
      // ⚠ THE PROJECTION IS LABELLED A PROJECTION, NEVER A COST. Review was explicit: warm index
      // state, per-file symbol populations and timeouts make the next pass non-exchangeable with
      // this one, so "2 more calls" would be a promise this cannot keep. Stating the observed rate
      // and calling the extrapolation what it is leaves the caller to decide.
      const processed = Number(sess.filesProcessed);
      const enumerated = Number(sess.enumeratedTotal);
      const from = Number(sess.resumedFrom) || 0;
      const done = Number.isFinite(processed) ? from + processed : null;
      const remaining = (Number.isFinite(enumerated) && done !== null) ? Math.max(0, enumerated - done) : null;
      const projection = (remaining !== null && Number.isFinite(processed) && processed > 0)
        ? Math.ceil(remaining / processed)
        : null;

      budgetNote = {
        code: 'budget_exhausted',
        message: note.message,
        hint: 'partial result is already imported; re-run graph_collect_code_intel (warm) to continue'
          + (remaining !== null
            ? ` — EXACTLY ${remaining} of ${enumerated} enumerated file(s) remain (${done} done, `
              + `${processed} this pass)`
            : ' — the remaining count could not be derived from this session, so treat coverage as UNKNOWN')
          + (projection !== null
            ? `. PROJECTION ONLY, not a promise: at this pass's rate that is ~${projection} more call(s); `
              + 'a warm index and different per-file symbol populations make the next pass '
              + 'non-exchangeable with this one'
            : ''),
      };
    }
  }

  // HIGH-2 — BUDGETED SUMMARY. NEVER serialize result.records[] (the multi-MB
  // unity-TU flood). Surface only counts + a small edge sample. Raw records live
  // in the DB; use code_intel_replay / graph_pull's code_intel layer for them.
  const errors = [];
  if (importError) errors.push(importError);
  if (explosionWarning) notes.push(explosionWarning);
  if (budgetNote && !errors.some(e => e.code === 'budget_exhausted')) errors.push(budgetNote);

  // NAME THE PHASE THAT OVERRAN. Without this the caller sees a collect phase
  // reporting itself inside budget next to a verb that took far longer, and has to
  // guess. A measured attribution is the difference between "APG is slow" and
  // "the import is O(records) and this collection had 1.35M of them".
  if (Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0 && totalMs > Number(budgetMs)) {
    const worst = importMs > collectMs ? 'import' : 'collect';
    notes.push({
      code: 'budget_overrun',
      message: `verb took ${totalMs}ms against a ${Number(budgetMs)}ms budget (collect ${collectMs}ms, import ${importMs}ms)`
        + ` — the ${worst} phase dominated.`,
      hint: worst === 'import'
        ? `the import is O(records) and this collection produced ${Array.isArray(result.records) ? result.records.length : 0};`
          + ' narrow with files[] or a smaller scope, or raise budgetMs — the collect phase alone cannot bound it'
        : 'raise budgetMs, or narrow scope/files[] so the collect phase converges sooner',
    });
  }

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
          // WHY 0 INVALIDATED. Without these two fields, "edgesInvalidated: 0"
          // is ambiguous between "correctly preserved out-of-scope edges" and
          // "the delete matched nothing at all" — and those look identical while
          // meaning opposite things about whether the scope guard engaged. A
          // verification that cannot tell them apart is vacuous, which is the
          // trap this whole hardening pass has been closing.
          ...(importStats.invalidationScopedTo != null
            ? { invalidationScopedTo: importStats.invalidationScopedTo }
            : {}),
          ...(importStats.invalidationSkipped
            ? { invalidationSkipped: importStats.invalidationSkipped }
            : {}),
        }
      : null,
    index: {
      indexReady: sess.indexReady ?? null,
      mode: sess.mode ?? null,
      budgetExhausted: !!sess.budgetExhausted,
      filesProcessed: sess.filesProcessed ?? null,
      filesTotal: sess.filesTotal ?? null,
      // How many symbols were queried at a GUESSED position because their
      // identifier column could not be located. Non-zero means some answers in
      // this collection are not ground truth (see identifier-position.js).
      positionGuesses: sess.positionGuesses ?? null,
      // ABSENT AND ZERO ARE DIFFERENT ANSWERS. These were emitted by the provider
      // and dropped here, so a caller saw `positionGuesses: 55` with no skip count
      // and could not tell "nothing was skipped" from "we don't report skips" —
      // the exact conflation the guessed-position work exists to prevent, in the
      // verb reporting it. Always emitted, `null` when unknown, never omitted.
      positionGuessSkipped: sess.positionGuessSkipped ?? null,
      refsTruncatedSymbols: sess.refsTruncatedSymbols ?? null,
      // Definitions and references that resolved OUTSIDE the repository and were therefore not
      // recorded — a language server reaching installed packages or its own bundled stubs. They
      // used to be stored with a raw file:// URI in `file_path`, pointing at a different copy of
      // the library than the one under edit.
      //
      // ⚠ A SIBLING COUNTER IN A BLOCK A READER ALREADY CONSULTS, beside positionGuessSkipped and
      // refsTruncatedSymbols. Skipping these without reporting the count would replace a wrong
      // answer with an unexplained gap: the caller set is a floor, and this names one reason why.
      //
      // ⛔ AND IT WAS ADDED TO THE PROVIDER'S SESSION FIRST WITHOUT THIS LINE, so the count existed
      // and no caller could see it — the same unreachable-by-the-consumer defect this audit keeps
      // turning up, committed inside the fix for another instance of it.
      outOfRepoSkipped: sess.outOfRepoSkipped ?? null,
      // RESUME STATE. `filesProcessed` resets every call, so on its own it cannot
      // show whether repeated runs are CONVERGING or just repeating — which is
      // exactly the ambiguity that let "run again to continue" stay false for so
      // long. resumedFrom climbing toward enumeratedTotal is the convergence
      // signal; resumeLedger says whether continuation is even in play.
      resumedFrom: sess.resumedFrom ?? null,
      enumeratedTotal: sess.enumeratedTotal ?? null,
      resumeLedger: sess.resumeLedger ?? null,
    },
    // MEASURED, always. The import used to be invisible: a caller could see a
    // collect phase inside its budget next to a verb that ran for half an hour and
    // had no field to attribute it with.
    timings: {
      collectMs,
      importMs,
      totalMs,
      budgetMs: Number.isFinite(Number(budgetMs)) ? Number(budgetMs) : null,
      collectBudgetMs,
      importReserveMs,
    },
    sampleEdges: edgeSample, // ≤10 created LSP_VERIFIED CALLS edges (concrete evidence)
    recordCount: Array.isArray(result.records) ? result.records.length : 0,
    // code_intel_replay is not in the default tools/list profile, so it was named at readers
    // who could not call it. graph_pull is listed and reaches the same imported records.
    note: 'Compact summary — raw records[] are imported to the DB, not returned. Query them with '
      + 'graph_pull (code_intel layer); code_intel_replay also does, where the full toolset is enabled.',
    ...(errors.length ? { errors } : {}),
    ...(notes.length ? { notes } : {}),
  };
  return summary;
}
