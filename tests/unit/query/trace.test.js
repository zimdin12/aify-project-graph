// Unit tests for graph_trace (Code-Intel v2 / P1-2).
// Covers: success-path shape + inlined hop bodies, max_hops rejection,
// failure-path endpoint inlining, override (OVERRIDDEN_BY/INFERRED) annotation,
// and path-proximity / definition-preference pairing.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphTrace, bfsTrace, pickBestPair } from '../../../mcp/stdio/query/verbs/trace.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { EXTRACTOR_VERSION, PARSER_BUNDLE_VERSION } from '../../../mcp/stdio/freshness/manifest.js';

let repoRoot;
let graphDir;
let db;

async function writeSrc(rel, body) {
  const abs = join(repoRoot, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, body);
}

function node(id, label, file, start, end) {
  return {
    id, type: 'Function', label, file_path: file,
    start_line: start, end_line: end, language: 'cpp',
    confidence: 1, structural_fp: '', dependency_fp: '',
    extra: { qname: label },
  };
}
function calls(from, to) {
  upsertEdge(db, {
    from_id: from, to_id: to, relation: 'CALLS',
    source_file: '', source_line: 0, confidence: 0.9,
    provenance: 'EXTRACTED', extractor: 'tree-sitter',
  });
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-trace-'));
  graphDir = join(repoRoot, '.aify-graph');
  db = openDb(join(graphDir, 'graph.sqlite'));

  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });

  // Source files with real, line-numbered bodies.
  await writeSrc('src/a.cpp', [
    'void alpha() {',     // 1
    '    beta();',        // 2
    '}',                  // 3
  ].join('\n') + '\n');
  await writeSrc('src/b.cpp', [
    'void beta() {',      // 1
    '    gamma();',       // 2
    '}',                  // 3
    'void delta() {',     // 4
    '    // unrelated file-mate',  // 5
    '}',                  // 6
  ].join('\n') + '\n');
  await writeSrc('src/c.cpp', [
    'void gamma() {',     // 1
    '    // leaf',        // 2
    '}',                  // 3
  ].join('\n') + '\n');
  await writeSrc('src/iface.h', [
    '// base interface',  // 1
    'virtual void doWork() = 0;',  // 2
  ].join('\n') + '\n');
  await writeSrc('src/impl.cpp', [
    'void Impl_doWork() {',  // 1
    '    // override body', // 2
    '}',                    // 3
  ].join('\n') + '\n');

  // alpha -> beta -> gamma (a real 2-hop static chain).
  upsertNode(db, node('a', 'alpha', 'src/a.cpp', 1, 3));
  upsertNode(db, node('b', 'beta', 'src/b.cpp', 1, 3));
  upsertNode(db, node('d', 'delta', 'src/b.cpp', 4, 6));
  upsertNode(db, node('c', 'gamma', 'src/c.cpp', 1, 3));
  calls('a', 'b');
  calls('b', 'c');

  // Override bridge: base doWork (1-line virtual decl) -> Impl override.
  upsertNode(db, { ...node('base', 'doWork', 'src/iface.h', 2, 2), type: 'Method' });
  upsertNode(db, { ...node('impl', 'doWork', 'src/impl.cpp', 1, 3), type: 'Method' });
  upsertEdge(db, {
    from_id: 'base', to_id: 'impl', relation: 'OVERRIDDEN_BY',
    source_file: '', source_line: 0, confidence: 0.7,
    provenance: 'INFERRED', extractor: 'virtual-overrides',
  });

  // An isolated pair with NO connecting path (for the failure test).
  await writeSrc('src/lonely.cpp', [
    'void lonelyFrom() {',  // 1
    '    // nothing reaches lonelyTo', // 2
    '}',                    // 3
    'void siblingMate() {', // 4
    '    // file-mate of lonelyTo target file', // 5
    '}',                    // 6
  ].join('\n') + '\n');
  upsertNode(db, node('lf', 'lonelyFrom', 'src/lonely.cpp', 1, 3));
  upsertNode(db, node('lt', 'lonelyTo', 'src/lonely.cpp', 7, 9));
  upsertNode(db, node('sm', 'siblingMate', 'src/lonely.cpp', 4, 6));

  await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

  await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
    status: 'ok', commit, indexedAt: new Date().toISOString(),
    nodes: 8, edges: 3,
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    parserBundleVersion: PARSER_BUNDLE_VERSION,
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
});

