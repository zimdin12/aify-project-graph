// Plan #6 unit tests: 5 bounded live verbs against the fake LSP fixture.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  codeIntelDiagnostics,
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
  codeIntelSymbols
} from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { _resetSessions, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const fakeSpawn = { command: process.execPath, args: [fakeServer] };
const fakeProgressSpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_PROGRESS: '1' } };

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-live-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.cpp'), 'void foo(int){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'bar.cpp'), 'void bar(){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'bad.cpp'), 'int x = ;\n');
  return dir;
}

beforeEach(() => _resetSessions());
afterEach(async () => { await shutdownAllSessions(); _resetSessions(); });

describe('code_intel_diagnostics (live)', () => {
  it('returns diagnostics for files with errors (fake LSP emits on bad.cpp)', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDiagnostics({ repoRoot: repo, files: ['src/bad.cpp'], spawn: fakeSpawn });
    expect(r.status).toBe('ok');
    expect(r.files[0]).toMatchObject({ file: 'src/bad.cpp', freshness: 'fresh' });
    expect(r.noValueAdded).toBeUndefined();
    expect(r.telemetry).toMatchObject({ operation: 'diagnostics', files: 1, diagnostics: 1 });
    expect(r.telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0].message).toMatch(/undeclared/);
  });

  it('returns empty diagnostics for clean files', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDiagnostics({ repoRoot: repo, files: ['src/foo.cpp'], spawn: fakeSpawn });
    expect(r.status).toBe('ok');
    expect(r.files[0]).toMatchObject({ file: 'src/foo.cpp', freshness: expect.stringMatching(/^(fresh|stale|timeout)$/) });
    expect(r.noValueAdded).toBe(true);
    expect(r.telemetry.freshness.timeout).toBe(1);
    expect(r.diagnostics.length).toBe(0);
  });

  it('returns error envelope when language is unsupported', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDiagnostics({ repoRoot: repo, language: 'rust', files: ['src/foo.cpp'] });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('language_unsupported');
  });
});

describe('code_intel_references (live)', () => {
  it('returns symbol-aware refs via fake LSP', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.freshness).toBe('fresh');
    expect(r.telemetry).toMatchObject({ operation: 'references', references: 1, warmedFiles: 1 });
    expect(r.result_state).toBe('found');
    expect(r.references[0].file).toMatch(/bar\.cpp/);
    expect(r.references[0].provenance).toBe('clangd@live');
  });
});

describe('code_intel_definitions (live)', () => {
  it('returns defs at position', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDefinitions({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.freshness).toBe('fresh');
    expect(r.definitions.length).toBeGreaterThan(0);
  });
});

describe('code_intel_hover (live)', () => {
  it('returns hover content + range', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHover({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.freshness).toBe('fresh');
    expect(r.hover.content).toMatch(/void foo/);
  });
});

describe('code_intel_symbols (live)', () => {
  it('returns document symbol outline', async () => {
    const repo = tmpRepo();
    const r = await codeIntelSymbols({ repoRoot: repo, file: 'src/foo.cpp', spawn: fakeSpawn });
    expect(r.status).toBe('ok');
    expect(r.symbols.length).toBeGreaterThan(0);
    expect(r.symbols[0].name).toBe('foo');
  });
});
