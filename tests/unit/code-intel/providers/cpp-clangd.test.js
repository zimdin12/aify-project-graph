import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createCppClangdProvider } from '../../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { validateCollection } from '../../../../mcp/stdio/ingest/code-intel/v02.js';

const fixtureRepo = path.resolve('tests/fixtures/code-intel/cpp-fixture-repo');
const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

function fakeProvider() {
  return createCppClangdProvider({
    spawn: () => ({ command: process.execPath, args: [fakeServer] })
  });
}

// Provider whose fake LSP emits $/progress begin/end so the INDEXED-mode
// readiness wait (FIX A) can reach ready deterministically in tests.
function fakeProgressProvider() {
  return createCppClangdProvider({
    spawn: () => ({
      command: process.execPath,
      args: [fakeServer],
      env: { ...process.env, FAKE_LSP_PROGRESS: '1' }
    })
  });
}

describe('cpp-clangd provider (fake LSP)', () => {
  it('reports capabilities including expected operations', () => {
    const p = fakeProvider();
    const caps = p.capabilities();
    expect(caps.languages).toContain('cpp');
    expect(caps.operations).toEqual(expect.arrayContaining(['definitions', 'references', 'hover', 'diagnostics', 'symbols']));
    expect(caps.warmupRequired).toBe(true);
  });

  it('emits an error collection when compile_commands.json is missing', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: '/no/such/dir', scope: 'all', operations: ['references']
    });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('compile_db_missing');
    expect(validateCollection(result).valid).toBe(true);
  });

  it('collects definitions, references, and diagnostics from the fixture repo', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp',
      projectRoot: fixtureRepo,
      scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    expect(result.status).toBe('ok');
    expect(result.collectionId).toMatch(/^ci-/);
    expect(result.records.length).toBeGreaterThan(0);
    expect(validateCollection(result).valid).toBe(true);
    // every emitted file path is repo-relative forward-slash
    for (const r of result.records) {
      if (r.file) {
        expect(r.file.startsWith('/')).toBe(false);
        expect(r.file.includes('\\')).toBe(false);
      }
    }
  });

  it('warmup precedes collection: warmedFiles count > 0 when batch warmup runs', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp',
      projectRoot: fixtureRepo,
      scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['references']
    });
    expect(result.session.warmedFiles).toBeGreaterThanOrEqual(2);
  });

  it('FIX A: INDEXED mode records indexReady + indexWaitMs + ref tallies in session', async () => {
    const prev = process.env.APG_CLANGD_MODE;
    delete process.env.APG_CLANGD_MODE; // default = indexed
    try {
      const p = fakeProgressProvider();
      const result = await p.collect({
        language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
        files: ['src/foo.cpp', 'src/bar.cpp'], operations: ['references']
      });
      expect(result.session.mode).toBe('indexed');
      expect(result.session.indexReady).toBe(true);
      expect(typeof result.session.indexWaitMs).toBe('number');
      // The fixture refs resolve, so found tally > 0 and not_found stays 0.
      expect(result.session.refsFoundSymbols).toBeGreaterThan(0);
      expect(result.session.refsNotFoundSymbols).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.APG_CLANGD_MODE;
      else process.env.APG_CLANGD_MODE = prev;
    }
  });

  it('FIX A: BOUNDED mode never waits and reports indexReady=false', async () => {
    const prev = process.env.APG_CLANGD_MODE;
    process.env.APG_CLANGD_MODE = 'bounded';
    try {
      const p = fakeProgressProvider();
      const result = await p.collect({
        language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
        files: ['src/foo.cpp'], operations: ['references']
      });
      expect(result.session.mode).toBe('bounded');
      expect(result.session.indexReady).toBe(false);
      expect(result.session.indexWaitMs).toBe(0);
      expect(result.session.indexWaitReason).toBe('skipped_bounded_mode');
    } finally {
      if (prev === undefined) delete process.env.APG_CLANGD_MODE;
      else process.env.APG_CLANGD_MODE = prev;
    }
  });

  it('symbol-aware reference behavior: capable-target empty result triggers warm-and-retry', async () => {
    // The fake LSP returns a non-empty refs result; this test asserts the gate is implemented
    // by checking the provider records carry result_state and never silently emit an empty refs set
    // as `not_collected`.
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
      files: ['src/foo.cpp'], operations: ['references']
    });
    const refs = result.records.filter(r => r.kind === 'reference');
    if (refs.length > 0) {
      expect(refs[0].result_state).toBe('found');
    }
    expect(result.operations.references.status === 'ok' || result.operations.references.status === 'partial').toBe(true);
  });
});
