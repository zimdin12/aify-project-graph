import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { graphCollectCodeIntel } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';
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

  it('returns a v0.2 collection envelope and imports it locally', async () => {
    const dir = setupRepo();
    const result = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all', operations: ['definitions', 'references'] });
    expect(result.status).toBe('ok');
    expect(result.collectionId).toBe('ci-test-cci-1');
    expect(result.records.length).toBe(2);

    // Confirm it landed in the local graph by asking graph_health
    const health = await graphHealth({ repoRoot: dir });
    expect(health.codeIntel.available).toBe(true);
    expect(health.codeIntel.provider).toBe('cpp-clangd');
    expect(health.codeIntel.status).toBe('ok');
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

  it('rejects missing language', async () => {
    const result = await graphCollectCodeIntel({ repoRoot: '/r' });
    expect(result.status).toBe('error');
  });
});
