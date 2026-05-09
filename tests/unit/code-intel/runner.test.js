import { describe, it, expect, beforeEach } from 'vitest';
import { runCollection } from '../../../mcp/stdio/code-intel/runner.js';
import { registerProvider, clearProviders } from '../../../mcp/stdio/code-intel/providers/index.js';
import { validateCollection } from '../../../mcp/stdio/ingest/code-intel/v02.js';

beforeEach(() => clearProviders());

function fakeProvider(behavior) {
  return () => ({
    capabilities: () => ({
      provider: 'fake',
      version: '0.0.1',
      languages: ['cpp'],
      operations: ['definitions', 'references', 'diagnostics'],
      freshnessBasis: 'unknown',
      warmupRequired: false,
      limits: {}
    }),
    collect: async (req) => behavior(req)
  });
}

describe('runCollection', () => {
  it('emits an error collection when no provider matches the language', async () => {
    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('provider_missing');
    expect(result.errors[0].hint).toMatch(/install/);
    expect(validateCollection(result).valid).toBe(true);
  });

  it('routes to a registered provider and returns its collection', async () => {
    registerProvider('cpp-clangd', fakeProvider(async (req) => ({
      collectionId: 'ci-test-1',
      schema_version: '0.2',
      provider: 'cpp-clangd',
      providerVersion: '0.0.1',
      projectRoot: req.projectRoot,
      session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
      operations: { definitions: { status: 'ok', count: 1 } },
      status: 'ok',
      records: [{
        schema_version: '0.2', collectionId: 'ci-test-1', kind: 'definition',
        language: 'cpp', symbolId: 'c:@F@foo#', qname: 'foo()', file: 'src/foo.cpp',
        range: { start: { line: 1, col: 1 }, end: { line: 1, col: 4 } },
        confidence: 'high', provenance: 'cpp-clangd@0.0.1', result_state: 'found'
      }]
    })));

    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('ok');
    expect(result.records.length).toBe(1);
    expect(validateCollection(result).valid).toBe(true);
  });

  it('wraps provider exceptions into an error collection (internal_error)', async () => {
    registerProvider('cpp-clangd', fakeProvider(async () => { throw new Error('boom'); }));
    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('internal_error');
    expect(result.errors[0].message).toMatch(/boom/);
    expect(validateCollection(result).valid).toBe(true);
  });
});
