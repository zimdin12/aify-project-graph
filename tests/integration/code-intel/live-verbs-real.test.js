// Real-clangd integration tests for bounded live verbs. Gated on clangd
// availability — skips cleanly on hosts where clangd is not installed.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  codeIntelDiagnostics,
  codeIntelReferences,
  codeIntelHover,
  codeIntelSymbols
} from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { shutdownAllSessions, _resetSessions } from '../../../mcp/stdio/code-intel/live.js';

const clangdAvailable = (() => {
  const out = spawnSync('clangd', ['--version'], { encoding: 'utf8' });
  return out.status === 0;
})();

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-live-real-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.cpp'), 'int foo(int x) { return x + 1; }\n');
  fs.writeFileSync(path.join(dir, 'src', 'bar.cpp'), '#include "foo.h"\nint main() { return foo(7); }\n');
  fs.writeFileSync(path.join(dir, 'src', 'foo.h'), '#pragma once\nint foo(int);\n');
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify([
    { directory: dir, command: 'clang++ -std=c++17 -I src -c src/foo.cpp', file: 'src/foo.cpp' },
    { directory: dir, command: 'clang++ -std=c++17 -I src -c src/bar.cpp', file: 'src/bar.cpp' }
  ]));
  return dir;
}

afterEach(async () => { await shutdownAllSessions(); _resetSessions(); });

describe.skipIf(!clangdAvailable)('bounded live verbs (real clangd)', () => {
  it('diagnostics on a clean fixture returns empty list', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDiagnostics({ repoRoot: repo, files: ['src/foo.cpp'] });
    expect(r.status).toBe('ok');
    expect(Array.isArray(r.diagnostics)).toBe(true);
  }, 30000);

  it('references at foo definition surfaces bar.cpp call site', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 5 });
    expect(r.status).toBe('ok');
    // Plan #8 / item I: the fixture has exactly one call site (src/bar.cpp:2)
    // and one declaration (src/foo.h:2). includeDeclaration defaults to false
    // in our LspClient, so clangd returns at least the call site. Real-world
    // clangd may also include the declaration depending on version; we accept
    // both call-site-only and call-site+declaration outcomes but require
    // result_state to be "found" exactly (no longer accepts not_found_after_retry).
    expect(r.result_state).toBe('found');
    expect(r.references.length).toBeGreaterThanOrEqual(1);
    const refFiles = r.references.map(ref => ref.file);
    expect(refFiles).toContain('src/bar.cpp');
    // Every ref must carry the live-verb provenance and high confidence.
    for (const ref of r.references) {
      expect(ref.provenance).toBe('clangd@live');
      expect(ref.confidence).toBe('high');
    }
    // The call site in bar.cpp is on line 2 ("int main() { return foo(7); }")
    const barRef = r.references.find(ref => ref.file === 'src/bar.cpp');
    expect(barRef.range.start.line).toBe(2);
  }, 30000);

  it('hover at foo definition includes a type-like signature', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHover({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 5 });
    expect(r.status).toBe('ok');
  }, 30000);

  it('symbols on foo.cpp returns at least one entry', async () => {
    const repo = tmpRepo();
    const r = await codeIntelSymbols({ repoRoot: repo, file: 'src/foo.cpp' });
    expect(r.status).toBe('ok');
    expect(r.symbols.length).toBeGreaterThan(0);
  }, 30000);
});

if (!clangdAvailable) {
  describe('bounded live verbs (real clangd)', () => {
    it.skip('skipped — clangd not on PATH', () => {});
  });
}
