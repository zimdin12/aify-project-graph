import { describe, it, expect } from 'vitest';
import { runFixtureProvider } from '../../../../tools/code-intel/fixture/provider.mjs';
import { validateCollection } from '../../../../mcp/stdio/ingest/code-intel/v02.js';

describe('fixture provider', () => {
  it('emits a valid v0.2 collection for a basic request', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'files',
      files: ['src/foo.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(collection.collectionId).toMatch(/^ci-/);
    expect(collection.records.length).toBeGreaterThan(0);
    expect(collection.status).toBe('ok');
  });

  it('emits a partial collection when requested via options.simulatePartial', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'files',
      files: ['src/foo.cpp', 'src/baz.cpp'],
      operations: ['definitions', 'references'],
      simulate: { partial: { references: ['src/baz.cpp'] } }
    });
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(collection.status).toBe('partial');
    expect(collection.operations.references.status).toBe('partial');
    expect(collection.operations.references.notCollectedFiles).toContain('src/baz.cpp');
  });

  it('emits an error collection when requested via options.simulateError', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'all',
      operations: ['definitions'],
      simulate: { error: { code: 'compile_db_missing' } }
    });
    expect(collection.status).toBe('error');
    expect(collection.errors[0].code).toBe('compile_db_missing');
    expect(collection.errors[0].hint).toMatch(/compile_commands/);
  });
});
