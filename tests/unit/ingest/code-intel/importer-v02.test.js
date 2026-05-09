import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/code-intel/v02', name),
      'utf8'
    )
  );
}

describe('importer v0.2', () => {
  let tmpFile;
  let dir;
  let db;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'apg-ci-import-v02-'));
    db = openDb(path.join(dir, 'graph.sqlite'));
    tmpFile = path.join(dir, `apg-ci-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('ingests a v0.2 basic collection without throwing', () => {
    fs.writeFileSync(tmpFile, JSON.stringify(loadFixture('cpp-basic-collection.json')));
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.recordsImported).toBe(2);
    expect(stats.collectionId).toMatch(/^ci-/);
  });

  it('ingests a v0.2 partial collection and surfaces partial status in stats', () => {
    fs.writeFileSync(tmpFile, JSON.stringify(loadFixture('cpp-partial-collection.json')));
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.collectionStatus).toBe('partial');
    expect(stats.operations.references.status).toBe('partial');
    expect(stats.operations.references.notCollectedFiles).toEqual(['src/baz.cpp', 'src/qux.cpp']);
  });

  it('rejects a v0.2 envelope that fails validation', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ schema_version: '0.2', collectionId: 'x', records: [] }));
    expect(() => importCodeIntel(tmpFile, db)).toThrow(/validation/i);
  });

  it('still ingests v0.1 JSONL files unchanged', () => {
    const v01 = [
      { kind: 'symbol', qname: 'foo', file: 'src/foo.cpp', start_line: 1, end_line: 1 }
    ].map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(tmpFile, v01);
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.1');
    expect(stats.recordsImported).toBe(1);
  });
});
