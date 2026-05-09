import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { validateCollection } from '../../../mcp/stdio/ingest/code-intel/v02.js';

const clangdAvailable = (() => {
  const out = spawnSync('clangd', ['--version'], { encoding: 'utf8' });
  return out.status === 0;
})();

const fixtureRepo = path.resolve('tests/fixtures/code-intel/cpp-fixture-repo');

describe.skipIf(!clangdAvailable)('cpp-clangd provider (real clangd)', () => {
  it('collects against the fixture repo', async () => {
    const p = createCppClangdProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    expect(['ok', 'partial']).toContain(result.status);
    expect(validateCollection(result).valid).toBe(true);
  }, 30000);
});

if (!clangdAvailable) {
  describe('cpp-clangd provider (real clangd)', () => {
    it.skip('skipped — clangd not on PATH', () => {});
  });
}
