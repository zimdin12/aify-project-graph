import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureCodeIntelCollectionsTable } from '../../../mcp/stdio/storage/schema.js';

describe('code_intel_collections', () => {
  it('creates the table idempotently', () => {
    const db = new Database(':memory:');
    ensureCodeIntelCollectionsTable(db);
    ensureCodeIntelCollectionsTable(db);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_intel_collections'").get();
    expect(row?.name).toBe('code_intel_collections');
  });

  it('accepts a row with provider, status, freshness, operations json', () => {
    const db = new Database(':memory:');
    ensureCodeIntelCollectionsTable(db);
    db.prepare(`
      INSERT INTO code_intel_collections
        (collection_id, provider, provider_version, project_root, language, status,
         freshness_basis, freshness_value, compile_db_hash, indexed_commit,
         operations_json, collected_at, errors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ci-1', 'cpp-clangd', '0.1.0', '/r', 'cpp', 'ok',
      'compile_db_hash', 'abc123', 'abc123', 'deadbeef',
      JSON.stringify({ definitions: { status: 'ok', count: 1 } }),
      '2026-05-09T12:00:00Z', null
    );
    const row = db.prepare('SELECT * FROM code_intel_collections WHERE collection_id=?').get('ci-1');
    expect(row.provider).toBe('cpp-clangd');
    expect(row.status).toBe('ok');
  });
});
