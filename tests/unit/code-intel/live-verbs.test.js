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
  splitDefinitionFromReferences,
  openIfNeeded
} from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { _resetSessions, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';
import { LspClient } from '../../../mcp/stdio/code-intel/lsp-client.js';
import { vi } from 'vitest';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const fakeSpawn = { command: process.execPath, args: [fakeServer] };
const fakeProgressSpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_PROGRESS: '1' } };

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-live-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.cpp'), 'void foo(int){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'bar.cpp'), 'void bar(){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'bad.cpp'), 'int x = ;\n');
  // A NATIVE (non-foreign, non-unity) compile DB covering every source, so the
  // false-exhaustive coverage guard treats this index as trustworthy and the
  // exhaustive-contract assertions exercise the happy path (not the degrade).
  const cc = ['foo.cpp', 'bar.cpp', 'bad.cpp'].map((f) => ({
    directory: dir,
    command: `clang++ -std=c++17 -c ${path.join(dir, 'src', f)}`,
    file: path.join(dir, 'src', f),
  }));
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify(cc));
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
    // Plan #14 Step B: auto-prewarm fires on cold cpp sessions when caller
    // didn't pass warmupFiles[]. tmpRepo has 3 .cpp siblings in src/, so
    // warmedFiles = queried + 2 prewarmed = 3.
    expect(r.telemetry).toMatchObject({ operation: 'references', references: 1, warmedFiles: 3 });
    expect(r.telemetry.prewarmFiles.length).toBeGreaterThanOrEqual(2);
    expect(r.telemetry.prewarmCap).toBe(15);
    expect(r.telemetry.prewarmSource).toMatch(/^(compile_db|fs_siblings|mixed)$/);
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
  it('fresh + callsites + PROVEN coverage → exhaustive:true, ready:true, no cause', () => {
    // P0-2 (2026-07-26): proven coverage is now required. Previously this passed
    // with no coverage argument at all.
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1, coverage: { complete: true } });
    expect(e.exhaustive).toBe(true);
    expect(e.ready).toBe(true);
    expect(e.degraded).toBe(false);
    expect(e.confidence).toBe('high');
    expect(e.cause).toBeNull();
  });

  it('fresh + callsites but INCOMPLETE compile-DB coverage → NOT exhaustive (false-exhaustive guard)', () => {
    // The 2026-06-02 bug: a fresh index + 3 callsites was claimed exhaustive while
    // clangd silently missed callers in TUs its (foreign/unity) index didn't cover.
    const coverage = { complete: false, reason: 'compile DB is foreign (Linux/WSL) to the host clangd — index partial' };
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1, coverage });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('partial_compile_db_coverage');
    expect(e.degraded).toBe(true);
    expect(e.confidence).toBe('medium');
    expect(e.warnings.length).toBeGreaterThan(0);
    expect(e.fallback).toMatch(/foreign|verify|rg|compile DB/i);
  });

  it('fresh + callsites + COMPLETE coverage → exhaustive:true (coverage gate passes)', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1, coverage: { complete: true } });
    expect(e.exhaustive).toBe(true);
    expect(e.cause).toBeNull();
  });

  // REVERSED 2026-07-26 (P0-2). This test previously asserted that omitting
  // coverage was "treated as trustworthy, back-compat" — it codified the
  // false-exhaustive defect as intended behavior. Sand Castle proved the cost:
  // 3 of 8 real call sites returned as exhaustive:true. Silence is not proof.
  it('coverage omitted → NOT exhaustive (fail-closed)', () => {
    const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 3, defCount: 1 });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
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
  it('fresh + defs + PROVEN coverage → exhaustive:true', () => {
    const e = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1, coverage: { complete: true } });
    expect(e.exhaustive).toBe(true);
    expect(e.ready).toBe(true);
  });

  it('fresh + defs but coverage unproven → NOT exhaustive (P0-2 fail-closed)', () => {
    const e = buildDefinitionsEvidence({ freshness: 'fresh', defCount: 1 });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('coverage_unknown');
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

// Plan #14 Step B: cold freshness state + bounded cpp prewarm.
describe('Plan #14 Step B — cold freshness + cpp prewarm', () => {
  it('selectCppPrewarmFiles returns same-dir siblings, capped, excluding queried file', async () => {
    // Direct unit test of the picker — independent of LSP fixtures.
    const { selectCppPrewarmFiles, DEFAULT_PREWARM_CAP } = await import('../../../mcp/stdio/code-intel/prewarm/cpp.js');
    const repo = tmpRepo();
    const result = selectCppPrewarmFiles({ projectRoot: repo, queriedFile: 'src/foo.cpp' });
    expect(result.files).not.toContain('src/foo.cpp'); // queried file excluded
    expect(result.files.length).toBeGreaterThanOrEqual(2); // bar.cpp + bad.cpp at least
    expect(result.files.every(f => f.startsWith('src/'))).toBe(true);
    expect(result.stats.cap).toBe(DEFAULT_PREWARM_CAP);
    expect(result.stats.source).toMatch(/fs_siblings|compile_db|mixed/);
  });

  it('APG_DISABLE_PREWARM=1 returns empty + source:none', async () => {
    const { selectCppPrewarmFiles } = await import('../../../mcp/stdio/code-intel/prewarm/cpp.js');
    const repo = tmpRepo();
    const result = selectCppPrewarmFiles({ projectRoot: repo, queriedFile: 'src/foo.cpp', env: { APG_DISABLE_PREWARM: '1' } });
    expect(result.files).toEqual([]);
    expect(result.stats.source).toBe('none');
  });

  it('cap clipping reports skipped:true', async () => {
    const { selectCppPrewarmFiles } = await import('../../../mcp/stdio/code-intel/prewarm/cpp.js');
    const repo = tmpRepo();
    // Create a bunch of siblings to exceed a tiny cap
    fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), '');
    fs.writeFileSync(path.join(repo, 'src', 'b.cpp'), '');
    fs.writeFileSync(path.join(repo, 'src', 'c.cpp'), '');
    const result = selectCppPrewarmFiles({ projectRoot: repo, queriedFile: 'src/foo.cpp', cap: 2 });
    expect(result.files.length).toBe(2);
    expect(result.stats.skipped).toBe(true);
  });

  it('compile_commands.json same-dir siblings are picked', async () => {
    const { selectCppPrewarmFiles } = await import('../../../mcp/stdio/code-intel/prewarm/cpp.js');
    const repo = tmpRepo();
    fs.writeFileSync(path.join(repo, 'compile_commands.json'), JSON.stringify([
      { directory: repo, file: 'src/foo.cpp', command: 'clang++ -c src/foo.cpp' },
      { directory: repo, file: 'src/bar.cpp', command: 'clang++ -c src/bar.cpp' }
    ]));
    const result = selectCppPrewarmFiles({ projectRoot: repo, queriedFile: 'src/foo.cpp' });
    expect(result.files).toContain('src/bar.cpp');
    expect(result.stats.source).toMatch(/compile_db|mixed/);
  });

  it('navigationFreshness returns cold when no workspace files opened', async () => {
    const { LspClient } = await import('../../../mcp/stdio/code-intel/lsp-client.js');
    const c = new LspClient({ command: process.execPath, args: ['-e', ''] });
    // Direct state assertion — no didOpen called → workspaceWarmCount=0
    expect(c.workspaceWarmCount).toBe(0);
    expect(c.navigationFreshness()).toBe('cold');
  });

  it('navigationFreshness returns fresh only after didOpen + ready signal', async () => {
    const { LspClient } = await import('../../../mcp/stdio/code-intel/lsp-client.js');
    const c = new LspClient({ command: process.execPath, args: ['-e', ''] });
    c.workspaceWarmCount = 1;
    c.indexingState = 'ready';
    expect(c.navigationFreshness()).toBe('fresh');
    c.workspaceWarmCount = 0;
    expect(c.navigationFreshness()).toBe('cold');
  });

  it('caller warmupFiles[] disables auto-prewarm (caller_provided source)', async () => {
    const repo = tmpRepo();
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, warmupFiles: ['src/bar.cpp'], waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.telemetry.prewarmSource).toBe('caller_provided');
    expect(r.telemetry.prewarmFiles).toEqual([]);
  });
});

