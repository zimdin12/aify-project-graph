import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { validateCollection } from '../../../mcp/stdio/ingest/code-intel/v02.js';
// Gate on the PRODUCT's resolver, not on bare PATH — see clangd-gate.js.
import { clangdAvailable, skipReason } from './clangd-gate.js';

// The checked-in fixture's compile_commands.json hardcodes `"directory":
// "/repo/root"`, which exists nowhere — it was built to validate ENVELOPE SHAPE,
// not to drive a real collection. Materialize an equivalent repo with a correct
// absolute directory so clangd can actually parse the TUs.
function realFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cpp-fixture-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(
    path.resolve('tests/fixtures/code-intel/cpp-fixture-repo/src/foo.cpp'),
    path.join(dir, 'src', 'foo.cpp'),
  );
  fs.copyFileSync(
    path.resolve('tests/fixtures/code-intel/cpp-fixture-repo/src/bar.cpp'),
    path.join(dir, 'src', 'bar.cpp'),
  );
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify([
    { directory: dir, command: 'clang++ -std=c++17 -c src/foo.cpp -o foo.o', file: 'src/foo.cpp' },
    { directory: dir, command: 'clang++ -std=c++17 -c src/bar.cpp -o bar.o', file: 'src/bar.cpp' },
  ]));
  return dir;
}

describe.skipIf(!clangdAvailable)('cpp-clangd provider (real clangd)', () => {
  it('collects against the fixture repo', async () => {
    const p = createCppClangdProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: realFixtureRepo(), scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    expect(['ok', 'partial']).toContain(result.status);
    expect(validateCollection(result).valid).toBe(true);
    // The envelope must declare its scope, or the importer cannot tell a scoped
    // run from a repo-wide one and invalidates edges it never observed (1d8e2a8).
    expect(result.session.scope).toEqual({
      kind: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
    });
  }, 60000);
});

if (!clangdAvailable) {
  describe('cpp-clangd provider (real clangd)', () => {
    it.skip(`skipped — ${skipReason}`, () => {});
  });
}
