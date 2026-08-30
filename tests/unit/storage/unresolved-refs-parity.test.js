// JSON -> TABLE -> RESOLVER-INPUT PARITY, AGAINST A CARRIER FROZEN BEFORE THE TABLE EXISTED.
//
// ⛔ WHY THE CARRIER IS FROZEN. `.aify-graph/dirty-edges.full.json` is mutable: the reviewer's census
// read 35,885 rows and mine read 35,906, because the graph reindexed between them. A fixture sourced
// from a live path measures whatever the file says when the test runs, which is not a fixture. The
// copy under docs/evidence/ is byte-pinned by sha256 in carrier-attestation.json.
//
// Two layers, because they prove different things:
//   1. the FULL real carrier proves the migration preserves what this repository actually emits;
//   2. the small adversarial fixture proves the resolver SEAMS this repository never exercises —
//      from_target, to_id and language appear in ZERO of the 35,906 live rows, and population zero
//      is not contract absence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import {
  replaceUnresolvedRefs, readUnresolvedRefs, projectRef, hydrateRef,
  UNRESOLVED_REF_COLUMNS, DERIVED_OR_DROPPED,
} from '../../../mcp/stdio/storage/unresolved-refs.js';

const EVIDENCE = join(process.cwd(), 'docs/evidence/unresolved-refs-migration');
const CARRIER = join(EVIDENCE, 'dirty-edges.full.frozen.json');
const ATTESTATION = join(EVIDENCE, 'carrier-attestation.json');
const FIXTURE = join(process.cwd(), 'tests/fixtures/unresolved-refs/adversarial-shapes.json');

let dir; let db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-refs-'));
  db = openDb(join(dir, 'graph.sqlite'));
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('the frozen carrier is the carrier that was attested', () => {
  it('⛔ byte identity — a changed carrier invalidates every number below it', () => {
    // Without this the parity test silently re-baselines onto whatever the file becomes.
    const attested = JSON.parse(readFileSync(ATTESTATION, 'utf8'));
    const actual = createHash('sha256').update(readFileSync(CARRIER)).digest('hex');
    expect(actual, 'the frozen carrier no longer matches its attestation').toBe(attested.carrier.sha256);
    expect(JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges.length)
      .toBe(attested.carrier.rowCount);
  });
});

describe('every producer field is accounted for, none silently discarded', () => {
  it('⛔ a field that is neither a column nor an explicit drop THROWS', () => {
    // Catches the quiet death of a new producer seam. A field must be a decision.
    expect(() => projectRef({
      relation: 'CALLS', source_file: 'a.js', target: 'x', somethingNew: 1,
    })).toThrow(/unaccounted field\(s\): somethingNew/);
  });

  it('POSITIVE CONTROL: a fully-populated ref projects without throwing', () => {
    // Without this the assertion above is satisfied by a function that rejects everything.
    expect(() => projectRef({
      from_id: 'a', from_target: 'b', to_id: 'c', target: 'd', relation: 'CALLS',
      source_file: 'a.js', source_line: 1, confidence: 0.9, provenance: 'EXTRACTED',
      extractor: 'javascript', language: 'javascript', refusedReason: 'r',
      importMap: { x: { source: 'y' } }, from_label: 'dropped-on-purpose',
    })).not.toThrow();
  });

  it('every key in the live carrier is a column, a rename, or a documented drop', () => {
    // The census the review asked for, run over the real population rather than a sample.
    const rows = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    const emitted = new Set();
    for (const r of rows) for (const k of Object.keys(r)) emitted.add(k);
    const renamed = new Set(['refusedReason', 'importMap']);
    const unaccounted = [...emitted].filter(
      (k) => !UNRESOLVED_REF_COLUMNS.includes(k) && !renamed.has(k) && !(k in DERIVED_OR_DROPPED),
    );
    expect(unaccounted, 'a producer field would vanish in the migration').toEqual([]);
    expect(emitted.has('from_label'), 'and from_label IS present, so the drop is real work').toBe(true);
  });
});

