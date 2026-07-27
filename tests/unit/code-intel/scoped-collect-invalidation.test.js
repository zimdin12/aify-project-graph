// DATA-LOSS REGRESSION (field report, HIGH severity).
//
// A one-file collect requesting ONLY symbols+diagnostics returned status:"ok" —
// it did succeed at what it was asked — and the importer read that as "this is a
// complete, globally authoritative snapshot". It then deleted EVERY LSP_VERIFIED
// edge in the repo: 5961 verified edges -> 0, destroying ~30 minutes of
// full-collect work in seconds, while reporting status:"ok", importFailed:false.
// The documented inner-loop workflow (collect after touching a file) walks
// straight into it.
//
// Rule: a collection may only invalidate edge classes it had the authority to
// observe. CALLS edges come from the `references` operation.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';

function seedVerifiedEdge(db) {
  const node = (id, label, file) => db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id,'Function',$label,$file,1,2,'cpp',1,'{}')`, { id, label, file });
  node('caller', 'caller_fn', 'sim/A.cpp');
  node('callee', 'callee_fn', 'sim/B.cpp');
  db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('caller','callee','CALLS','sim/A.cpp',10,0.95,'LSP_VERIFIED','cpp-clangd#deadbeef')`);
}

const verifiedCount = (db) =>
  db.get("SELECT COUNT(*) AS c FROM edges WHERE provenance='LSP_VERIFIED'").c;

describe('scoped collect must not wipe the trust spine', () => {
  let dir; let db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-scoped-'));
    db = openDb(join(dir, 'graph.sqlite'));
    seedVerifiedEdge(db);
  });
  afterEach(() => { try { db.close(); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('a symbols+diagnostics collect does NOT invalidate CALLS edges', () => {
    expect(verifiedCount(db)).toBe(1);

    const stats = importV02Collection({
      schema_version: '0.2',
      collectionId: 'c1',
      status: 'ok',                       // it DID succeed at what it was asked
      language: 'cpp',
      projectRoot: dir,
      providerVersion: '0.1.0',
      provider: 'cpp-clangd',
      session: { collectedAt: new Date().toISOString() },
      operations: {                       // ...but never looked at references
        symbols: { status: 'ok', count: 1 },
        diagnostics: { status: 'ok', count: 0 },
      },
      records: [],
    }, db);

    // The spine survives, and the skip is reported rather than silent.
    expect(verifiedCount(db)).toBe(1);
    expect(stats.edgesInvalidated).toBe(0);
    expect(stats.invalidationSkipped).toMatch(/no authority over CALLS/i);
  });

  it('a collect that DID gather references retains its invalidation authority', () => {
    expect(verifiedCount(db)).toBe(1);

    importV02Collection({
      schema_version: '0.2',
      collectionId: 'c2',
      status: 'ok',
      language: 'cpp',
      projectRoot: dir,
      providerVersion: '0.1.0',
      provider: 'cpp-clangd',
      session: { collectedAt: new Date().toISOString() },
      operations: { references: { status: 'ok', count: 0 } },
      records: [],
    }, db);

    // References WERE collected and returned none, so the stale verified edge is
    // legitimately dropped — the guard must not over-correct into never pruning.
    expect(verifiedCount(db)).toBe(0);
  });
});
