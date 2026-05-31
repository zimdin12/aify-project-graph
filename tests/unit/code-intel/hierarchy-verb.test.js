// L4 unit tests: code_intel_hierarchy against the fake LSP fixture.
// Covers tree shape, depth capping, breadth capping, kind routing
// (callers/callees/subtypes/supertypes), and the index-ready vs not-ready
// TRUST banner / evidence contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  codeIntelHierarchy,
  buildHierarchyEvidence,
  buildHierarchyTrustLine,
  resolveSymbolPosition
} from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';
import { _resetSessions, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
// Progress spawn → fake server emits $/progress begin+end so the session
// reaches index-ready ('fresh'); waitForIndexReady resolves ready:true.
const fakeProgressSpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_PROGRESS: '1' } };

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-hier-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of ['foo.cpp', 'bar.cpp', 'baz.cpp', 'qux.cpp']) {
    fs.writeFileSync(path.join(dir, 'src', f), `void ${f.replace('.cpp', '')}(){}\n`);
  }
  return dir;
}

beforeEach(() => { _resetSessions(); delete process.env.APG_CLANGD_MODE; });
afterEach(async () => { await shutdownAllSessions(); _resetSessions(); delete process.env.APG_CLANGD_MODE; });

describe('code_intel_hierarchy — kind routing', () => {
  it('callers → builds an incoming-call tree with file:line hops', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', depth: 2, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.kind).toBe('callers');
    // root foo → caller_a, caller_b; caller_a → top
    expect(r.tree.name).toBe('foo');
    const childNames = r.tree.children.map(c => c.name).sort();
    expect(childNames).toEqual(['caller_a', 'caller_b']);
    const callerA = r.tree.children.find(c => c.name === 'caller_a');
    expect(callerA.children.map(c => c.name)).toEqual(['top']);
    // file:line hops present + [lsp✓] mark in rendered text
    expect(r.treeText).toMatch(/caller_a.*bar\.cpp:11/);
    expect(r.treeText).toContain('[lsp✓]');
    expect(callerA.file).toMatch(/bar\.cpp/);
    expect(callerA.line).toBe(11); // 0-based 10 → 1-based 11
  });

  it('callees → builds an outgoing-call tree', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callees', depth: 2, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    const childNames = r.tree.children.map(c => c.name).sort();
    expect(childNames).toEqual(['callee_x', 'callee_y']);
    const cx = r.tree.children.find(c => c.name === 'callee_x');
    expect(cx.children.map(c => c.name)).toEqual(['deep_z']);
  });

  it('subtypes → builds a type-hierarchy tree (virtual-override set)', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'subtypes', depth: 2, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.tree.name).toBe('Base');
    const names = r.tree.children.map(c => c.name).sort();
    expect(names).toEqual(['DerivedA', 'DerivedB']);
    const dA = r.tree.children.find(c => c.name === 'DerivedA');
    expect(dA.children.map(c => c.name)).toEqual(['LeafA']);
  });

  it('supertypes → walks base types', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'supertypes', depth: 2, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.tree.children.map(c => c.name)).toEqual(['GrandBase']);
  });

  it('rejects an invalid kind', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, kind: 'bogus', spawn: fakeProgressSpawn });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('internal_error');
  });
});

describe('code_intel_hierarchy — depth + breadth capping', () => {
  it('depth=1 stops after the first level (no grandchildren)', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', depth: 1, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.tree.children.map(c => c.name).sort()).toEqual(['caller_a', 'caller_b']);
    // depth=1 → caller_a should NOT be expanded
    const callerA = r.tree.children.find(c => c.name === 'caller_a');
    expect(callerA.children).toEqual([]);
  });

  it('breadthCap=1 keeps one child and reports TRUNCATED', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', depth: 1, breadthCap: 1, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.tree.children.length).toBe(1);
    expect(r.tree.truncated).toBe(1);
    expect(r.treeText).toMatch(/TRUNCATED — 1 more/);
  });

  it('totalCap bounds the whole tree', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', depth: 5, totalCap: 2, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.telemetry.nodes).toBeLessThanOrEqual(2);
  });
});

