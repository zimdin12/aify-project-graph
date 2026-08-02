// ★ THE HOP THAT ALREADY FAILED ONCE.
//
// ef-manager caught a scope claim that was one hop wider than the test behind it.
// The discrimination test seeds the COLLECTION ROW directly, so it verifies
// collection-row → reader → surfacing. The step it skips is the importer turning
// per-record `cause` values into refs_degraded / refs_clean_not_found — and that
// is precisely the step that failed before: "the evidence is CAPTURED AND NOT
// AGGREGATED; it reaches the DB and dies one layer below the number everyone
// reads."
//
// Checked, and the gap was real: refs_degraded read `sess.refsDegradedSymbols ??
// null` and nothing else. A collection whose RECORDS carry cause but whose session
// predates the counters wrote NULL — the original defect, still live, one layer up,
// inside the region that had just been described as covered.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';

function notFound(i, { cause = null } = {}) {
  return {
    schema_version: '0.2', collectionId: 'agg1', kind: 'reference', language: 'cpp',
    symbolId: `c:cpp:f.cpp:${i}:1`, qname: `ns::sym${i}`,
    confidence: 'low', provenance: 'cpp-clangd@0.1.0',
    result_state: 'not_found_after_retry',
    ...(cause ? { cause, degraded: true } : {}),
  };
}

function envelope(records, session = {}) {
  return {
    schema_version: '0.2', collectionId: 'agg1', provider: 'cpp-clangd', providerVersion: '0.1.0',
    projectRoot: '/tmp/x', language: 'cpp', status: 'ok', operations: ['references'],
    collectedAt: '2026-08-02T00:00:00Z', records, session,
  };
}

function runImport(records, session) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-agg-'));
  const db = openDb(join(dir, 'graph.sqlite'));
  try {
    importV02Collection(envelope(records, session), db);
    return db.get('SELECT refs_degraded, refs_clean_not_found FROM code_intel_collections WHERE collection_id = $c', { c: 'agg1' });
  } finally {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

describe('★ the importer aggregates cause into the collection row', () => {
  it('derives the split from records when the session carries no counters', () => {
    // Exactly the shape that wrote NULL before: records have cause, session does not
    // have the counters (a collect from a build that predates them).
    const recs = [
      ...Array.from({ length: 7 }, (_, i) => notFound(i, { cause: 'definition_only' })),
      ...Array.from({ length: 3 }, (_, i) => notFound(100 + i)), // genuine clean absences
    ];
    const row = runImport(recs, {});
    expect(row.refs_degraded).toBe(7);
    expect(row.refs_clean_not_found).toBe(3);
  });

  it('prefers the session counters when the provider supplied them', () => {
    // The session counts symbols the provider EXAMINED, which can legitimately
    // exceed what it chose to record. It wins when present.
    const recs = Array.from({ length: 4 }, (_, i) => notFound(i, { cause: 'definition_only' }));
    const row = runImport(recs, { refsDegradedSymbols: 40, refsCleanNotFoundSymbols: 2 });
    expect(row.refs_degraded).toBe(40);
    expect(row.refs_clean_not_found).toBe(2);
  });

  it('★ leaves the split NULL when there are no not-found records at all', () => {
    // The arm that must not fire: an absent split and a measured zero are
    // different claims, and collapsing them rebuilds the defect one level up.
    const row = runImport([], {});
    expect(row.refs_degraded).toBeNull();
    expect(row.refs_clean_not_found).toBeNull();
  });

  it('counts a record as degraded on `cause` alone, not only on the boolean', () => {
    // degraded and cause are written together today, but a record carrying a cause
    // with no boolean is still a degraded result — do not require both.
    const row = runImport([{ ...notFound(1), cause: 'no_index_entry' }], {});
    expect(row.refs_degraded).toBe(1);
    expect(row.refs_clean_not_found).toBe(0);
  });
});
