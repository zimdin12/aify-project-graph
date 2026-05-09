import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

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
});