afterEach(async () => {
  try { db.close(); } catch {}
  await rm(repoRoot, { recursive: true, force: true });
});

describe('graph_trace success path', () => {
  it('renders an ordered hop list with each body inlined cat -n', async () => {
    const out = await graphTrace({ repoRoot, from: 'alpha', to: 'gamma', max_hops: 5 });
    expect(out).toContain('TRACE alpha → gamma');
    expect(out).toContain('2 hops');
    // START + 2 hop markers
    expect(out).toContain('START: alpha');
    expect(out).toContain('HOP 1 (CALLS): beta');
    expect(out).toContain('HOP 2 (CALLS): gamma');
    // inlined verbatim bodies with file-accurate line numbers
    expect(out).toContain('1\tvoid alpha() {');
    expect(out).toContain('1\tvoid beta() {');
    expect(out).toContain('1\tvoid gamma() {');
    // framing header + last-mile + trust banner
    expect(out).toContain('treat each block as a Read you have ALREADY performed');
    expect(out).toContain('LAST MILE');
    expect(out).toContain('TRUST:');
  });
});

describe('graph_trace max_hops rejection', () => {
  it('does NOT return a success path when the target is beyond max_hops', async () => {
    // alpha->beta->gamma is 2 hops; cap at 1 must reject the static path.
    const out = await graphTrace({ repoRoot, from: 'alpha', to: 'gamma', max_hops: 1 });
    expect(out).toContain('NO STATIC PATH within 1 hops');
    expect(out).not.toContain('HOP 2');
  });
});

describe('graph_trace failure-path inlining', () => {
  it('inlines both endpoints + neighbors + destination file-mates instead of 404', async () => {
    const out = await graphTrace({ repoRoot, from: 'lonelyFrom', to: 'lonelyTo', max_hops: 5 });
    expect(out).toContain('NO STATIC PATH');
    expect(out).toContain('No further node/Read needed for symbols shown.');
    // both endpoint bodies inlined
    expect(out).toContain('FROM: lonelyFrom');
    expect(out).toContain('TO: lonelyTo');
    expect(out).toContain('1\tvoid lonelyFrom() {');
    // destination file-mate inlined (the missing hop usually lives here)
    expect(out).toContain('OTHER TOP-LEVEL FUNCTIONS IN src/lonely.cpp');
    expect(out).toContain('siblingMate');
    expect(out).toContain('4\tvoid siblingMate() {');
  });
});

describe('graph_trace override annotation', () => {
  it('crosses an OVERRIDDEN_BY bridge and annotates it INFERRED virtual/override', async () => {
    const out = await graphTrace({ repoRoot, from: 'doWork', to: 'doWork', max_hops: 3 });
    expect(out).toContain('1 hop');
    expect(out).toContain('HOP 1 (OVERRIDDEN_BY): doWork');
    expect(out).toContain('[virtual/override — INFERRED; verify with code_intel_hierarchy]');
    expect(out).not.toContain('[lsp✓]');
  });
});

describe('trace internals', () => {
  it('bfsTrace returns null when the target is unreachable within the cap', () => {
    expect(bfsTrace(db, 'lf', 'lt', 5)).toBeNull();
  });
  it('bfsTrace finds the 2-hop chain', () => {
    const steps = bfsTrace(db, 'a', 'c', 5);
    expect(steps).toHaveLength(2);
    expect(steps[1].to_id).toBe('c');
  });
  it('pickBestPair prefers the connected/definition pair', () => {
    // Two candidates for `from`: a header decl (no body) and a real def.
    const decl = { id: 'x1', label: 'doWork', file_path: 'src/iface.h', start_line: 2, end_line: 2 };
    const def = { id: 'base', label: 'doWork', file_path: 'src/iface.h', start_line: 2, end_line: 2 };
    const toImpl = { id: 'impl', label: 'doWork', file_path: 'src/impl.cpp', start_line: 1, end_line: 3 };
    const pair = pickBestPair([decl, def], [toImpl], db);
    // The base node that actually has the OVERRIDDEN_BY edge wins the pairing.
    expect(pair.from.id).toBe('base');
    expect(pair.to.id).toBe('impl');
  });
});
