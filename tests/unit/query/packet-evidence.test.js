import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { buildEvidenceBlock, renderEvidenceBlock } from '../../../mcp/stdio/query/verbs/packet-evidence.js';

function setupRepo(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pe-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixture) {
    const tmp = path.join(os.tmpdir(), `apg-pe-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, fs.readFileSync(`tests/fixtures/code-intel/v02/${fixture}`, 'utf8'));
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return dir;
}

describe('packet-evidence', () => {
  it('returns available=false with reason when no code-intel collection exists', () => {
    const dir = setupRepo();
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.available).toBe(false);
    expect(block.reason).toBe('no_collection');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/code_intel unavailable/);
  });

  it('returns available=true with provider + status when a fresh collection exists', () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.available).toBe(true);
    expect(block.provider).toBe('cpp-clangd');
    expect(block.status).toBe('ok');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/EVIDENCE:/);
    expect(rendered).toMatch(/cpp-clangd/);
  });

  it('renders partial status distinctly from ok', () => {
    const dir = setupRepo('cpp-partial-collection.json');
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.status).toBe('partial');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/partial/);
    expect(rendered).toMatch(/references/);
  });
});
