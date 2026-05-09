import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import {
  getCodeIntelEvidenceForSymbol,
  getCodeIntelDiagnosticsForFiles,
  getLatestCollection
} from '../../../mcp/stdio/code-intel/query.js';

const fixtureRepo = path.resolve('tests/fixtures/code-intel/v02');

function importFixture(db, name) {
  const tmp = path.join(os.tmpdir(), `apg-q-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(fixtureRepo, name), 'utf8'));
  return importCodeIntel(tmp, db);
}

describe('code-intel query helpers', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns latest collection metadata', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const latest = getLatestCollection(db);
    expect(latest).toBeTruthy();
    expect(latest.provider).toBe('cpp-clangd');
    expect(latest.status).toBe('ok');
  });

  it('finds defs/refs for a symbol qname', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const evidence = getCodeIntelEvidenceForSymbol(db, { qname: 'ns::foo(int)' });
    expect(evidence.found).toBe(true);
    expect(evidence.definitions.length).toBe(1);
    expect(evidence.references.length).toBe(1);
    expect(evidence.references[0].file).toBe('src/bar.cpp');
  });

  it('returns found=false when symbol is unknown', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const evidence = getCodeIntelEvidenceForSymbol(db, { qname: 'unknown::sym' });
    expect(evidence.found).toBe(false);
    expect(evidence.definitions.length).toBe(0);
  });

  it('returns diagnostics for queried files when present', () => {
    importFixture(db, 'cpp-partial-collection.json');
    const diags = getCodeIntelDiagnosticsForFiles(db, ['src/bar.cpp']);
    expect(Array.isArray(diags)).toBe(true);
  });
});
