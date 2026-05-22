// Plan #15 Step A3 tests: deterministic structural extract for the
// intelligence pipeline. Uses an in-memory APG graph DB seeded with
// nodes + edges; verifies the extract is deterministic, includes
// per-file shas + LOC, splits exports/imports/importedBy correctly,
// and that the inputSha is stable across runs but flips on content change.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { buildStructuralExtract, batchFilesForLlm } from '../../../mcp/stdio/intelligence/extract.js';

function tmpRepoWithFiles(filesByRelPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-extract-'));
  for (const [rel, content] of Object.entries(filesByRelPath)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function setupDb(repoRoot) {
  const dbPath = path.join(repoRoot, '.aify-graph', 'graph.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return openDb(dbPath);
}

describe('buildStructuralExtract', () => {
  let repo;
  let db;

  beforeEach(() => {
    repo = tmpRepoWithFiles({
      'src/api.js': 'export function handleRequest() {}\nexport class ApiRouter {}\n',
      'src/store.js': 'import { handleRequest } from "./api.js";\nexport function persist() {}\n',
      'src/util.js': 'export function fmt(x) { return String(x); }\n'
    });
    db = setupDb(repo);

    // Seed nodes — three files, with symbols.
    upsertNode(db, { id: 'sym:api:handleRequest', type: 'function', label: 'handleRequest', file_path: 'src/api.js', start_line: 1, end_line: 1, language: 'javascript' });
    upsertNode(db, { id: 'sym:api:ApiRouter',     type: 'class',    label: 'ApiRouter',     file_path: 'src/api.js', start_line: 2, end_line: 2, language: 'javascript' });
    upsertNode(db, { id: 'sym:store:persist',     type: 'function', label: 'persist',       file_path: 'src/store.js', start_line: 2, end_line: 2, language: 'javascript' });
    upsertNode(db, { id: 'sym:util:fmt',          type: 'function', label: 'fmt',           file_path: 'src/util.js', start_line: 1, end_line: 1, language: 'javascript' });

    // Edges — api.js exports its two symbols; store.js imports handleRequest from api.js.
    upsertEdge(db, { from_id: 'file:src/api.js', to_id: 'sym:api:handleRequest', relation: 'exports', source_file: 'src/api.js', source_line: 1 });
    upsertEdge(db, { from_id: 'file:src/api.js', to_id: 'sym:api:ApiRouter',     relation: 'exports', source_file: 'src/api.js', source_line: 2 });
    upsertEdge(db, { from_id: 'file:src/store.js', to_id: 'sym:api:handleRequest', relation: 'imports', source_file: 'src/store.js', source_line: 1 });
  });

  afterEach(() => { db?.close?.(); });

  it('produces one file entry per distinct file_path in nodes', () => {
    const e = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    expect(e.meta.fileCount).toBe(3);
    expect(e.files.map(f => f.path).sort()).toEqual(['src/api.js', 'src/store.js', 'src/util.js']);
  });

  it('per-file fields are populated (loc, sha, symbols, exports)', () => {
    const e = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    const api = e.files.find(f => f.path === 'src/api.js');
    expect(api.language).toBe('javascript');
    expect(api.loc).toBeGreaterThan(0);
    expect(api.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(api.symbols.map(s => s.name).sort()).toEqual(['ApiRouter', 'handleRequest']);
    expect(api.exports.sort()).toEqual(['ApiRouter', 'handleRequest']);
  });

  it('importsTo lists outbound import targets', () => {
    const e = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    const store = e.files.find(f => f.path === 'src/store.js');
    expect(store.importsTo).toContain('sym:api:handleRequest');
  });

  it('importedBy lists inbound importers', () => {
    const e = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    const api = e.files.find(f => f.path === 'src/api.js');
    expect(api.importedBy).toContain('src/store.js');
  });

  it('inputSha is stable across identical runs', () => {
    const e1 = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    const e2 = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    expect(e1.meta.inputSha).toBe(e2.meta.inputSha);
    expect(e1.meta.inputSha).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('inputSha flips when file content changes', () => {
    const before = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    fs.appendFileSync(path.join(repo, 'src/api.js'), '// extra line\n');
    const after = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    expect(after.meta.inputSha).not.toBe(before.meta.inputSha);
  });

  it('inputSha flips when graphHead changes (cache invalidation across commits)', () => {
    const a = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'commit-a' });
    const b = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'commit-b' });
    expect(a.meta.inputSha).not.toBe(b.meta.inputSha);
  });

  it('skips file paths with backslashes (forward-slash invariant)', () => {
    upsertNode(db, { id: 'sym:bad', type: 'function', label: 'bad', file_path: 'src\\backslash.js', start_line: 1, end_line: 1, language: 'javascript' });
    const e = buildStructuralExtract({ repoRoot: repo, db, graphHead: 'abc123' });
    expect(e.files.some(f => f.path.includes('\\'))).toBe(false);
  });
});

describe('batchFilesForLlm', () => {
  it('caps at maxFiles per batch', () => {
    const files = Array.from({ length: 47 }, (_, i) => ({ path: `f${i}.js`, summary: 'x' }));
    const batches = batchFilesForLlm(files, { maxFiles: 20 });
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(20);
    expect(batches[1].length).toBe(20);
    expect(batches[2].length).toBe(7);
  });

  it('caps at maxChars before maxFiles when files are heavy', () => {
    // Each file ~5KB; maxChars=10KB should fit ~2 per batch even though maxFiles=20.
    const big = { path: 'big.js', symbols: Array.from({ length: 100 }, (_, i) => ({ type: 'function', name: `sym${i}`, startLine: i, endLine: i })) };
    const files = Array.from({ length: 7 }, (_, i) => ({ ...big, path: `big${i}.js` }));
    const batches = batchFilesForLlm(files, { maxFiles: 20, maxChars: 10000 });
    expect(batches.length).toBeGreaterThan(1);
    // No batch character total should exceed maxChars + one-file-worth-of-overhead.
    for (const b of batches) {
      const total = b.reduce((acc, f) => acc + JSON.stringify(f).length, 0);
      expect(total).toBeLessThanOrEqual(10000 + 6000); // generous slack for first-file-fits rule
    }
  });

  it('empty input → empty batches', () => {
    expect(batchFilesForLlm([])).toEqual([]);
  });
});
