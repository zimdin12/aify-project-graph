import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';

function setupRepoWithCollection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pull-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  const tmp = path.join(os.tmpdir(), `apg-pull-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
  const db2 = openExistingDb(dbPath, { readonly: false });
  importCodeIntel(tmp, db2);
  db2.close();
  return dir;
}

async function pull(args) {
  // graphPull returns a JSON-formatted string; parse it for property access.
  const out = await graphPull(args);
  if (typeof out === 'string') return JSON.parse(out);
  return out;
}

describe('graph_pull code_intel layer', () => {
  it('returns code_intel evidence for a known qname when layer is requested', async () => {
    const dir = setupRepoWithCollection();
    const result = await pull({ repoRoot: dir, node: 'ns::foo(int)', layers: ['code_intel'] });
    expect(result.code_intel).toBeTruthy();
    expect(result.code_intel.found).toBe(true);
    expect(result.code_intel.definitions.length).toBe(1);
    expect(result.code_intel.references.length).toBe(1);
  });

  it('omits code_intel when layer not requested', async () => {
    const dir = setupRepoWithCollection();
    const result = await pull({ repoRoot: dir, node: 'ns::foo(int)', layers: ['code'] });
    expect(result.code_intel).toBeUndefined();
  });

  it('returns code_intel.found=false for unknown symbols', async () => {
    const dir = setupRepoWithCollection();
    const result = await pull({ repoRoot: dir, node: 'unknown::sym', layers: ['code_intel'] });
    expect(result.code_intel.found).toBe(false);
  });
});