describe('the full frozen carrier survives the round trip', () => {
  it('⭐ all 35,906 rows, with exact duplicate multiplicity and no dedup', () => {
    const attested = JSON.parse(readFileSync(ATTESTATION, 'utf8'));
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;

    replaceUnresolvedRefs(db, original);
    const back = readUnresolvedRefs(db);

    expect(back.length, 'row count must survive exactly — a unique constraint would drop 3,344')
      .toBe(original.length);
    expect(back.length).toBe(attested.carrier.rowCount);

    // ⛔ MULTISET, NOT SET. 2,547 identity keys repeat with multiplicity up to 15. Comparing sets
    // would pass on a migration that deduplicated, which is exactly the accidental migration the
    // surrogate row id exists to prevent.
    const key = (r) => [r.from_id, r.from_target, r.to_id, r.target, r.relation,
      r.source_file, r.source_line].join('');
    const tally = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return m;
    };
    const before = tally(original);
    const after = tally(back);
    expect(after.size).toBe(before.size);
    expect(after.size).toBe(attested.duplicateMultiplicity.distinctIdentityKeys);
    const drift = [...before].filter(([k, n]) => after.get(k) !== n);
    expect(drift, 'every identity key must keep its exact multiplicity').toEqual([]);
  });

  it('⭐ resolver-input parity: values, not just counts', () => {
    // A count can survive while every field is nulled. This compares the hydrated refs field by
    // field against the original, minus the one field deliberately dropped.
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    replaceUnresolvedRefs(db, original);
    const back = readUnresolvedRefs(db);

    const canonical = (r) => {
      const { from_label: _dropped, ...rest } = r;
      // Producer omits keys; the table stores NULL. Compare on PRESENT keys only, which is what
      // resolveRefs sees either way.
      return JSON.stringify(Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)),
      ));
    };
    let mismatch = null;
    for (let i = 0; i < original.length && !mismatch; i += 1) {
      if (canonical(original[i]) !== canonical(back[i])) {
        mismatch = { i, before: canonical(original[i]), after: canonical(back[i]) };
      }
    }
    expect(mismatch, 'a ref changed shape crossing the table').toBeNull();
  });

  it('⛔ typed ABSENCE survives — provenance is missing on 2 rows, not null-defaulted', () => {
    const original = JSON.parse(readFileSync(CARRIER, 'utf8')).dirtyEdges;
    const withoutProvenance = original.filter((r) => !('provenance' in r));
    expect(withoutProvenance.length, 'the carrier still contains the typed-absence case').toBe(2);

    replaceUnresolvedRefs(db, withoutProvenance);
    for (const r of readUnresolvedRefs(db)) {
      expect('provenance' in r, 'a default provenance would manufacture unearned confidence')
        .toBe(false);
    }
  });
});

describe('the adversarial fixture covers the seams the live carrier never exercises', () => {
  const shapes = () => JSON.parse(readFileSync(FIXTURE, 'utf8')).shapes.map((s) => s.ref);

  it('⭐ from_target, to_id and language round-trip — zero live rows carry them', () => {
    const refs = shapes();
    replaceUnresolvedRefs(db, refs);
    const back = readUnresolvedRefs(db);
    expect(back.length).toBe(refs.length);

    expect(back.some((r) => r.from_target === 'MainWindow::onReady'),
      'symbolic source with no from_id').toBe(true);
    expect(back.some((r) => r.to_id === 'ff00ee11dd22cc33bb44aa5566778899aabbccdd'),
      'pre-resolved destination').toBe(true);
    expect(back.some((r) => r.language === 'cpp'), 'language rides the ref').toBe(true);
  });

  it('importMap survives as evidence, not as a display extra', () => {
    replaceUnresolvedRefs(db, shapes());
    const withMap = readUnresolvedRefs(db).find((r) => r.importMap);
    expect(withMap, 'the fixture carries one').toBeTruthy();
    expect(withMap.importMap.fs.source).toBe('node:fs');
  });

  it('the fixture duplicate is preserved, proving no dedup on the small path either', () => {
    const refs = shapes();
    const back = (replaceUnresolvedRefs(db, refs), readUnresolvedRefs(db));
    const readFileSyncRefs = back.filter((r) => r.target === 'readFileSync');
    expect(readFileSyncRefs.length, 'the exact duplicate pair must both survive').toBe(2);
  });
});

describe('a legacy graph is distinguishable from an empty one', () => {
  it('⛔ missing table reads as null, never as "no unresolved refs"', () => {
    // An empty array here would be a claim about the repository. The cosmetic fast path and the
    // trust denominator both key off this, and both must DISABLE rather than guess.
    const raw = openDb(join(dir, 'legacy.sqlite'));
    raw.exec('DROP TABLE IF EXISTS unresolved_refs');
    expect(readUnresolvedRefs(raw)).toBeNull();
    raw.close();
  });

  it('POSITIVE CONTROL: a present-but-empty table reads as []', () => {
    // The two states must not collapse — this is the pair the null above exists to separate.
    replaceUnresolvedRefs(db, []);
    expect(readUnresolvedRefs(db)).toEqual([]);
  });
});

describe('hydrate is the exact inverse of project', () => {
  it('round-trips every column without inventing or losing one', () => {
    const ref = {
      from_id: 'a', from_target: 'b', to_id: 'c', target: 'd', relation: 'CALLS',
      source_file: 'x.cpp', source_line: 7, confidence: 0.42, provenance: 'INFERRED',
      extractor: 'qt', language: 'cpp', refusedReason: 'why',
      importMap: { k: { source: 's' } },
    };
    expect(hydrateRef(projectRef(ref))).toEqual(ref);
  });
});