describe('code_intel_hierarchy — index-ready vs not-ready banner/evidence', () => {
  it('INDEXED + index-ready → lsp-verified banner + evidence.exhaustive=true', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', waitForReadyMs: 2000, spawn: fakeProgressSpawn });
    expect(r.mode).toBe('indexed');
    expect(r.indexReady).toBe(true);
    expect(r.trust).toMatch(/lsp-verified \(clangd, index-ready/);
    expect(r.evidence.exhaustive).toBe(true);
    expect(r.evidence.ready).toBe(true);
    expect(r.evidence.degraded).toBe(false);
    expect(r.treeText).toContain('lsp-verified');
  });

  it('BOUNDED mode → lsp-partial banner + evidence.cause=bounded_mode (never exhaustive)', async () => {
    process.env.APG_CLANGD_MODE = 'bounded';
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', spawn: fakeProgressSpawn });
    expect(r.mode).toBe('bounded');
    expect(r.indexReady).toBeNull();
    expect(r.trust).toMatch(/lsp-partial.*bounded mode/);
    expect(r.evidence.exhaustive).toBe(false);
    expect(r.evidence.cause).toBe('bounded_mode');
  });
});

describe('code_intel_hierarchy — error envelopes', () => {
  it('language_unsupported when no live session registered', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, kind: 'callers', language: 'rust' });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('language_unsupported');
  });

  it('no_position when neither file+line nor symbol given', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, kind: 'callers', spawn: fakeProgressSpawn });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('no_position');
  });

  it('hierarchy_unsupported when server does not advertise the provider', async () => {
    const repo = tmpRepo();
    const noHierSpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_NO_HIERARCHY: '1' } };
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', spawn: noHierSpawn });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('hierarchy_unsupported');
  });

  it('returns an empty (but ok) result when no hierarchy root resolves', async () => {
    const repo = tmpRepo();
    const emptySpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_PROGRESS: '1', FAKE_LSP_HIERARCHY_EMPTY: '1' } };
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', spawn: emptySpawn });
    expect(r.status).toBe('ok');
    expect(r.tree).toBeNull();
    expect(r.treeText).toMatch(/no call hierarchy root/);
  });
});

describe('code_intel_hierarchy — evidence/banner unit cases', () => {
  it('buildHierarchyEvidence: indexed+ready → exhaustive', () => {
    const e = buildHierarchyEvidence({ mode: 'indexed', indexReady: true, nodeCount: 3 });
    expect(e.exhaustive).toBe(true);
    expect(e.ready).toBe(true);
    expect(e.cause).toBeNull();
  });
  it('buildHierarchyEvidence: indexed+not-ready → cold_index', () => {
    const e = buildHierarchyEvidence({ mode: 'indexed', indexReady: false, nodeCount: 3 });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('cold_index');
    expect(e.degraded).toBe(true);
  });
  it('buildHierarchyEvidence: bounded → bounded_mode', () => {
    const e = buildHierarchyEvidence({ mode: 'bounded', indexReady: null, nodeCount: 3 });
    expect(e.cause).toBe('bounded_mode');
    expect(e.exhaustive).toBe(false);
  });
  it('buildHierarchyTrustLine: not-ready says NOT ready', () => {
    const line = buildHierarchyTrustLine({ mode: 'indexed', indexReady: false, kind: 'callers', nodeCount: 2 });
    expect(line).toMatch(/lsp-partial.*NOT ready/);
  });
  it('buildHierarchyTrustLine: type kind labels "type hierarchy"', () => {
    const line = buildHierarchyTrustLine({ mode: 'indexed', indexReady: true, kind: 'subtypes', nodeCount: 4 });
    expect(line).toMatch(/type hierarchy/);
  });
});

describe('code_intel_hierarchy — symbol resolution via graph', () => {
  it('resolveSymbolPosition returns null when no graph db exists', () => {
    const repo = tmpRepo(); // no .aify-graph
    const pos = resolveSymbolPosition({ repoRoot: repo, symbol: 'foo' });
    expect(pos).toBeNull();
  });

  it('symbol_not_found error when symbol cannot be resolved and no file given', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, symbol: 'NoSuchSymbol', kind: 'callers', spawn: fakeProgressSpawn });
    expect(r.status).toBe('error');
    expect(r.errors[0].code).toBe('symbol_not_found');
  });
});
