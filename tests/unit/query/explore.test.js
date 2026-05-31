// Unit tests for graph_explore (Code-Intel v2 / P1-3).
// Covers: multi-symbol bundling grouped by file, cat -n source, the "treat as
// already Read" framing, budget/file-cap truncation tail, and not-found tail.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { graphExplore } from '../../../mcp/stdio/query/verbs/explore.js';
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

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-explore-'));
  graphDir = join(repoRoot, '.aify-graph');
  db = openDb(join(graphDir, 'graph.sqlite'));

  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoRoot });

  await writeSrc('src/a.cpp', [
    'void one() {',   // 1
    '    // one',     // 2
    '}',              // 3
    'void two() {',   // 4
    '    // two',     // 5
    '}',              // 6
  ].join('\n') + '\n');
  await writeSrc('src/b.cpp', [
    'void three() {', // 1
    '    // three',   // 2
    '}',              // 3
  ].join('\n') + '\n');
  await writeSrc('src/c.cpp', [
    'void four() {',  // 1
    '    // four',    // 2
    '}',              // 3
  ].join('\n') + '\n');

  upsertNode(db, node('a1', 'one', 'src/a.cpp', 1, 3));
  upsertNode(db, node('a2', 'two', 'src/a.cpp', 4, 6));
  upsertNode(db, node('b1', 'three', 'src/b.cpp', 1, 3));
  upsertNode(db, node('c1', 'four', 'src/c.cpp', 1, 3));

  await writeFile(join(repoRoot, 'placeholder.txt'), 'x\n');
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoRoot });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim();

  await writeFile(join(graphDir, 'manifest.json'), JSON.stringify({
    status: 'ok', commit, indexedAt: new Date().toISOString(),
    nodes: 4, edges: 0,
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

describe('graph_explore bundling', () => {
  it('bundles multiple symbols grouped by file with cat -n source + framing', async () => {
    const out = await graphExplore({ repoRoot, symbols: ['one', 'two', 'three'] });
    expect(out).toContain('treat each block as a Read you have ALREADY performed');
    expect(out).toContain('Returned source is Read-equivalent — do NOT re-Read');
    // file-accurate cat -n numbers; two/one from a.cpp share a group, ordered by line
    expect(out).toContain('1\tvoid one() {');
    expect(out).toContain('4\tvoid two() {');
    expect(out).toContain('1\tvoid three() {');
    // two files grouped
    expect(out).toContain('across 2 files');
  });

  it('reports not-found names in a tail without failing', async () => {
    const out = await graphExplore({ repoRoot, symbols: ['one', 'nonexistentSymbolXYZ'] });
    expect(out).toContain('1\tvoid one() {');
    expect(out).toContain('NOT FOUND: nonexistentSymbolXYZ');
  });

  it('all-missing returns a NO MATCH steer', async () => {
    const out = await graphExplore({ repoRoot, symbols: ['nopeA', 'nopeB'] });
    expect(out).toContain('NO MATCH');
  });
});

describe('graph_explore budget truncation', () => {
  it('caps the number of file groups via max_files and emits a TRUNCATED tail', async () => {
    const out = await graphExplore({ repoRoot, symbols: ['one', 'three', 'four'], max_files: 1 });
    // only the first file group rendered; the rest truncated
    expect(out).toContain('TRUNCATED');
    expect(out).toContain('narrow your list');
    // first requested symbol's file is shown
    expect(out).toContain('void one() {');
    // the dropped file's source is NOT inlined
    expect(out).not.toContain('void four() {');
  });
});
