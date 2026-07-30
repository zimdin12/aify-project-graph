import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LspClient } from '../lsp-client.js';
import { toRepoRelative, uriToRepoRelativeSafe } from '../../ingest/code-intel/paths.js';
import { prepareCompileDb, enumerateFirstParty } from '../compile-db.js';
import { buildClangdSpawn } from '../resolve-clangd.js';
import { getHeadCommit } from '../../freshness/git.js';
import { findIdentifierPosition, leafNameOf } from '../identifier-position.js';
import { readLedger, writeLedger, pendingFiles } from '../collect-ledger.js';

// Cold-collect request timeout: a fresh background-index pass over a game repo
// can take well over the default 10s before the first query resolves.
const COLD_COLLECT_TIMEOUT_MS = 60000;

// Code-Intel v2 FIX A: how long to wait for clangd's background index to go
// idle before issuing `references`. The master-plan mode matrix:
//   INDEXED (default) — background-index ON; WAIT for readiness so cross-TU
//     callers are visible. Only then are references trustworthy-as-exhaustive.
//   BOUNDED (APG_CLANGD_MODE=bounded) — never wait; fast inner-loop; never
//     claims exhaustive.
// Bounded wait — never hangs forever. Override via APG_CLANGD_INDEX_WAIT_MS.
const DEFAULT_INDEX_WAIT_MS = 90000;

// P0-1: TOTAL wall-clock budget for one collect() call. A cold clangd
// background-index pass can take ~50s+ before queries resolve, which exceeds
// the MCP host's tool-call timeout and drops the stdio connection (the whole
// tool set de-registers). We cap the entire collect at this budget and return
// a `partial` envelope with a resume signal well before the host times out, so
// the warm second call completes. Override via APG_COLLECT_BUDGET_MS or the
// `budgetMs` collect arg.
const DEFAULT_COLLECT_BUDGET_MS = 40000;
// Reserve at the tail of the budget so shutdown + envelope assembly + (in the
// verb) the local import all complete inside the budget rather than racing it.
const BUDGET_TAIL_RESERVE_MS = 3000;

// Per-symbol reference cap. A hub symbol can return tens of thousands of
// references; every one becomes a record and the import is O(records). Truncation
// is always REPORTED on the record (truncated/totalReferences) so a capped set is
// read as a FLOOR, never as a complete answer.
const MAX_REFS_PER_SYMBOL = 2000;

function resolveClangdMode() {
  const raw = String(process.env.APG_CLANGD_MODE || 'indexed').trim().toLowerCase();
  return raw === 'bounded' ? 'bounded' : 'indexed';
}

