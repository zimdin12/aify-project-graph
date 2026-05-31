import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { graphCollectCodeIntel, inferLanguageFromFiles } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { registerProvider, clearProviders, getProvider } from '../../../mcp/stdio/code-intel/providers/index.js';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cci-'));
  mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  return dir;
}

function fixtureProvider() {
  return () => ({
    capabilities: () => ({ provider: 'cpp-clangd', version: '0.0.1', languages: ['cpp'], operations: ['definitions', 'references'], freshnessBasis: 'compile_db_hash', warmupRequired: false, limits: {} }),
    collect: async (req) => ({
      schema_version: '0.2',
      collectionId: 'ci-test-cci-1',
      provider: 'cpp-clangd',
      providerVersion: '0.0.1',
      projectRoot: req.projectRoot,
      session: { collectedAt: new Date().toISOString(), freshnessBasis: 'compile_db_hash', compileDbHash: 'cci1' },
      operations: { definitions: { status: 'ok', count: 1 }, references: { status: 'ok', count: 1 } },
      status: 'ok',
      records: [
        { schema_version: '0.2', collectionId: 'ci-test-cci-1', kind: 'definition', language: 'cpp', symbolId: 'c:@F@x', qname: 'x()', file: 'src/x.cpp', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } }, confidence: 'high', provenance: 'cpp-clangd@0.0.1', result_state: 'found' },
        { schema_version: '0.2', collectionId: 'ci-test-cci-1', kind: 'reference', language: 'cpp', symbolId: 'c:@F@x', qname: 'x()', file: 'src/y.cpp', range: { start: { line: 5, col: 1 }, end: { line: 5, col: 2 } }, context: 'call_expr', confidence: 'high', provenance: 'cpp-clangd@0.0.1', result_state: 'found' }
      ]
    })
  });
}

