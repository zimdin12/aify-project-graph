// FOUR STATES, AND EVERY UNKNOWN FAILS CLOSED UNDER ITS OWN WORDING.
//
// This is the comparison the whole generation-publication unit collapses to: one integer from the
// database against one integer from the manifest. Three file formats needing their own contract
// became this. It must not quietly widen into a guess.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ATTESTATION, classifyAttestation, readGraphPublication, bumpGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';

describe('classifyAttestation separates four states that look alike from a denial', () => {
  it('POSITIVE CONTROL: matching generations are ATTESTED', () => {
    // Without this the classifier could return a refusal unconditionally and every case below
    // would still pass.
    expect(classifyAttestation({ dbGeneration: 7, manifestGeneration: 7 })).toBe(ATTESTATION.ATTESTED);
  });

  it('⛔ no table is LEGACY — the question cannot be asked of this graph', () => {
    for (const dbGeneration of [null, undefined]) {
      expect(classifyAttestation({ dbGeneration, manifestGeneration: 3 })).toBe(ATTESTATION.LEGACY_UNATTESTED);
    }
  });

  it('⛔ generation 0 is NEVER_COMPLETED, which is NOT legacy', () => {
    // The table exists, so the question WAS asked; the answer is that nothing has ever been
    // published. An empty graph presenting as a real one. Collapsing this into legacy would send a
    // reader to the same remedy for two different problems.
    expect(classifyAttestation({ dbGeneration: 0, manifestGeneration: 0 })).toBe(ATTESTATION.NEVER_COMPLETED);
    expect(classifyAttestation({ dbGeneration: 0, manifestGeneration: 0 }))
      .not.toBe(ATTESTATION.LEGACY_UNATTESTED);
  });

  it('⛔ a database ahead of its manifest is a MISMATCH — the crash window', () => {
    // The rebuild committed and the manifest write never landed. The graph is whole and unattested.
    expect(classifyAttestation({ dbGeneration: 8, manifestGeneration: 7 })).toBe(ATTESTATION.GENERATION_MISMATCH);
  });

  it('⛔ a manifest with NO generation against a real one is a mismatch, not legacy', () => {
    // The database is past the upgrade and the manifest is behind it. Reporting legacy here would
    // describe the graph as older than it is and hide a genuine torn publication.
    for (const manifestGeneration of [null, undefined]) {
      expect(classifyAttestation({ dbGeneration: 4, manifestGeneration }))
        .toBe(ATTESTATION.GENERATION_MISMATCH);
    }
  });

  it('⛔ a non-integer generation is a mismatch, not silently coerced', () => {
    // '7' == 7 in the language and NOT here. A string generation means something upstream wrote a
    // field it did not understand, and comparing loosely would let it pass as attested.
    expect(classifyAttestation({ dbGeneration: '7', manifestGeneration: '7' }))
      .toBe(ATTESTATION.GENERATION_MISMATCH);
  });

  it('called with nothing at all, it refuses rather than throwing', () => {
    expect(classifyAttestation()).toBe(ATTESTATION.LEGACY_UNATTESTED);
  });
});

// ⛔ A SCHEMA ADDITION MUST NOT WITHDRAW AUTHORITY FROM A GRAPH THAT EARNED IT.
//
// Adding unresolved_count / trust_unresolved_count to graph_generation nearly did exactly that.
// readGraphPublication selected all three columns in one statement; on any graph published BEFORE
// the columns existed that throws "no such column", the catch returned null, and an ATTESTED graph
// read as legacy_unattested — absence authority and preflight SAFE withdrawn from a healthy index
// by a migration.
//
// ⭐ EVERY TEST IN THIS FILE PASSED WHILE THAT WAS TRUE, because they all build a fresh database
// with the new columns. It was caught by running against this repository's real graph, which was at
// generation 6 and reported legacy. The fixture could not stand in for the substrate.
describe('a graph published before the aggregate columns is still attested', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apg-oldgen-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // The OLD shape, written out by hand rather than by the current schema — a fixture built from
  // today's code could never reproduce yesterday's database.
  const seedPreAggregateGraph = () => {
    const db = openDb(join(dir, 'graph.sqlite'));
    db.exec('DROP TABLE IF EXISTS graph_generation');
    db.exec(`CREATE TABLE graph_generation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      generation INTEGER NOT NULL,
      committed_at TEXT NOT NULL
    )`);
    db.run("INSERT INTO graph_generation (id, generation, committed_at) VALUES (1, 6, '2026-08-30T22:44:23Z')");
    return db;
  };

  it('⛔ reads ATTESTED with null counts — not legacy, and not zero', () => {
    const db = seedPreAggregateGraph();
    try {
      const pub = readGraphPublication(db);
      expect(pub, 'the table exists, so this is not a legacy graph').not.toBeNull();
      expect(pub.generation, 'the generation it earned must survive the migration').toBe(6);
      expect(pub.counts, 'counts nobody recorded are null — reporting 0 would fabricate a measurement')
        .toBeNull();
      expect(classifyAttestation({ dbGeneration: pub.generation, manifestGeneration: 6 }))
        .toBe(ATTESTATION.ATTESTED);
    } finally { db.close(); }
  });

  it('POSITIVE CONTROL: the current shape reports its committed aggregates', () => {
    // Without this the reader could return null counts unconditionally and the case above would
    // still pass — proving only that it does not crash.
    const db = openDb(join(dir, 'graph.sqlite'));
    try {
      bumpGraphGeneration(db, { unresolvedCount: 36184, trustUnresolvedCount: 42 });
      const pub = readGraphPublication(db);
      expect(pub.counts).toEqual({ unresolved: 36184, trustUnresolved: 42 });
    } finally { db.close(); }
  });

  it('⛔ a partial aggregate is NOT half-reported', () => {
    // One column written and the other null is not "36184 unresolved, unknown trust" — it is a row
    // nobody completed, and splitting it would publish half a measurement as a whole one.
    const db = openDb(join(dir, 'graph.sqlite'));
    try {
      bumpGraphGeneration(db, { unresolvedCount: 36184 });
      expect(readGraphPublication(db).counts).toBeNull();
    } finally { db.close(); }
  });
});
