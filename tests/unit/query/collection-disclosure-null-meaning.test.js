import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// ⛔ `filesProcessedLatestCollection: null` MEANT TWO DIFFERENT THINGS.
//
// the field test, field-testing v0.7.0 on echoes: "filesProcessedLatestCollection null and
// filesInScopeLatestCollection null. A per-collection disclosure that reads null tells a reader
// nothing about whether supersession ran."
//
// `latest.filesProcessed ?? null` collapses "this collection predates the column, so nothing was
// ever stored" into the same `null` a reader takes as "nothing was processed" — while a
// collection that genuinely processed nothing stores a real 0. BOTH occur: three collections in
// the APG graph store 0, and echoes' older collection stores nothing at all.
//
// ⚠ These tests do NOT drive graph_health end to end — that needs a full graph fixture. They pin
// the DISTINCTION AT ITS SOURCE: the two states must be separable in the stored row, because a
// disclosure can only report a difference the data still carries. If they ever became
// indistinguishable in storage, no amount of reporting could recover it.

let dir;
let db;

function seed(collectionId, { filesProcessed, collectedAt }) {
  const cols = ['collection_id', 'provider', 'provider_version', 'project_root', 'language', 'status', 'collected_at'];
  const vals = ['$id', "'test'", "'1.0.0'", "'/tmp/r'", "'typescript'", "'ok'", '$at'];
  const params = { id: collectionId, at: collectedAt };
  if (filesProcessed !== undefined) { cols.push('files_processed'); vals.push('$fp'); params.fp = filesProcessed; }
  db.run(`INSERT INTO code_intel_collections (${cols.join(',')}) VALUES (${vals.join(',')})`, params);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-disc-'));
  db = openDb(path.join(dir, 'graph.sqlite'));
});
afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('collection disclosure — a stored 0 and an unrecorded value must stay distinguishable', () => {
  it('⭐ a collection that processed ZERO files stores 0, not null', () => {
    seed('zero', { filesProcessed: 0, collectedAt: '2026-08-20T12:33:03.000Z' });
    const row = db.get('SELECT files_processed FROM code_intel_collections WHERE collection_id=$id', { id: 'zero' });
    expect(row.files_processed).toBe(0);
    expect(row.files_processed).not.toBeNull();
  });

  it('⭐ a collection predating the column stores NULL — a different state', () => {
    seed('old', { collectedAt: '2026-08-02T22:28:48.000Z' });   // column omitted entirely
    const row = db.get('SELECT files_processed FROM code_intel_collections WHERE collection_id=$id', { id: 'old' });
    expect(row.files_processed).toBeNull();
  });

  it('⛔ the two are NOT equal — the distinction a reader needs still exists in storage', () => {
    // The load-bearing assertion. `0 ?? null` is 0 and `undefined ?? null` is null, so the
    // reporting layer CAN tell them apart — but only while the storage layer keeps them apart.
    seed('zero', { filesProcessed: 0, collectedAt: '2026-08-20T12:33:03.000Z' });
    seed('old', { collectedAt: '2026-08-02T22:28:48.000Z' });
    const zero = db.get('SELECT files_processed AS fp FROM code_intel_collections WHERE collection_id=$id', { id: 'zero' });
    const old = db.get('SELECT files_processed AS fp FROM code_intel_collections WHERE collection_id=$id', { id: 'old' });
    expect(zero.fp).not.toBe(old.fp);
    // And the coalesce a reporter applies must preserve it rather than flatten both to null.
    expect(zero.fp ?? null).toBe(0);
    expect(old.fp ?? null).toBeNull();
  });

  it('a real count is preserved unchanged — the guard must not rewrite good data', () => {
    seed('real', { filesProcessed: 73, collectedAt: '2026-08-22T05:10:46.000Z' });
    const row = db.get('SELECT files_processed FROM code_intel_collections WHERE collection_id=$id', { id: 'real' });
    expect(row.files_processed).toBe(73);
  });
});