describe('graph_collect_code_intel', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider('cpp-clangd', fixtureProvider());
  });

  it('returns a COMPACT SUMMARY (no raw records[]) and imports the full envelope locally', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all', operations: ['definitions', 'references'] });
    expect(result.status).toBe('ok');
    expect(result.collectionId).toBe('ci-test-cci-1');
    // HIGH-2 — the summary must NOT carry the raw records array (the multi-MB flood).
    expect(result.summary).toBe(true);
    expect(result.records).toBeUndefined();
    // …but the IMPORT still happened: counts are present in the summary.
    expect(result.imported).toBeTruthy();
    expect(result.imported.recordsImported).toBe(2);
    expect(result.operations.definitions.count).toBe(1);
    expect(result.operations.references.count).toBe(1);
    expect(result.recordCount).toBe(2);

    // Confirm it landed in the local graph by asking graph_health
    const health = await graphHealth({ repoRoot: dir });
    expect(health.codeIntel.available).toBe(true);
    expect(health.codeIntel.provider).toBe('cpp-clangd');
    expect(health.codeIntel.status).toBe('ok');
  });

  // HIGH-2 — explicit size/shape guard: the serialized MCP response (what the
  // server JSON.stringify's) must stay small even when the envelope's records[]
  // is large. A fat-records provider must still yield a compact summary.
  it('HIGH-2: response stays compact when the envelope has a large records[]', async () => {
    clearProviders();
    const bigRecords = [];
    for (let i = 0; i < 5000; i += 1) {
      bigRecords.push({ schema_version: '0.2', collectionId: 'ci-big-1', kind: 'reference', language: 'cpp', symbolId: `c:@F@s${i}`, qname: `s${i}()`, file: `src/unity_${i}.cpp`, range: { start: { line: i + 1, col: 1 }, end: { line: i + 1, col: 2 } }, context: 'call_expr', confidence: 'high', provenance: 'cpp-clangd@0.0.1', result_state: 'found' });
    }
    registerProvider('cpp-clangd', () => ({
      capabilities: () => ({ provider: 'cpp-clangd', version: '0.0.1', languages: ['cpp'], operations: ['references'], freshnessBasis: 'compile_db_hash', warmupRequired: false, limits: {} }),
      collect: async (req) => ({
        schema_version: '0.2', collectionId: 'ci-big-1', provider: 'cpp-clangd', providerVersion: '0.0.1',
        projectRoot: req.projectRoot,
        session: { collectedAt: new Date().toISOString(), freshnessBasis: 'compile_db_hash', compileDbHash: 'big1', indexReady: true, filesProcessed: 5000, filesTotal: 5000 },
        operations: { references: { status: 'ok', count: bigRecords.length } },
        status: 'ok',
        records: bigRecords,
      })
    }));
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all', operations: ['references'] });
    expect(result.summary).toBe(true);
    expect(result.records).toBeUndefined();
    expect(result.recordCount).toBe(5000);
    // The serialized response must be small (a few hundred tokens), NOT the
    // ~5000-record flood. Assert a generous-but-firm byte ceiling.
    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeLessThan(8000);
    // It must NOT contain the bulk record file names (proof records[] isn't inlined).
    expect(serialized).not.toContain('unity_4999.cpp');
    // The import still ran: counts present.
    expect(result.imported.recordsImported).toBe(5000);
    expect(result.operations.references.count).toBe(5000);
  });

  it('P0-1: partial budget-exhausted envelope is imported and surfaces a resume error', async () => {
    clearProviders();
    registerProvider('cpp-clangd', () => ({
      capabilities: () => ({ provider: 'cpp-clangd', version: '0.0.1', languages: ['cpp'], operations: ['references'], freshnessBasis: 'compile_db_hash', warmupRequired: false, limits: {} }),
      collect: async (req) => ({
        schema_version: '0.2',
        collectionId: 'ci-test-budget-1',
        provider: 'cpp-clangd',
        providerVersion: '0.0.1',
        projectRoot: req.projectRoot,
        session: {
          collectedAt: new Date().toISOString(), freshnessBasis: 'compile_db_hash', compileDbHash: 'b1',
          budgetMs: 5000, budgetExhausted: true, indexReady: false, filesProcessed: 0, filesTotal: 3
        },
        operations: { references: { status: 'partial', reason: 'budget_exhausted_index_warming', count: 0 } },
        status: 'partial',
        notes: [{ code: 'budget_exhausted', message: 'partial: index still warming within 5000ms budget — clangd index is now persisting; run graph_collect_code_intel again to continue/complete (warm runs are ~fast).' }],
        records: []
      })
    }));
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all', operations: ['references'], budgetMs: 5000 });
    expect(result.status).toBe('partial');
    // HIGH-2 — budget signal now surfaced in the compact summary's index block.
    expect(result.summary).toBe(true);
    expect(result.index.budgetExhausted).toBe(true);
    expect(result.index.filesProcessed).toBe(0);
    expect(result.index.filesTotal).toBe(3);
    // resume note mirrored into errors[] for hosts that only render errors
    const err = (result.errors || []).find(e => e.code === 'budget_exhausted');
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/run graph_collect_code_intel again/);
  });

  it('returns error envelope for unsupported languages', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'rust' });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('language_unsupported');
  });

  it('rejects missing repoRoot', async () => {
    const result = await graphCollectCodeIntel({ language: 'cpp' });
    expect(result.status).toBe('error');
  });

  // FIX 2 (test-round-2026-05-31): language is no longer required — it defaults
  // to 'cpp' (the games are C++) or is inferred from files[] extensions. This
  // replaces the old "rejects missing language" expectation.
  it('defaults language to cpp when omitted', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, scope: 'all', operations: ['definitions', 'references'] });
    expect(result.status).toBe('ok');
    expect(result.provider).toBe('cpp-clangd');
  });

  it('infers cpp from a .cpp/.h files[] list when language omitted', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, scope: 'files', files: ['src/a.cpp', 'src/a.h'], operations: ['definitions'] });
    expect(result.status).toBe('ok');
    expect(result.provider).toBe('cpp-clangd');
  });

  it('explicit language still wins', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('ok');
  });
});

describe('inferLanguageFromFiles (FIX 2)', () => {
  it('returns cpp for C/C++ extensions', () => {
    expect(inferLanguageFromFiles(['a.cpp'])).toBe('cpp');
    expect(inferLanguageFromFiles(['a.h', 'b.hpp', 'c.cc'])).toBe('cpp');
  });
  it('returns typescript for .ts/.js extensions', () => {
    expect(inferLanguageFromFiles(['a.ts', 'b.tsx'])).toBe('typescript');
    expect(inferLanguageFromFiles(['a.js', 'b.mjs'])).toBe('typescript');
  });
  it('majority vote when mixed', () => {
    expect(inferLanguageFromFiles(['a.cpp', 'b.cpp', 'c.ts'])).toBe('cpp');
  });
  it('returns null for empty / unrecognized', () => {
    expect(inferLanguageFromFiles([])).toBeNull();
    expect(inferLanguageFromFiles(null)).toBeNull();
    expect(inferLanguageFromFiles(['README', 'a.txt'])).toBeNull();
  });
});
