import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { changePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cp-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  const tmp = path.join(os.tmpdir(), `apg-cp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
  const db2 = openExistingDb(dbPath, { readonly: false });
  importCodeIntel(tmp, db2);
  db2.close();
  return dir;
}

describe('change_plan code_intel ranking', () => {
  it('annotates affected-files items with provenance when code-intel evidence is available', async () => {
    const dir = setupRepo();
    const result = await changePlan({ repoRoot: dir, symbol: 'ns::foo(int)' });
    expect(result.affected).toBeTruthy();
    expect(Array.isArray(result.affected.items)).toBe(true);
    if (result.affected.items.length > 0) {
      const ciItem = result.affected.items.find((it) => it.provenance === 'CODE_INTEL');
      expect(ciItem).toBeTruthy();
      expect(ciItem.file).toBe('src/bar.cpp');
    }
    expect(result.code_intel_used).toBe(true);
  });

  it('falls back gracefully when no code-intel evidence is present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cp-empty-'));
    const graphDir = path.join(dir, '.aify-graph');
    mkdirSync(graphDir, { recursive: true });
    const dbPath = path.join(graphDir, 'graph.sqlite');
    const db = openDb(dbPath);
    db.close();
    const result = await changePlan({ repoRoot: dir, symbol: 'unknown::sym' });
    expect(result.code_intel_used).toBe(false);
  });
});
