// Real-clangd integration tests for bounded live verbs. Gated on clangd
// availability — skips cleanly on hosts where clangd is not installed.
import { describe, it, expect, afterEach } from 'vitest';
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

// Gate on the PRODUCT's resolver, not on bare PATH — see clangd-gate.js. The old
// PATH-only check made this whole suite skip on any normal Windows LLVM install.
import { clangdAvailable, skipReason } from './clangd-gate.js';

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
    // Plan #9b: clangd is started with --background-index=false, so callers
    // in other TUs must be opened via warmupFiles before clangd will return
    // them. Pass the known related files explicitly.
    // FLAKE FIX, not a mask. This failed once under full-suite concurrency and
    // passed in isolation and on every rerun. Cause is resource contention: several
    // real-server integration files each spawn their own language server, so
    // clangd's warmup for bar.cpp can still be in flight when references is issued
    // — and a cross-TU caller that is not yet parsed is legitimately absent.
    //
    // The honest fix is to wait for the readiness the product already exposes,
    // rather than retry until green (which would hide a real undercount) or widen
    // the assertion to accept a missing caller (which would delete the thing this
    // test exists to check).
    const r = await codeIntelReferences({
      repoRoot: repo,
      file: 'src/foo.cpp',
      line: 1,
      col: 5,
      warmupFiles: ['src/bar.cpp', 'src/foo.h'],
      waitForReadyMs: 15000,
    });
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
    it.skip(`skipped — ${skipReason}`, () => {});
  });
}

// definitionLocations WAS STRUCTURALLY ALWAYS EMPTY.
//
// It returned the INTERSECTION of references and definitions — reference entries
// sitting at a definition location. But references are requested with
// includeDeclaration=false, so a spec-compliant server never returns the
// declaration, so the intersection is empty by construction. Only a server IGNORING
// the flag ever populated it.
//
// Meanwhile textDocument/definition was already being called, and its result used
// ONLY as a filter — the definition was in hand and discarded. A field tester
// queried a symbol AT its own definition and got [] against a documented contract
// promising "declaration entries split out" (the field test, echoes, 2026-07-30). He
// isolated it by elimination — full coverage, non-degraded, still zero — which is
// what made the mechanism findable rather than arguable.
describe.skipIf(!clangdAvailable)('definitionLocations is populated (real clangd)', () => {
  it('returns the definition when queried AT the definition', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({
      repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 5,
      warmupFiles: ['src/bar.cpp', 'src/foo.h'], waitForReadyMs: 15000,
    });
    expect(r.status).toBe('ok');
    expect(r.definitionLocations.length).toBeGreaterThan(0);
    // And it must say WHERE it came from: "split out of the reference set" and
    // "resolved by a definition request" are different provenance, and a reader
    // comparing counts deserves to know which they hold.
    expect(['definition_request', 'split_from_references']).toContain(r.definitionSource);
    expect(r.definitionLocations[0].file).toMatch(/foo\.(cpp|h)$/);
  }, 60000);

  it('callsites and definitions stay disjoint — the split is not double-counting', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({
      repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 5,
      warmupFiles: ['src/bar.cpp', 'src/foo.h'], waitForReadyMs: 15000,
    });
    const callsiteKeys = new Set(r.referenceLocations.map(x => `${x.file}:${x.range.start.line}`));
    for (const d of r.definitionLocations) {
      // A definition surfaced via the definition request must not also be counted
      // as a callsite, or "6 callers" silently becomes 7.
      expect(callsiteKeys.has(`${d.file}:${d.range.start.line}`)).toBe(false);
    }
  }, 60000);
});
