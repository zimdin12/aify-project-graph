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
  codeIntelSymbols,
  buildReferencesEvidence,
  buildDefinitionsEvidence,
  splitDefinitionFromReferences
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

// Plan #14 Step A: references/definitions evidence contract.
// Mirrors agent-code-intel 0.1.21's load-bearing primitive — only
// evidence.exhaustive===true is a safe signal for absence claims.
//
// Integration test (against fake LSP) covers the happy path: response
// shape, compat array, exhaustive:true when fresh+callsites. The cause
// enum is unit-tested directly against buildReferencesEvidence /
// buildDefinitionsEvidence below — the fake LSP returns synthetic
// results for any position, so it can't simulate empty/cold paths
// without a more invasive fixture rebuild.
describe('Plan #14 evidence contract — integration', () => {
  it('references with fresh freshness + callsites → evidence.exhaustive=true + compat array preserved', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.evidence).toBeDefined();
    expect(r.evidence.exhaustive).toBe(true);
    expect(r.evidence.ready).toBe(true);
    expect(r.evidence.degraded).toBe(false);
    expect(r.evidence.confidence).toBe('high');
    expect(r.evidence.cause).toBeNull();
    expect(Array.isArray(r.referenceLocations)).toBe(true);
    expect(Array.isArray(r.definitionLocations)).toBe(true);
    expect(Array.isArray(r.references)).toBe(true); // compat array still present
  });

  it('definitions with fresh + def found → evidence.exhaustive=true', async () => {
    const repo = tmpRepo();
    const r = await codeIntelDefinitions({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.evidence).toBeDefined();
    expect(r.evidence.exhaustive).toBe(true);
    expect(r.evidence.ready).toBe(true);
    expect(r.evidence.cause).toBeNull();
  });
});

describe('Plan #14 evidence contract — buildReferencesEvidence unit cases', () => {
  it('fresh + callsites → exhaustive:true, ready:true, no cause', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1 });
    expect(e.exhaustive).toBe(true);
    expect(e.ready).toBe(true);
    expect(e.degraded).toBe(false);
    expect(e.confidence).toBe('high');
    expect(e.cause).toBeNull();
  });

  it('fresh + only def in refs → cause:definition_only, degraded, warned', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 0, defCount: 1 });
    expect(e.cause).toBe('definition_only');
    expect(e.degraded).toBe(true);
    expect(e.exhaustive).toBe(false);
    expect(e.warnings.length).toBeGreaterThan(0);
    expect(e.fallback).toMatch(/warmupFiles|grep/);
  });

  it('stale → cause:stale_index, fallback guidance', () => {
    const e = buildReferencesEvidence({ freshness: 'stale', callsiteCount: 5, defCount: 1 });
    expect(e.cause).toBe('stale_index');
    expect(e.exhaustive).toBe(false);
    expect(e.fallback).toMatch(/wait_for_ready/);
  });

  it('timeout → cause:timeout, exhaustive:false', () => {
    const e = buildReferencesEvidence({ freshness: 'timeout', callsiteCount: 0, defCount: 0 });
    expect(e.cause).toBe('timeout');
    expect(e.exhaustive).toBe(false);
  });

  it('cold → cause:cold_index, warmup fallback', () => {
    const e = buildReferencesEvidence({ freshness: 'cold', callsiteCount: 0, defCount: 0 });
    expect(e.cause).toBe('cold_index');
    expect(e.fallback).toMatch(/warmupFiles|wait_for_ready/);
  });

  it('unknown + empty → treated as cold_index (no readiness signal + no data)', () => {
    const e = buildReferencesEvidence({ freshness: 'unknown', callsiteCount: 0, defCount: 0 });
    expect(e.cause).toBe('cold_index');
    expect(e.degraded).toBe(true);
  });

  it('unknown + callsites → cause:unknown (data present, readiness missing)', () => {
    const e = buildReferencesEvidence({ freshness: 'unknown', callsiteCount: 2, defCount: 1 });
    expect(e.cause).toBe('unknown');
    expect(e.exhaustive).toBe(false);
    expect(e.confidence).toBe('medium');
  });
});

describe('Plan #14 evidence contract — buildDefinitionsEvidence unit cases', () => {
  it('fresh + defs → exhaustive:true', () => {
    const e = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1 });
    expect(e.exhaustive).toBe(true);
    expect(e.ready).toBe(true);
  });

  it('cold + empty → cold_index', () => {
    const e = buildDefinitionsEvidence({ freshness: 'cold', defCount: 0 });
    expect(e.cause).toBe('cold_index');
    expect(e.degraded).toBe(true);
  });

  it('stale → stale_index', () => {
    const e = buildDefinitionsEvidence({ freshness: 'stale', defCount: 1 });
    expect(e.cause).toBe('stale_index');
  });

  it('timeout → timeout', () => {
    const e = buildDefinitionsEvidence({ freshness: 'timeout', defCount: 0 });
    expect(e.cause).toBe('timeout');
  });
});

describe('Plan #14 evidence contract — splitDefinitionFromReferences', () => {
  it('separates definition entries from callsites by file+range key', () => {
    const refs = [
      { file: 'a.cpp', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 5 } } },
      { file: 'b.cpp', range: { start: { line: 10, col: 1 }, end: { line: 10, col: 5 } } },
      { file: 'c.cpp', range: { start: { line: 20, col: 1 }, end: { line: 20, col: 5 } } }
    ];
    const defs = [
      { file: 'a.cpp', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 5 } } }
    ];
    const { callsiteLocations, definitionLocations } = splitDefinitionFromReferences(refs, defs);
    expect(definitionLocations.length).toBe(1);
    expect(definitionLocations[0].file).toBe('a.cpp');
    expect(callsiteLocations.length).toBe(2);
    expect(callsiteLocations.map(c => c.file)).toEqual(['b.cpp', 'c.cpp']);
  });

  it('returns all as callsites when no defs match', () => {
    const refs = [{ file: 'x.cpp', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 5 } } }];
    const { callsiteLocations, definitionLocations } = splitDefinitionFromReferences(refs, []);
    expect(callsiteLocations.length).toBe(1);
    expect(definitionLocations.length).toBe(0);
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
