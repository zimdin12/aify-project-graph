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
  resolveSymbolPosition,
  columnOfSymbolOnLine
} from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
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
    // I3 — index-ready exhaustive tree: per-node ground-truth mark is allowed.
    expect(r.treeText).toContain('[lsp✓]');
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
    // I3 — bounded mode's banner says lsp-partial, so per-node marks must NOT
    // claim ground truth with a bare [lsp✓] (that would contradict the banner
    // and the "do NOT re-grep" doctrine). Use the distinct partial marker.
    expect(r.treeText).not.toContain('[lsp✓]');
    expect(r.treeText).toContain('[lsp~]');
  });

  it('I3: per-node mark is gated on indexReady===true (cold/not-ready → no bare [lsp✓])', async () => {
    // FAKE_LSP_PROGRESS unset → no $/progress events. When the fake server does
    // not reach index-ready, indexReady is false in INDEXED mode and the banner
    // is lsp-partial — the per-node marks must then be [lsp~], never a bare
    // [lsp✓]. (If the fixture happens to report ready, the [lsp✓] path is
    // already covered by the index-ready test above; we only assert the gate
    // when the not-ready condition actually held.)
    const repo = tmpRepo();
    const coldSpawn = { command: process.execPath, args: [fakeServer], env: { ...process.env } };
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', waitForReadyMs: 200, spawn: coldSpawn });
    expect(r.mode).toBe('indexed');
    if (r.indexReady === true) {
      // Fixture reached ready — ground-truth mark is legitimate here.
      if (r.tree) expect(r.treeText).toContain('[lsp✓]');
    } else {
      expect(r.trust).toMatch(/lsp-partial|index NOT ready/);
      if (r.tree) {
        expect(r.treeText).not.toContain('[lsp✓]');
        expect(r.treeText).toContain('[lsp~]');
      }
    }
  });
});