// Plan #14 Step D: sticky degraded references state per session.
describe('Plan #14 Step D — sticky degraded references state', () => {
  it('clean references results carry a warning while session is in degraded-sticky state', async () => {
    // Direct test by manipulating session state — full LSP integration
    // can't easily simulate "degraded then clean" with the fake fixture.
    const { getLiveSession, _resetSessions } = await import('../../../mcp/stdio/code-intel/live.js');
    _resetSessions();
    const repo = tmpRepo();
    const session = await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeProgressSpawn });
    expect(session.referencesStickyDegraded).toBeNull();

    // Simulate a prior degraded result staying sticky on the session
    session.referencesStickyDegraded = { cause: 'cold_index', since: Date.now() };

    // Now run a normal references call — it'll look clean (fresh+callsites
    // via the fake LSP) but the sticky state should add a warning.
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, waitForReadyMs: 500, spawn: fakeProgressSpawn });
    expect(r.evidence.previouslyDegraded).toBe('cold_index');
    expect(r.evidence.warnings.some(w => w.includes('cold_index'))).toBe(true);
    // After this ready+exhaustive result, sticky state should be cleared
    expect(session.referencesStickyDegraded).toBeNull();
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

// Audit 2026-06-12 B2 — long-lived sessions must re-sync edited files.
describe('openIfNeeded — re-sync on disk edit (stale-doc fix)', () => {
  it('sends didChange with a bumped version when the file changed on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-b2-'));
    const file = path.join(dir, 'a.cpp');
    fs.writeFileSync(file, 'void a(){}\n');
    const client = new LspClient({ ...fakeSpawn, rootUri: 'file:///r' });
    await client.start();
    const session = { projectRoot: dir, language: 'cpp', client, openedUris: new Set() };

    await openIfNeeded(session, 'a.cpp'); // didOpen, version 1
    const spy = vi.spyOn(client, 'didChange');

    // Edit on disk (append → different size, and a new mtime).
    fs.writeFileSync(file, 'void a(){}\nvoid a2(){}\n');
    await openIfNeeded(session, 'a.cpp');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toBe(2); // version bumped

    // No further change → no extra didChange.
    await openIfNeeded(session, 'a.cpp');
    expect(spy).toHaveBeenCalledTimes(1);

    await client.shutdown();
  });
});