function resolveIndexWaitMs() {
  const raw = Number(process.env.APG_CLANGD_INDEX_WAIT_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INDEX_WAIT_MS;
}

// P0-1: resolve the total collect budget. Explicit `req.budgetMs` wins, then
// APG_COLLECT_BUDGET_MS, then the default. A value <= 0 disables the budget
// (treated as effectively unbounded) so existing unbounded callers/tests can
// opt out.
function resolveCollectBudgetMs(req) {
  const argRaw = Number(req && req.budgetMs);
  if (Number.isFinite(argRaw)) return argRaw > 0 ? argRaw : Infinity;
  const envRaw = Number(process.env.APG_COLLECT_BUDGET_MS);
  if (Number.isFinite(envRaw)) return envRaw > 0 ? envRaw : Infinity;
  return DEFAULT_COLLECT_BUDGET_MS;
}

const PROVIDER_NAME = 'cpp-clangd';
const PROVIDER_VERSION = '0.1.0';

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

// Repo-relative path prefixes that almost always represent
// build/dep/vendor/third-party noise from CMake-style generators. Filtered by
// default to keep scope=all from drowning in unity-build dupes and external
// dep sources. Override by passing explicit files[].
export const BUILD_DEP_PREFIXES = [
  'build/', 'build_', 'cmake-build-', '_build/', 'out/',
  '_deps/', 'deps/', 'third_party/', 'third-party/', 'vendor/',
  'node_modules/', '.deps/', '.cache/', 'extern/', 'external/'
];

function rangeFromLsp(range) {
  return {
    start: { line: range.start.line + 1, col: range.start.character + 1 },
    end: { line: range.end.line + 1, col: range.end.character + 1 }
  };
}

// Routes through the shared normalizer so a collection cannot record raw
// `file:///C:/...` URIs (or throw outright) when clangd's canonical path form
// differs from projectRoot's — 8.3 short names, junctions, drive-letter case.
// See uriToRepoRelativeSafe.
function uriToRepoRelative(uri, projectRoot) {
  return uriToRepoRelativeSafe(uri, projectRoot).path;
}

function severityFromLsp(sev) {
  return ({ 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' })[sev] || 'info';
}

function deriveConfidence(kind, context) {
  if (kind === 'definition') return 'high';
  if (kind === 'reference') {
    if (context === 'virtual_call' || context === 'template_inst' || context === 'macro_expansion') return 'medium';
    return 'high';
  }
  return 'high';
}

function symbolIdFor(file, line, col) {
  return `c:cpp:${file}:${line}:${col}`;
}

export function createCppClangdProvider({ spawn } = {}) {
  return {
    capabilities() {
      return {
        provider: PROVIDER_NAME,
        version: PROVIDER_VERSION,
        languages: ['cpp'],
        operations: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'],
        freshnessBasis: 'compile_db_hash',
        warmupRequired: true,
        limits: { maxBatchFiles: 256, maxRequestMs: 30000 }
      };
    },

    async collect(req) {
      const collectionId = newCollectionId();
      const collectedAt = new Date().toISOString();
      const projectRoot = req.projectRoot;
      // Record HEAD at collect time so graph_health can detect commit-drift
      // staleness (lsp-evidence's STALE check keys on indexedCommit; previously
      // always null → staleness was undetectable). Best-effort.
      const indexedCommit = await getHeadCommit(projectRoot).catch(() => null);

      // P0-1: start the total budget clock. `remainingBudget()` is consulted to
      // cap the index-readiness wait and to stop the per-file loop early so the
      // call ALWAYS returns inside the budget (never hanging past the MCP host
      // timeout). budgetMs===Infinity means "no budget" (legacy unbounded).
      const budgetMs = resolveCollectBudgetMs(req);
      const budgetStart = Date.now();
      const budgetEnabled = Number.isFinite(budgetMs);
      const budgetElapsed = () => Date.now() - budgetStart;
      const remainingBudget = () => (budgetEnabled ? Math.max(0, budgetMs - budgetElapsed()) : Infinity);

      // L1: discover + normalize the richest compile DB (WSL→host paths,
      // unity detection, dep filtering) and write it under .aify-graph.
      const compileDb = prepareCompileDb({ projectRoot });
      if (!compileDb.found) {
        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: { collectedAt, freshnessBasis: 'unknown' },
          operations: {},
          status: 'error',
          errors: (compileDb.diagnostics || []).map(d => ({
            code: d.code,
            message: d.message,
            hint: d.fix
          })),
          diagnostics: compileDb.diagnostics || [],
          records: []
        };
      }

      const compileCmds = compileDb.normalizedPath;
      const dbHash = compileDb.dbHash;
      // File-list resolution: explicit files[] wins; otherwise enumerate from
      // compile_commands.json for scope=all (Plan #10a). Plan #10c added
      // build/dep prefix filtering and a maxFiles cap (default 200) after
      // unbounded scope=all hung 8 minutes silently on Sand Castle.
      let files;
      let enumStats = null;
      // Resume bookkeeping — see collect-ledger.js. `ledger` stays null for an
      // explicit files[] request so that path is unchanged.
      let ledger = null;
      let resumedFrom = 0;
      let enumeratedTotal = null;
      const maxFiles = Number.isFinite(req.maxFiles) ? req.maxFiles : 200;
      const explicitFileScope = Boolean(req.files && req.files.length > 0);
      if (explicitFileScope) {
        files = req.files;
      } else if (req.scope === 'all' || req.scope === 'changed') {
        const enum_ = enumerateFirstParty(compileCmds, projectRoot, { maxFiles, skipBuildDepFilter: !!req.skipBuildDepFilter });
        files = enum_.files;
        enumStats = enum_.stats;
        if (process.env.APG_VERBOSE_CODE_INTEL) {
          process.stderr.write(`[apg code-intel] enumerated ${enumStats.total} compile_db entries → ${enumStats.after_filter} after filter (${enumStats.filtered_build_dep} build/dep filtered, ${enumStats.unity} unity)${enumStats.truncated ? `; truncated to ${maxFiles}` : ''}${enumStats.skipped_build_dep_filter ? ' [filter disabled]' : ''}\n`);
        }
        // Plan #10d: when the filter eliminates every entry (CMake unity-build
        // or anything where all sources live under filtered prefixes), emit a
        // structured error instead of returning status=ok with 0 records. The
        // user can recover with --no-build-filter or explicit --files.
        if (enumStats.total > 0 && enumStats.after_filter === 0 && !enumStats.skipped_build_dep_filter) {
          return {
            schema_version: '0.2',
            collectionId,
            provider: PROVIDER_NAME,
            providerVersion: PROVIDER_VERSION,
            projectRoot,
            session: { collectedAt, freshnessBasis: 'compile_db_hash', freshnessValue: dbHash, compileDbHash: dbHash, enumeration: enumStats },
            operations: {},
            status: 'error',
            errors: [{
              code: 'compile_db_all_filtered',
              message: `every compile_commands.json entry (${enumStats.total}) was filtered by the build/dep prefix rules (${enumStats.filtered_build_dep} excluded, ${enumStats.unity} unity). This commonly happens on CMake unity builds where all TUs live under Unity/ or build/.`,
              hint: 'pass --no-build-filter to disable the prefix filter, or pass --files <specific.cpp,...> to collect explicit sources outside the compile DB'
            }],
            diagnostics: compileDb.diagnostics || [],
            records: []
          };
        }
        // REAL RESUME. Drop files a previous run already covered under this same
        // compile-DB hash. Without this the loop restarted at 0 every call, so the
        // envelope's "run again to continue/complete" was aspirational — a warm
        // redo that re-walked the same files and regenerated their records, which
        // is how a 185-file repo grew a bigger import on each "resume" instead of
        // converging. Explicit files[] deliberately does NOT consult the ledger:
        // that is the caller stating what they want.
        if (req.resume !== false) {
          ledger = readLedger(projectRoot, dbHash);
          const split = pendingFiles(files, ledger);
          resumedFrom = split.alreadyCollected.length;
          if (resumedFrom > 0 && process.env.APG_VERBOSE_CODE_INTEL) {
            process.stderr.write(`[apg code-intel] resuming: ${resumedFrom} file(s) already collected under compile-db ${String(dbHash).slice(0, 8)}; ${split.remaining.length} remaining\n`);
          }
          enumeratedTotal = files.length;
          files = split.remaining;
        }
      } else {
        // No explicit files[] and scope is neither all/changed: nothing to
        // collect. Return a structured no_files note rather than the old dead
        // hardcoded fallback (['src/foo.cpp','src/bar.cpp']).
        files = [];
        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: { collectedAt, freshnessBasis: 'compile_db_hash', freshnessValue: dbHash, compileDbHash: dbHash },
          operations: {},
          status: 'ok',
          notes: [{
            code: 'no_files',
            message: `no files to collect: pass files[] or scope=all/changed (scope was ${req.scope || 'unset'})`
          }],
          diagnostics: compileDb.diagnostics || [],
          records: []
        };
      }

      // L1 spawn upgrade: background-index ON, in-memory PCH, bounded -j,
      // large result cap, and --compile-commands-dir pointed at the normalized
      // DB. Tests override via injected `spawn`.
      const spawnConfig = (spawn && spawn(req)) || buildClangdSpawn({ projectRoot, compileDb });
      const client = new LspClient({
        ...spawnConfig,
        rootUri: pathToFileURL(projectRoot).toString(),
        timeoutMs: COLD_COLLECT_TIMEOUT_MS
      });

      const records = [];
      const operations = {};
      const requestedOps = new Set(req.operations || ['definitions', 'references', 'diagnostics']);

      try {
        await client.start();

        // Batch warmup: open every requested file so cross-file refs resolve.
        let warmupStart = Date.now();
        for (const rel of files) {
          const abs = path.join(projectRoot, rel);
          let text = '';
          try { text = fs.readFileSync(abs, 'utf8'); } catch { /* skip missing */ }
          const uri = pathToFileURL(abs).toString();
          await client.didOpen(uri, 'cpp', text);
        }
        const warmupMs = Date.now() - warmupStart;
        await new Promise(r => setTimeout(r, 100));

        // Code-Intel v2 FIX A: in INDEXED mode, wait for clangd's background
        // index to go idle BEFORE issuing references — otherwise cross-TU
        // callers race the index and come back not_found_after_retry, and the
        // lsp-verified upgrade is non-deterministic. BOUNDED mode skips the
        // wait (fast inner-loop; never claims exhaustive).
        const mode = resolveClangdMode();
        let indexReady = false;
        let indexWaitMs = 0;
        let indexWaitReason = 'skipped_bounded_mode';
        if (mode === 'indexed') {
          // P0-1: cap the readiness wait at min(its own budget, remaining total
          // budget − tail reserve) so a cold index never consumes the whole
          // call. When the cap is hit before the index drains, waitForIndexReady
          // resolves ready:false and we fall through to a budget-aware partial.
          const ownWaitBudget = resolveIndexWaitMs();
          const budgetCap = budgetEnabled
            ? Math.max(0, remainingBudget() - BUDGET_TAIL_RESERVE_MS)
            : ownWaitBudget;
          const indexWaitBudget = Math.min(ownWaitBudget, budgetCap);
          try {
            const r = await client.waitForIndexReady({ timeoutMs: indexWaitBudget });
            indexReady = !!r.ready;
            indexWaitMs = r.waitMs;
            indexWaitReason = r.reason;
          } catch {
            indexReady = false;
            indexWaitReason = 'index_wait_error';
          }
          if (process.env.APG_VERBOSE_CODE_INTEL) {
            process.stderr.write(`[apg code-intel] index readiness: ready=${indexReady} waitMs=${indexWaitMs} reason=${indexWaitReason}\n`);
          }
        }
        // Per-symbol reference outcome tallies (FIX B). found = symbols whose
        // `references` resolved ≥1 location; notFound = not_found_after_retry.
        let refsFoundSymbols = 0;
        let refsNotFoundSymbols = 0;
        // Symbols whose identifier column could not be located, so every LSP
        // request for them was issued at a GUESSED position. Reported in the
        // envelope: a clangd answer at a guessed position is not ground truth, and
        // silence about that is how a type-reference became a CALLS [lsp✓] edge.
        let positionGuesses = 0;
        // Symbols whose relations were DECLINED because their position was
        // guessed, and symbols whose reference set hit the cap.
        let positionGuessSkipped = 0;
        let refsTruncatedSymbols = 0;

        // For each file: try documentSymbol → definitions / references / hover at top symbol position.
        for (const op of ['definitions', 'references', 'hover', 'symbols']) {
          if (!requestedOps.has(op)) {
            operations[op] = { status: 'not_collected', reason: 'not_requested' };
          } else {
            operations[op] = { status: 'ok', count: 0 };
          }
        }
        if (requestedOps.has('diagnostics')) operations.diagnostics = { status: 'ok', count: 0 };
        else operations.diagnostics = { status: 'not_collected', reason: 'not_requested' };

        // P0-1: per-file budget bookkeeping. `filesProcessed` counts files we
        // fully ran the requested ops over; `budgetExhausted` flips when we stop
        // the loop early (or the index wait was cut short) so the envelope can
        // carry a resume signal.
        let filesProcessed = 0;
        let budgetExhausted = false;
        // The index wait may already have been cut short by the budget; if so we
        // are out of budget before processing any file.
        if (budgetEnabled && remainingBudget() <= BUDGET_TAIL_RESERVE_MS) {
          budgetExhausted = true;
        }

        const PROGRESS_EVERY = 25;
        for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
          // P0-1: stop early if the remaining budget can't safely cover another
          // file's per-symbol queries. Return what we have so far rather than
          // blocking past the MCP host timeout.
          if (budgetEnabled && remainingBudget() <= BUDGET_TAIL_RESERVE_MS) {
            budgetExhausted = true;
            break;
          }
          const rel = files[fileIdx];
          if (process.env.APG_VERBOSE_CODE_INTEL && fileIdx > 0 && fileIdx % PROGRESS_EVERY === 0) {
            process.stderr.write(`[apg code-intel] processed ${fileIdx}/${files.length} files...\n`);
          }
          const abs = path.join(projectRoot, rel);
          const uri = pathToFileURL(abs).toString();

          let symbols = [];
          if (requestedOps.has('symbols') || requestedOps.has('definitions') || requestedOps.has('references')) {
            try { symbols = (await client.documentSymbol(uri)) || []; } catch { symbols = []; }
          }

          // Cache source text once per file so SymbolInformation entries
          // can derive the actual identifier column. SymbolInformation only
          // has `location.range` (full body), not selectionRange.
          let sourceLines = null;
          const loadSourceLines = () => {
            if (sourceLines !== null) return sourceLines;
            try { sourceLines = fs.readFileSync(path.join(projectRoot, rel), 'utf8').split(/\r?\n/u); }
            catch { sourceLines = []; }
            return sourceLines;
          };

          for (const sym of symbols) {
            // Normalize DocumentSymbol vs SymbolInformation. clangd 18.x emits
            // flat SymbolInformation[] by default (no selectionRange/range,
            // has location.range covering the whole body). DocumentSymbol[]
            // has selectionRange pointing at the identifier directly.
            let bodyRange, pos;
            let posGuessed = false;
            if (sym.location && sym.location.range) {
              // SymbolInformation. Body range covers the whole declaration;
              // the identifier column is not directly known. Find the leaf
              // name (after final '::') on the declaration line and use its
              // column. If not findable, fall back to column 0 — better
              // than (0,0) since the line is still correct.
              bodyRange = sym.location.range;
              const found = findIdentifierPosition(loadSourceLines(), bodyRange.start.line, leafNameOf(sym.name));
              posGuessed = found.guessed;
              if (posGuessed) positionGuesses += 1;
              pos = { line: found.line, character: found.character };
            } else {
              bodyRange = sym.selectionRange || sym.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
              pos = bodyRange.start;
            }
            const symbolId = symbolIdFor(rel, pos.line + 1, pos.character + 1);
            const qname = sym.name || '<anon>';
            const range = bodyRange;

            if (requestedOps.has('symbols')) {
              records.push({
                schema_version: '0.2', collectionId, kind: 'symbol',
                language: 'cpp', symbolId, qname, name: sym.name, file: rel,
                range: rangeFromLsp(range),
                confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                freshness: `compile_db_hash:${dbHash}`, result_state: 'found'
              });
              operations.symbols.count += 1;
            }

            // A GUESSED POSITION MUST NOT BE QUERIED FOR RELATIONS.
            //
            // When the identifier column cannot be located we fall back to column
            // 0 of the declaration line — which is whatever token happens to sit
            // there: a return type, a namespace, a macro. Asking clangd for
            // definitions/references AT that position returns a truthful answer
            // about the WRONG SYMBOL, and we were recording it under this symbol's
            // id. For a common type that is tens of thousands of references.
            //
            // Field measurement (sc-manager, 2026-07-30) — two adjacent batches of
            // the same repo, minutes apart, one server process:
            //     files 1-60    3,083 refs   (~51/file)     55 guessed positions
            //     files 61-106  1,618,718 refs (~35,190/file) 1,412 guessed
            // A 500x per-file discontinuity moving in lockstep with the guess
            // count. He reported the DISCONTINUITY rather than judging 1.6M
            // implausible for templated C++, which is what made it diagnosable.
            //
            // The symbol record still stands — documentSymbol told us it exists.
            // What we decline to do is attribute relations we cannot place.
            if (posGuessed) {
              positionGuessSkipped += 1;
              records.push({
                schema_version: '0.2', collectionId, kind: 'symbol',
                language: 'cpp', symbolId, qname, name: sym.name, file: rel,
                range: rangeFromLsp(range),
                confidence: 'low', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                freshness: `compile_db_hash:${dbHash}`,
                result_state: 'position_unresolved',
                note: 'identifier column could not be located on the declaration line;'
                  + ' definitions/references were NOT queried because a position we cannot place'
                  + ' returns answers about a different symbol',
              });
              continue;
            }

            if (requestedOps.has('definitions')) {
              try {
                const defs = (await client.definition(uri, pos)) || [];
                for (const d of (Array.isArray(defs) ? defs : [defs])) {
                  if (!d?.uri) continue;
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'definition',
                    language: 'cpp', symbolId, qname,
                    file: uriToRepoRelative(d.uri, projectRoot),
                    range: rangeFromLsp(d.range),
                    confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    freshness: `compile_db_hash:${dbHash}`, result_state: 'found'
                  });
                  operations.definitions.count += 1;
                }
              } catch { /* swallow per-symbol */ }
            }

            if (requestedOps.has('references')) {
              try {
                let refs = (await client.references(uri, pos)) || [];
                let resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
                if (refs.length === 0) {
                  // Capable-target warm-and-retry.
                  await new Promise(r => setTimeout(r, 30));
                  refs = (await client.references(uri, pos)) || [];
                  resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
                }
                if (resultState === 'not_found_after_retry') {
                  refsNotFoundSymbols += 1;
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'reference',
                    language: 'cpp', symbolId, qname,
                    confidence: 'low', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    result_state: 'not_found_after_retry'
                  });
                } else {
                  refsFoundSymbols += 1;
                  // PER-SYMBOL CAP. Even at a correctly-placed position, a genuine
                  // hub (a widely-used type, a base-class method) can return tens
                  // of thousands of references. Every one becomes a record and the
                  // import is O(records), so a handful of hubs can dominate the
                  // whole collection: 330,794 records imported in one 46-file batch
                  // took 6.3 minutes against a 100s budget (field, 2026-07-30).
                  //
                  // Truncation is REPORTED per record, never silent — a capped set
                  // is a FLOOR, and a downstream "no other callers" read off a
                  // silently-capped set would be exactly the false-completeness
                  // failure this codebase exists to prevent.
                  const kept = refs.slice(0, MAX_REFS_PER_SYMBOL);
                  const droppedRefs = refs.length - kept.length;
                  if (droppedRefs > 0) refsTruncatedSymbols += 1;
                  for (const ref of kept) {
                    records.push({
                      schema_version: '0.2', collectionId, kind: 'reference',
                      language: 'cpp', symbolId, qname,
                      file: uriToRepoRelative(ref.uri, projectRoot),
                      range: rangeFromLsp(ref.range),
                      context: 'call_expr',
                      confidence: deriveConfidence('reference', 'call_expr'),
                      provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                      freshness: `compile_db_hash:${dbHash}`,
                      result_state: 'found',
                      ...(droppedRefs > 0 ? { truncated: droppedRefs, totalReferences: refs.length } : {}),
                    });
                  }
                  operations.references.count += kept.length;
                  if (droppedRefs > 0) operations.references.status = 'partial';
                }
              } catch { /* swallow per-symbol */ }
            }

            if (requestedOps.has('hover')) {
              try {
                const hov = await client.hover(uri, pos);
                if (hov && hov.contents) {
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'hover',
                    language: 'cpp', symbolId, qname, file: rel,
                    range: rangeFromLsp(hov.range || range),
                    message: typeof hov.contents === 'string' ? hov.contents : (hov.contents.value || ''),
                    confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    result_state: 'found'
                  });
                  operations.hover.count += 1;
                }
              } catch { /* swallow per-symbol */ }
            }
          }

          if (requestedOps.has('diagnostics')) {
            const diags = client.diagnosticsFor(uri);
            for (const d of diags) {
              records.push({
                schema_version: '0.2', collectionId, kind: 'diagnostic',
                language: 'cpp', file: rel,
                severity: severityFromLsp(d.severity),
                message: d.message || '',
                range: rangeFromLsp(d.range),
                provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                freshness: `compile_db_hash:${dbHash}`
              });
              operations.diagnostics.count += 1;
            }
          }

          filesProcessed += 1;
          // Mark AFTER every requested op ran for this file. Recording it earlier
          // would let a budget cut mid-file mark it collected, and the next resume
          // would skip a file that was never finished — a silent coverage hole,
          // which is strictly worse than redoing work.
          if (ledger) ledger.collected.add(rel);
        }

        // P0-1: budget can also be exhausted because the index never went ready
        // within the cap (cold first run) even if every file slot was visited.
        // Treat "indexed mode, asked to wait, but not ready" under an active
        // budget as exhausted so the resume signal fires on the classic cold
        // case (index still warming).
        const filesTotal = files.length;
        if (budgetEnabled && filesProcessed < filesTotal) budgetExhausted = true;
        // Persist the resume point before assembling the envelope, so a caller who
        // kills us after the response still keeps the progress.
        if (ledger) writeLedger(projectRoot, ledger, collectedAt);
        if (budgetEnabled && mode === 'indexed' && !indexReady &&
            (indexWaitReason === 'index_wait_timeout' || indexWaitReason === 'index_wait_error')) {
          budgetExhausted = true;
        }

        const anyPartial = Object.values(operations).some(o => o.status === 'partial');
        const anyOk = Object.values(operations).some(o => o.status === 'ok');
        // Truncation from maxFiles cap promotes the collection to partial
        // status with notCollectedFiles populated on every requested op.
        const truncated = !!(enumStats && enumStats.truncated);
        // P0-1: a budget-exhausted collect is partial regardless of op tallies.
        const status = (anyPartial || truncated || budgetExhausted)
          ? 'partial'
          : (anyOk ? 'ok' : 'partial');
        if (truncated) {
          for (const op of Object.keys(operations)) {
            if (operations[op].status === 'ok') {
              operations[op].status = 'partial';
              operations[op].reason = `enumeration_capped_at_${enumStats.max_files}_of_${enumStats.after_filter}`;
            }
          }
        }
        // P0-1: when the budget cut the run short, mark requested ops partial so
        // operations[op].status='partial' stays consistent with the envelope.
        if (budgetExhausted) {
          for (const op of Object.keys(operations)) {
            if (operations[op].status === 'ok') {
              operations[op].status = 'partial';
              operations[op].reason = filesProcessed < filesTotal
                ? `budget_exhausted_${filesProcessed}_of_${filesTotal}_files`
                : 'budget_exhausted_index_warming';
            }
          }
        }

        // P0-1: human/agent-readable resume note for the partial envelope.
        const notes = [];
        if (budgetExhausted) {
          const progressClause = filesProcessed < filesTotal
            ? `${filesProcessed}/${filesTotal} files done`
            : 'index still warming';
          // The resume promise is now BACKED. It used to say "run again to
          // continue/complete" while the per-file loop restarted at index 0 with
          // nothing persisted — a warm redo, not a resume, which is how a 185-file
          // repo grew a larger import on every retry instead of converging
          // (Sand Castle, 2026-07-30). Only claim continuation when the ledger is
          // actually recording it; otherwise say plainly that a re-run repeats.
          const overall = enumeratedTotal != null
            ? ` Overall ${resumedFrom + filesProcessed}/${enumeratedTotal} first-party files collected.`
            : '';
          notes.push({
            code: 'budget_exhausted',
            message: ledger
              ? `partial: ${progressClause} within ${budgetMs}ms budget — clangd index is now persisting and the collected files are recorded;`
                + ` run graph_collect_code_intel again to CONTINUE from where this stopped (warm runs are ~fast).${overall}`
              : `partial: ${progressClause} within ${budgetMs}ms budget — this run used an explicit files[] scope, so a re-run REPEATS these files rather than continuing.`
                + ' Pass the next chunk of files[] to make progress.'
          });
        }

        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: {
            collectedAt,
            indexedCommit,
            freshnessBasis: 'compile_db_hash',
            freshnessValue: dbHash,
            compileDbHash: dbHash,
            warmedFiles: files.length,
            warmupMs,
            // FIX A — honest per-collection readiness signal. references are
            // only trustworthy-as-exhaustive when indexReady===true.
            mode,
            indexReady,
            indexWaitMs,
            indexWaitReason,
            // FIX B — per-collection reference outcome tallies so downstream
            // can say "index ready, N callers" vs "index NOT ready — may
            // undercount" instead of silently reverting to the generic line.
            refsFoundSymbols,
            refsNotFoundSymbols,
            positionGuesses,
            positionGuessSkipped,
            refsTruncatedSymbols,
            // P0-1 — total-budget + resume signal. budgetExhausted=true means
            // the call returned partial because the budget was hit before the
            // index was ready and/or all files were processed; a warm re-run
            // (clangd index now persisted under .aify-graph/code-intel/.cache)
            // completes/continues fast.
            budgetMs: budgetEnabled ? budgetMs : null,
            budgetElapsedMs: budgetElapsed(),
            budgetExhausted,
            filesProcessed,
            filesTotal,
            // RESUME STATE, reported so "run again to continue" is checkable
            // rather than taken on faith. resumedFrom counts files a prior run
            // already covered under this same compile-DB hash; enumeratedTotal is
            // the full first-party set, so a caller can see real convergence
            // (resumedFrom climbing toward enumeratedTotal) instead of inferring
            // it from a filesProcessed that resets every call.
            resumedFrom,
            enumeratedTotal,
            resumeLedger: ledger ? 'active' : 'not_used',
            // SCOPE OF AUTHORITY. An explicitly-scoped run (`files: [...]`) asked
            // clangd about the symbols in those files and nothing else; an
            // enumerated run (`scope: 'all'`) is repo-wide. The envelope used to
            // look identical either way, so the importer could not tell them
            // apart and invalidated the whole trust spine from a one-file collect
            // (see importer.js). Recorded here because the provider is the only
            // place that knows which branch produced `files`.
            // AUTHORITY IS WHAT THIS CALL ACTUALLY WALKED, not what it enumerated.
            //
            // A resumed run is a SLICE by construction: e341de0 made repeated calls
            // each cover the remaining files, so an enumerated run that reports
            // `ok` may hold records for only the last handful. Claiming repo-wide
            // authority there would make the importer invalidate every clangd edge
            // in the graph and recreate only that final slice — destroying the
            // earlier batches the resume just spent effort collecting. Resume and
            // repo-wide invalidation are safe individually and lethal together.
            //
            // So: repo-wide ONLY when this single call walked the whole enumerated
            // set from a cold ledger. Otherwise the scope is the files it walked.
            scope: (explicitFileScope || resumedFrom > 0 || (enumeratedTotal != null && files.length < enumeratedTotal))
              ? { kind: 'files', files: files.map((f) => String(f).replace(/\\/g, '/')) }
              : { kind: 'repo' },
            ...(enumStats ? { enumeration: enumStats } : {})
          },
          operations,
          status,
          records,
          ...(notes.length ? { notes } : {}),
          ...(compileDb.diagnostics && compileDb.diagnostics.length ? { diagnostics: compileDb.diagnostics } : {})
        };
      } finally {
        try { await client.shutdown(); } catch { /* swallow */ }
      }
    }
  };
}
