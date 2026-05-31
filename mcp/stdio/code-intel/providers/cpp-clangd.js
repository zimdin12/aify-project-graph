import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LspClient } from '../lsp-client.js';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';
import { prepareCompileDb, enumerateFirstParty } from '../compile-db.js';
import { buildClangdSpawn } from '../resolve-clangd.js';

// Cold-collect request timeout: a fresh background-index pass over a game repo
// can take well over the default 10s before the first query resolves.
const COLD_COLLECT_TIMEOUT_MS = 60000;

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

function uriToRepoRelative(uri, projectRoot) {
  const abs = fileURLToPath(uri);
  return toRepoRelative(projectRoot, abs);
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
      const maxFiles = Number.isFinite(req.maxFiles) ? req.maxFiles : 200;
      if (req.files && req.files.length > 0) {
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

        const PROGRESS_EVERY = 25;
        for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
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
            if (sym.location && sym.location.range) {
              // SymbolInformation. Body range covers the whole declaration;
              // the identifier column is not directly known. Find the leaf
              // name (after final '::') on the declaration line and use its
              // column. If not findable, fall back to column 0 — better
              // than (0,0) since the line is still correct.
              bodyRange = sym.location.range;
              const leafName = String(sym.name || '').split('::').pop();
              const lines = loadSourceLines();
              const declLine = lines[bodyRange.start.line] || '';
              let col = 0;
              if (leafName) {
                const idx = declLine.indexOf(leafName);
                if (idx >= 0) col = idx;
              }
              pos = { line: bodyRange.start.line, character: col };
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
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'reference',
                    language: 'cpp', symbolId, qname,
                    confidence: 'low', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    result_state: 'not_found_after_retry'
                  });
                } else {
                  for (const ref of refs) {
                    records.push({
                      schema_version: '0.2', collectionId, kind: 'reference',
                      language: 'cpp', symbolId, qname,
                      file: uriToRepoRelative(ref.uri, projectRoot),
                      range: rangeFromLsp(ref.range),
                      context: 'call_expr',
                      confidence: deriveConfidence('reference', 'call_expr'),
                      provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                      freshness: `compile_db_hash:${dbHash}`,
                      result_state: 'found'
                    });
                  }
                }
                operations.references.count += refs.length;
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
        }

        const anyPartial = Object.values(operations).some(o => o.status === 'partial');
        const anyOk = Object.values(operations).some(o => o.status === 'ok');
        // Truncation from maxFiles cap promotes the collection to partial
        // status with notCollectedFiles populated on every requested op.
        const truncated = !!(enumStats && enumStats.truncated);
        const status = (anyPartial || truncated) ? 'partial' : (anyOk ? 'ok' : 'partial');
        if (truncated) {
          for (const op of Object.keys(operations)) {
            if (operations[op].status === 'ok') {
              operations[op].status = 'partial';
              operations[op].reason = `enumeration_capped_at_${enumStats.max_files}_of_${enumStats.after_filter}`;
            }
          }
        }

        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: {
            collectedAt,
            freshnessBasis: 'compile_db_hash',
            freshnessValue: dbHash,
            compileDbHash: dbHash,
            warmedFiles: files.length,
            warmupMs,
            ...(enumStats ? { enumeration: enumStats } : {})
          },
          operations,
          status,
          records,
          ...(compileDb.diagnostics && compileDb.diagnostics.length ? { diagnostics: compileDb.diagnostics } : {})
        };
      } finally {
        try { await client.shutdown(); } catch { /* swallow */ }
      }
    }
  };
}
