import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { getCodeIntelEvidenceForSymbol } from '../../../mcp/stdio/code-intel/query.js';

// A repo accumulates one row per collection run. getCodeIntelEvidenceForSymbol had no collection
// filter and no recency order, so a symbol touched by two runs returned BOTH generations merged
// with nothing saying so. Measured on APG 2026-08-25: 1,170 of 7,082 symbols (16.5%).

let dir;
let db;

function seedCollection(id, collectedAt) {
  db.run(
    `INSERT INTO code_intel_collections (collection_id, provider, provider_version, project_root, language, status, collected_at)
     VALUES ($id, 'test', '1.0.0', '/tmp/repo', 'typescript', 'ok', $at)`,
    { id, at: collectedAt },
  );
}

function seedRecord(collectionId, { qname, file, kind = 'reference', line }) {
  db.run(
    `INSERT INTO code_intel_records (collection_id, kind, language, qname, file, range_start_line, range_end_line, provenance, raw)
     VALUES ($c, $k, 'typescript', $q, $f, $l, $l, 'LSP_VERIFIED', $raw)`,
    { c: collectionId, k: kind, q: qname, f: file, l: line,
      // `range` is read from the raw JSON, not the columns — the fixture has to store it the way
      // a real record does, or it constructs a world the code never sees.
      raw: JSON.stringify({ range: { start: { line, character: 0 }, end: { line, character: 1 } } }) },
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-supersede-'));
  db = openDb(path.join(dir, 'graph.sqlite'));
  seedCollection('older', '2026-08-20T12:00:00.000Z');
  seedCollection('newer', '2026-08-22T05:00:00.000Z');
});
afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('getCodeIntelEvidenceForSymbol — supersession by file', () => {
  it('drops the older generation for a file collected twice, and DISCLOSES the drop', () => {
    seedRecord('older', { qname: 'doThing', file: 'src/a.ts', line: 10 });
    seedRecord('newer', { qname: 'doThing', file: 'src/a.ts', line: 42 });

    const ev = getCodeIntelEvidenceForSymbol(db, { qname: 'doThing' });
    expect(ev.references).toHaveLength(1);
    expect(ev.references[0].range.start.line).toBe(42);   // the current one
    expect(ev.supersededDropped).toBe(1);                 // and it says so
    expect(ev.spannedCollections).toBe(2);
  });

  it('⛔ NEVER empties a file whose newest evidence lives in the OLDER collection', () => {
    // The load-bearing case. A partial re-collection is normal here — the newest run on APG
    // covered 73 files of 632. Filtering to the single newest collection globally would delete
    // every record for a file it did not touch, turning STALE evidence into ABSENT evidence and
    // manufacturing the confident-empty-result defect this whole release removes.
    seedRecord('older', { qname: 'untouched', file: 'src/old-only.ts', line: 7 });
    seedRecord('newer', { qname: 'untouched', file: 'src/fresh.ts', line: 9 });

    const ev = getCodeIntelEvidenceForSymbol(db, { qname: 'untouched' });
    expect(ev.references).toHaveLength(2);        // both files survive
    expect(ev.supersededDropped).toBe(0);
    const files = ev.references.map((r) => r.file).sort();
    expect(files).toEqual(['src/fresh.ts', 'src/old-only.ts']);
  });

  it('⭐ leaves a single-generation symbol untouched — the guard can say NO', () => {
    // A filter that fires on everything is not a filter. This is the negative control.
    seedRecord('newer', { qname: 'clean', file: 'src/a.ts', line: 1 });
    seedRecord('newer', { qname: 'clean', file: 'src/b.ts', line: 2 });

    const ev = getCodeIntelEvidenceForSymbol(db, { qname: 'clean' });
    expect(ev.references).toHaveLength(2);
    expect(ev.supersededDropped).toBe(0);
    expect(ev.spannedCollections).toBe(1);
  });

  it('supersedes definitions and hovers by the same rule, not references only', () => {
    seedRecord('older', { qname: 'multi', file: 'src/a.ts', kind: 'definition', line: 3 });
    seedRecord('newer', { qname: 'multi', file: 'src/a.ts', kind: 'definition', line: 30 });
    seedRecord('older', { qname: 'multi', file: 'src/a.ts', kind: 'hover', line: 3 });
    seedRecord('newer', { qname: 'multi', file: 'src/a.ts', kind: 'hover', line: 30 });

    const ev = getCodeIntelEvidenceForSymbol(db, { qname: 'multi' });
    expect(ev.definitions).toHaveLength(1);
    expect(ev.hovers).toHaveLength(1);
    expect(ev.supersededDropped).toBe(2);
  });

  it('returns a clean empty for an unknown symbol — the probe can still say ABSENT', () => {
    seedRecord('newer', { qname: 'present', file: 'src/a.ts', line: 1 });
    const ev = getCodeIntelEvidenceForSymbol(db, { qname: '__zzz_not_a_real_symbol__' });
    expect(ev.found).toBe(false);
    expect(ev.references).toHaveLength(0);
  });
});