// HIGH-1 (gtest-claude 2026-05-31): the false-exhaustive trap. An index-ready
// root that returns 0 incoming/outgoing calls must NOT claim exhaustive=true /
// "lsp-verified exhaustive" — cross-TU resolution is unconfirmed, so an empty
// hierarchy is NOT safe evidence of absence (mirrors code_intel_references'
// definition_only gating). Only a NON-EMPTY index-ready tree is exhaustive.
describe('code_intel_hierarchy — HIGH-1 empty-tree is NOT exhaustive', () => {
  const rootOnlySpawn = {
    command: process.execPath,
    args: [fakeServer],
    env: { ...process.env, FAKE_LSP_PROGRESS: '1', FAKE_LSP_HIERARCHY_ROOT_ONLY: '1' }
  };

  it('index-ready + 0 callers → degraded, cause=no_incoming_unconfirmed, exhaustive=FALSE', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', waitForReadyMs: 2000, spawn: rootOnlySpawn });
    expect(r.status).toBe('ok');
    expect(r.indexReady).toBe(true);
    // The root resolved but nothing linked to it → root-only tree.
    expect(r.tree).not.toBeNull();
    expect(r.tree.children).toEqual([]);
    expect(r.telemetry.nodes).toBe(1);
    // The thesis bug: it USED to report exhaustive=true here. Now it must NOT.
    expect(r.evidence.exhaustive).toBe(false);
    expect(r.evidence.degraded).toBe(true);
    expect(r.evidence.cause).toBe('no_incoming_unconfirmed');
    expect(r.evidence.warnings.join(' ')).toMatch(/NOT safe evidence of no callers/);
    // Banner must NOT claim lsp-verified exhaustive; must point at references/rg.
    expect(r.trust).not.toMatch(/lsp-verified \(clangd, index-ready, call hierarchy/);
    expect(r.trust).toMatch(/lsp-partial/);
    expect(r.trust).toMatch(/code_intel_references/);
    // I3/HIGH-1 — partial banner ⇒ no bare ground-truth [lsp✓] node mark.
    expect(r.treeText).not.toContain('[lsp✓]');
    expect(r.treeText).toContain('[lsp~]');
  });

  it('index-ready + NON-EMPTY tree still reports exhaustive=true (positive path intact)', async () => {
    const repo = tmpRepo();
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/foo.cpp', line: 1, col: 6, kind: 'callers', waitForReadyMs: 2000, spawn: fakeProgressSpawn });
    expect(r.status).toBe('ok');
    expect(r.indexReady).toBe(true);
    expect(r.telemetry.nodes).toBeGreaterThan(1);
    expect(r.evidence.exhaustive).toBe(true);
    expect(r.evidence.degraded).toBe(false);
    expect(r.trust).toMatch(/lsp-verified \(clangd, index-ready/);
    expect(r.treeText).toContain('[lsp✓]');
  });

  it('buildHierarchyEvidence: indexed+ready but nodeCount<=1 → no_incoming_unconfirmed (unit)', () => {
    const e = buildHierarchyEvidence({ mode: 'indexed', indexReady: true, nodeCount: 1, kind: 'callers' });
    expect(e.exhaustive).toBe(false);
    expect(e.degraded).toBe(true);
    expect(e.cause).toBe('no_incoming_unconfirmed');
  });

  it('buildHierarchyTrustLine: indexed+ready but empty → lsp-partial, not lsp-verified', () => {
    const line = buildHierarchyTrustLine({ mode: 'indexed', indexReady: true, kind: 'callers', nodeCount: 1 });
    expect(line).toMatch(/lsp-partial/);
    expect(line).not.toMatch(/lsp-verified/);
    expect(line).toMatch(/code_intel_references/);
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

// FIX 1 (test-round-2026-05-31): column resolution from a source line. The old
// resolveSymbolPosition defaulted col=1, so clangd's prepareCallHierarchy was
// queried at the start of the declaration line — landing on the return type /
// indentation and MISSING the method. These cover the leaf-column derivation
// and the qualified-symbol (Foo::bar) graph lookup.
describe('columnOfSymbolOnLine (FIX 1)', () => {
  it('finds the leaf-name column in an out-of-line definition', () => {
    // "bool SimCoordinator::registerDomain(...)" — leaf at col 22, NOT col 1.
    const line = 'bool SimCoordinator::registerDomain(ISimDomain& domain) {';
    expect(columnOfSymbolOnLine(line, 'registerDomain', 'SimCoordinator::registerDomain')).toBe(22);
  });

  it('finds the leaf-name column in an in-class declaration (indented)', () => {
    const line = '    bool setVoxel(int worldX, int worldY, int worldZ);';
    expect(columnOfSymbolOnLine(line, 'setVoxel', 'setVoxel')).toBe(10);
  });

  it('respects word boundaries (does not match a longer identifier prefix)', () => {
    const line = '    void setVoxelRange(); void setVoxel();';
    // Must skip "setVoxelRange" and land on the standalone "setVoxel".
    const col = columnOfSymbolOnLine(line, 'setVoxel', 'setVoxel');
    expect(line.slice(col - 1)).toMatch(/^setVoxel\(/);
  });

  it('falls back to col 1 when the name is not on the line', () => {
    expect(columnOfSymbolOnLine('    int unrelated;', 'setVoxel', 'setVoxel')).toBe(1);
    expect(columnOfSymbolOnLine('', 'setVoxel', 'setVoxel')).toBe(1);
  });
});

describe('resolveSymbolPosition — leaf column + qualified lookup (FIX 1)', () => {
  function repoWithGraph() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-resolve-'));
    fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // Out-of-line definition: leaf "doThing" is at column 17 (1-based).
    fs.writeFileSync(
      path.join(dir, 'src', 'Widget.cpp'),
      'bool Widget::doThing(int n) {\n  return n > 0;\n}\n'
    );
    // In-class declaration in a header (a second candidate for the same leaf).
    fs.writeFileSync(
      path.join(dir, 'src', 'Widget.h'),
      'class Widget {\n  bool doThing(int n);\n};\n'
    );
    const db = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
    // Graph stores the LEAF label, not the qualified name (matches real extract).
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line) VALUES
        ('n1','Method','doThing','src/Widget.h',2),
        ('n2','Method','doThing','src/Widget.cpp',1)`
    );
    db.close();
    return dir;
  }

  it('resolves a leaf symbol to the identifier column (not col 1)', () => {
    const repo = repoWithGraph();
    const pos = resolveSymbolPosition({ repoRoot: repo, symbol: 'doThing' });
    expect(pos).not.toBeNull();
    // Header decl "  bool doThing(int n);" → leaf at col 8.
    const src = fs.readFileSync(path.join(repo, pos.file), 'utf8').split(/\r?\n/);
    expect(src[pos.line - 1].slice(pos.col - 1)).toMatch(/^doThing\b/);
    expect(pos.col).toBeGreaterThan(1);
  });

  it('resolves a QUALIFIED symbol (Class::method) via leaf lookup and prefers the definition line', () => {
    const repo = repoWithGraph();
    const pos = resolveSymbolPosition({ repoRoot: repo, symbol: 'Widget::doThing' });
    expect(pos).not.toBeNull();
    // The qualified spelling "Widget::doThing" only appears in the .cpp def,
    // so resolution must prefer that file and anchor on the leaf column.
    expect(pos.file).toBe('src/Widget.cpp');
    const src = fs.readFileSync(path.join(repo, pos.file), 'utf8').split(/\r?\n/);
    expect(src[pos.line - 1].slice(pos.col - 1)).toMatch(/^doThing\b/);
    expect(pos.col).toBe(14); // "bool Widget::doThing" → leaf at col 14
  });

  it('returns null for an unknown symbol', () => {
    const repo = repoWithGraph();
    expect(resolveSymbolPosition({ repoRoot: repo, symbol: 'nope' })).toBeNull();
  });
});
