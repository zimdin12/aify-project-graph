// THE JOIN: digests are stored and computeDelta exists, but until this nothing put them together.
//
// ⛔ A PRODUCER AND A CONSUMER THAT NEVER MEET IS THE DEFECT THIS SESSION KEEPS FINDING — five
// recorded instances, most recently graph_explain_diff writing diff-overlay.json for a dashboard
// highlight that does not exist. Storing digests and shipping a pure delta function without a reader
// would have been the same shape a third time.
//
// The behaviour that matters here is what happens when there IS no before, because that is the
// common case: the first index of any repository, and every commit older than the retention bound.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensurePublicationTables } from '../../../mcp/stdio/storage/publication-schema.js';
import { writeStructuralDigest } from '../../../mcp/stdio/storage/structural-digest-store.js';
import { deltaBetween, deltaFromPrevious } from '../../../mcp/stdio/storage/delta-between.js';
import { buildDigest } from '../../../mcp/stdio/storage/structural-digest.mjs';

const SHA = (c) => c.repeat(40);

const digestFor = (commit, { extra = [], extractorVersion = '0.5.0' } = {}) => buildDigest({
  commit,
  extractorVersion,
  symbols: [
    { qname: 'render', file: 'ui/render.js', layer: 'ui' },
    { qname: 'load', file: 'data/load.js', layer: 'data' },
    ...extra,
  ],
  edges: [{ from: 'render', to: 'load' }],
});

function dbWith(entries) {
  const db = new Database(':memory:');
  ensurePublicationTables(db);
  for (const [digest, createdAt] of entries) writeStructuralDigest(db, digest, { createdAt });
  return db;
}

describe('joining two stored digests into a delta', () => {
  it('★★★ THE COMMON CASE: no BEFORE means NO DELTA, and it says which side is missing', () => {
    // ⛔ The first index of any repository has nothing to compare against, and so does every commit
    // older than the retention bound. Returning an empty delta here would report "no structural
    // change" for a comparison that never happened — the fail-open direction, because it reassures.
    const db = dbWith([[digestFor(SHA('b')), '2026-09-02T00:00:00.000Z']]);
    const r = deltaBetween(db, { fromCommit: SHA('a'), toCommit: SHA('b') });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/no digest stored for/i);
    expect(r.reason).toContain(SHA('a').slice(0, 7));
    expect(r.delta).toBeNull();
    db.close();
  });

  it('★★★ both present: the delta is computed and names both ends', () => {
    const db = dbWith([
      [digestFor(SHA('a')), '2026-09-01T00:00:00.000Z'],
      [digestFor(SHA('b'), { extra: [{ qname: 'log', file: 'util/log.js', layer: 'util' }] }), '2026-09-02T00:00:00.000Z'],
    ]);
    const r = deltaBetween(db, { fromCommit: SHA('a'), toCommit: SHA('b') });
    expect(r.available).toBe(true);
    expect(r.fromCommit).toBe(SHA('a'));
    expect(r.toCommit).toBe(SHA('b'));
    expect(r.delta.comparable).toBe(true);
    expect(r.delta.symbolsAdded).toEqual(['log']);
    db.close();
  });

  it('★★★ an extractor-version change is UNAVAILABLE, not a delta with a caveat', () => {
    // computeDelta already refuses. The reader must not present a refusal as a result the caller can
    // page past — `available` is the field a renderer branches on, so the refusal has to reach it.
    const db = dbWith([
      [digestFor(SHA('a')), '2026-09-01T00:00:00.000Z'],
      [digestFor(SHA('b'), { extractorVersion: '0.6.0' }), '2026-09-02T00:00:00.000Z'],
    ]);
    const r = deltaBetween(db, { fromCommit: SHA('a'), toCommit: SHA('b') });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/extractor/i);
    db.close();
  });

  it('★★★ deltaFromPrevious answers "what changed since the last index"', () => {
    // The question the morning view actually asks. It must pick the previous STORED digest, not the
    // same one, and not the newest.
    const db = dbWith([
      [digestFor(SHA('a')), '2026-09-01T00:00:00.000Z'],
      [digestFor(SHA('b'), { extra: [{ qname: 'log', file: 'util/log.js', layer: 'util' }] }), '2026-09-02T00:00:00.000Z'],
    ]);
    const r = deltaFromPrevious(db, { toCommit: SHA('b') });
    expect(r.available).toBe(true);
    expect(r.fromCommit).toBe(SHA('a'));
    expect(r.delta.symbolsAdded).toEqual(['log']);
    db.close();
  });

  it('★★★ ONE digest is not a history — deltaFromPrevious refuses rather than comparing to itself', () => {
    // ⛔ Comparing a digest to itself yields a perfectly clean delta. On a repo indexed once that
    // would render "nothing changed" forever, which is indistinguishable from a working feature.
    const db = dbWith([[digestFor(SHA('a')), '2026-09-01T00:00:00.000Z']]);
    const r = deltaFromPrevious(db, { toCommit: SHA('a') });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/only one|no earlier/i);
    expect(r.delta).toBeNull();
    db.close();
  });

  it('★★ an unknown target commit is refused by name', () => {
    const db = dbWith([[digestFor(SHA('a')), '2026-09-01T00:00:00.000Z']]);
    expect(deltaFromPrevious(db, { toCommit: SHA('z') }).available).toBe(false);
    db.close();
  });
});
