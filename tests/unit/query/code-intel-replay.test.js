// Plan #8: code_intel_replay — read parent-collected v0.2 facts without
// spawning clangd. Tests cover the senior-dev acceptance set:
// fixture DB with imported v0.2 collection, latest collection fallback,
// symbol filter, kind filter, missing collection → not_collected,
// byte-cap/limit behavior.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { codeIntelReplay } from '../../../mcp/stdio/query/verbs/code_intel_replay.js';

function setupRepo(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-replay-'));
  mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  const dbPath = path.join(dir, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixture) {
    const tmp = path.join(os.tmpdir(), `apg-replay-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, fs.readFileSync(`tests/fixtures/code-intel/v02/${fixture}`, 'utf8'));
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return dir;
}

describe('code_intel_replay', () => {
  it('returns not_collected when no graph DB exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-replay-noDB-'));
    const r = await codeIntelReplay({ repoRoot: dir });
    expect(r.status).toBe('not_collected');
    expect(r.reason).toBe('no_graph_db');
    expect(r.provenance).toBe('CODE_INTEL_REPLAY');
  });

  it('returns not_collected with reason when no collection has been imported', async () => {
    const dir = setupRepo();
    const r = await codeIntelReplay({ repoRoot: dir });
    expect(r.status).toBe('not_collected');
    expect(r.reason).toBe('no_collection_imported');
  });

  it('resolves "latest" to the most recently imported collection and returns records', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, collectionId: 'latest' });
    expect(r.status).toBe('ok');
    expect(r.collectionId).toMatch(/^ci-/);
    expect(r.result_state).toBe('found');
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records[0].provenance).toBe('CODE_INTEL_REPLAY');
    expect(r.summary.references + r.summary.definitions).toBeGreaterThan(0);
  });

  it('filters records by symbol qname', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, symbol: 'ns::foo(int)' });
    expect(r.status).toBe('ok');
    expect(r.records.length).toBeGreaterThan(0);
    for (const rec of r.records) {
      expect(rec.qname).toBe('ns::foo(int)');
    }
  });

  it('filters records by kind=references', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, kind: 'references' });
    expect(r.status).toBe('ok');
    for (const rec of r.records) {
      expect(rec.kind).toBe('reference');
    }
  });

  it('filters by file', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, file: 'src/bar.cpp' });
    expect(r.status).toBe('ok');
    for (const rec of r.records) {
      expect(rec.file).toBe('src/bar.cpp');
    }
  });

  it('returns not_collected when collectionId does not match any row', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, collectionId: 'ci-does-not-exist' });
    expect(r.status).toBe('not_collected');
    expect(r.reason).toBe('collection_id_not_found');
  });

  it('respects limit', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, limit: 1 });
    expect(r.status).toBe('ok');
    expect(r.records.length).toBeLessThanOrEqual(1);
  });

  it('returns result_state=not_found with empty records when filters match nothing', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, symbol: 'no::such::symbol' });
    expect(r.status).toBe('ok');
    expect(r.result_state).toBe('not_found');
    expect(r.records).toEqual([]);
  });

  it('rejects invalid kind', async () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const r = await codeIntelReplay({ repoRoot: dir, kind: 'gibberish' });
    expect(r.status).toBe('error');
    expect(r.errors[0].hint).toMatch(/expected one of/);
  });

  it('parent-session demo: parent imports, replay answers without clangd', async () => {
    // The parent (this test) imports a v0.2 collection. The "subagent" later
    // calls replay against the same DB to ask for foo(int) references —
    // no clangd, no LSP client started, no live verb path.
    const dir = setupRepo('cpp-basic-collection.json');
    const sub = await codeIntelReplay({ repoRoot: dir, symbol: 'ns::foo(int)', kind: 'references' });
    expect(sub.status).toBe('ok');
    expect(sub.result_state).toBe('found');
    expect(sub.records.length).toBeGreaterThan(0);
    expect(sub.records[0].file).toBe('src/bar.cpp');
    expect(sub.records[0].provenance).toBe('CODE_INTEL_REPLAY');
  });
});
