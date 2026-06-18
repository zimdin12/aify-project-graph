import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { importCodeIntel, compactCodeIntelRecords } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/code-intel/v02', name), 'utf8'));
}

describe('importer records collections', () => {
  it('inserts a code_intel_collections row when ingesting a v0.2 envelope', () => {
    const tmp = path.join(os.tmpdir(), `apg-cic-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(loadFixture('cpp-basic-collection.json')));
    const db = openDb(':memory:');
    const stats = importCodeIntel(tmp, db);
    expect(stats.collectionId).toMatch(/^ci-/);
    const row = db.get('SELECT * FROM code_intel_collections WHERE collection_id=$id', { id: stats.collectionId });
    expect(row).toBeTruthy();
    expect(row.provider).toBe('cpp-clangd');
    expect(row.status).toBe('ok');
    const ops = JSON.parse(row.operations_json);
    expect(ops.definitions.status).toBe('ok');
  });

  it('records partial-status collections with operations json', () => {
    const tmp = path.join(os.tmpdir(), `apg-cic-${Date.now()}-p.json`);
    fs.writeFileSync(tmp, JSON.stringify(loadFixture('cpp-partial-collection.json')));
    const db = openDb(':memory:');
    const stats = importCodeIntel(tmp, db);
    const row = db.get('SELECT * FROM code_intel_collections WHERE collection_id=$id', { id: stats.collectionId });
    expect(row.status).toBe('partial');
    const ops = JSON.parse(row.operations_json);
    expect(ops.references.status).toBe('partial');
    expect(ops.references.notCollectedFiles).toContain('src/baz.cpp');
  });

  // Regression: code_intel_records grew unbounded across runs (sand_castle hit
  // 1.03M rows / 732MB / 13 collections) because superseded collections were
  // never pruned — and getCodeIntelEvidenceForSymbol queries across ALL
  // collections, so stale evidence resurfaced. A COMPLETE collect now prunes
  // prior same-provider collections.
  const importEnvelope = (db, envelope) => {
    const tmp = path.join(os.tmpdir(), `apg-cic-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, JSON.stringify(envelope));
    return importCodeIntel(tmp, db);
  };

  it('a complete collect prunes superseded same-provider collections (no unbounded growth)', () => {
    const db = openDb(':memory:');
    const base = loadFixture('cpp-basic-collection.json');
    // First complete collect.
    const first = { ...base, collectionId: 'ci-run-1' };
    importEnvelope(db, first);
    expect(db.get('SELECT COUNT(*) AS c FROM code_intel_collections').c).toBe(1);
    const firstRecords = db.get('SELECT COUNT(*) AS c FROM code_intel_records').c;
    expect(firstRecords).toBeGreaterThan(0);

    // Second complete collect, new id, SAME provider → supersedes the first.
    const second = { ...base, collectionId: 'ci-run-2' };
    const stats = importEnvelope(db, second);
    // Only the latest collection + its records remain.
    expect(db.get('SELECT COUNT(*) AS c FROM code_intel_collections').c).toBe(1);
    expect(db.get('SELECT collection_id FROM code_intel_collections').collection_id).toBe('ci-run-2');
    expect(db.get('SELECT COUNT(*) AS c FROM code_intel_records WHERE collection_id=$id', { id: 'ci-run-1' }).c).toBe(0);
    expect(db.get('SELECT COUNT(*) AS c FROM code_intel_records').c).toBe(firstRecords); // not 2×
    expect(stats.recordsPruned).toBe(firstRecords);
    expect(stats.collectionsPruned).toBe(1);
  });

  it('a PARTIAL collect does NOT prune the prior complete collection', () => {
    const db = openDb(':memory:');
    importEnvelope(db, { ...loadFixture('cpp-basic-collection.json'), collectionId: 'ci-complete' });
    // Partial re-collect (a slice) must keep the prior complete collection.
    importEnvelope(db, { ...loadFixture('cpp-partial-collection.json'), collectionId: 'ci-partial' });
    const ids = db.all('SELECT collection_id FROM code_intel_collections ORDER BY collection_id').map((r) => r.collection_id);
    expect(ids).toContain('ci-complete');
    expect(ids).toContain('ci-partial');
  });

  it('a different provider is NOT pruned by a complete collect', () => {
    const db = openDb(':memory:');
    // Seed a python (pyright) collection, then a complete cpp collect.
    const py = { ...loadFixture('cpp-basic-collection.json'), collectionId: 'ci-py', provider: 'py-pyright' };
    importEnvelope(db, py);
    importEnvelope(db, { ...loadFixture('cpp-basic-collection.json'), collectionId: 'ci-cpp' });
    const ids = db.all('SELECT collection_id FROM code_intel_collections ORDER BY collection_id').map((r) => r.collection_id);
    expect(ids).toContain('ci-py');   // other backend survives
    expect(ids).toContain('ci-cpp');
  });

  // One-shot maintenance for graphs that bloated before the auto-prune landed
  // (sand_castle: 1.03M rows across 13 clangd collections). Keeps the latest
  // collection per provider, prunes the rest.
  it('compactCodeIntelRecords keeps the latest collection per provider, prunes older ones', () => {
    const db = openDb(':memory:');
    const base = loadFixture('cpp-basic-collection.json');
    const partial = loadFixture('cpp-partial-collection.json');
    // Pre-bloat state: an OLDER complete cpp collection + a NEWER cpp collection.
    // Using a PARTIAL second collect means the auto-prune leaves the older one in
    // place (partial doesn't prune) so both coexist — exactly the legacy bloat.
    importEnvelope(db, { ...base, collectionId: 'ci-cpp-old', session: { ...(base.session || {}), collectedAt: '2026-01-01T00:00:00Z' } });
    importEnvelope(db, { ...partial, collectionId: 'ci-cpp-new', session: { ...(partial.session || {}), collectedAt: '2026-06-01T00:00:00Z' } });
    // A different backend — must be kept regardless of age.
    importEnvelope(db, { ...base, collectionId: 'ci-py', provider: 'py-pyright', session: { ...(base.session || {}), collectedAt: '2026-03-01T00:00:00Z' } });
    expect(db.get('SELECT COUNT(*) AS c FROM code_intel_collections').c).toBe(3); // 2 cpp + 1 py

    const res = compactCodeIntelRecords(db);
    const remaining = db.all('SELECT collection_id FROM code_intel_collections ORDER BY collection_id').map((r) => r.collection_id);
    expect(remaining).toContain('ci-cpp-new');   // latest cpp kept
    expect(remaining).toContain('ci-py');        // other backend kept
    expect(remaining).not.toContain('ci-cpp-old');
    expect(db.get(`SELECT COUNT(*) AS c FROM code_intel_records WHERE collection_id='ci-cpp-old'`).c).toBe(0);
    expect(res.collectionsPruned).toBe(1);
  });
});
