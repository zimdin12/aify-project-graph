import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-h-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  return { dir, graphDir, dbPath };
}

describe('graph_health.codeIntel', () => {
  it('reports codeIntel.available=false when no collection exists', async () => {
    const { dir } = setupRepo();
    const result = await graphHealth({ repoRoot: dir });
    expect(result.codeIntel.available).toBe(false);
    expect(result.codeIntel.reason).toBe('no_collection');
  });

  it('reports codeIntel.available=true after a collection import', async () => {
    const { dir, dbPath } = setupRepo();
    const tmp = path.join(os.tmpdir(), `apg-h-ci-${Date.now()}.json`);
    fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
    const db = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db);
    db.close();
    const result = await graphHealth({ repoRoot: dir });
    expect(result.codeIntel.available).toBe(true);
    expect(result.codeIntel.provider).toBe('cpp-clangd');
    expect(result.codeIntel.status).toBe('ok');
  });
});
