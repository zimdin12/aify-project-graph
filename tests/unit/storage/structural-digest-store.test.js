// THE DIGEST NEEDS A PRODUCER, OR IT IS THE SAME DEFECT I JUST DOCUMENTED.
//
// ⛔ `buildDigest`/`computeDelta` shipped as pure functions with nothing feeding them. That is
// `quality-of-the-unreachable` inverted: not "built correctly, nothing calls it" but "correct, and
// nothing produces its input". Hours before writing this I recorded that `graph_explain_diff` writes
// `diff-overlay.json` for a dashboard highlight that does not exist. Shipping a delta engine with no
// stored digests would be the same shape with the ends swapped.
//
// ⇒ So these tests cover the round trip AND the wiring. The last two are the ones that would have
// caught the defect: a table nothing registers, and a producer nothing calls.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { ensurePublicationTables } from '../../../mcp/stdio/storage/publication-schema.js';
import {
  writeStructuralDigest, readStructuralDigest, listDigestCommits, DIGEST_RETENTION,
} from '../../../mcp/stdio/storage/structural-digest-store.js';
import { buildDigest, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const digestFor = (commit, over = {}) => buildDigest({
  commit,
  extractorVersion: '0.5.0',
  symbols: [
    { qname: 'render', file: 'ui/render.js', layer: 'ui' },
    { qname: 'load', file: 'data/load.js', layer: 'data' },
  ],
  edges: [{ from: symbolKey('render', 'ui/render.js'), to: symbolKey('load', 'data/load.js'), relation: 'CALLS' }],
  ...over,
});

function freshDb() {
  const db = new Database(':memory:');
  ensurePublicationTables(db);
  return db;
}

describe('digests are stored per commit, append-only', () => {
  it('★★★ THE TABLE IS REGISTERED BY ensurePublicationTables — not created on the side', () => {
    // A table created lazily by its own writer exists only on machines that happened to write one,
    // and a reader on any other machine gets "no such table" rather than "no digest yet". Those are
    // different facts and only one of them is recoverable.
    const db = freshDb();
    const found = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='structural_digest'").get();
    expect(found?.name).toBe('structural_digest');
    db.close();
  });

  it('★★★ round-trips BYTE-IDENTICALLY, because a delta compares serialized digests', () => {
    const db = freshDb();
    const digest = digestFor('a'.repeat(40));
    writeStructuralDigest(db, digest);
    // Mutation already proved that comparing these structurally hides a key-order regression, so the
    // assertion is on the bytes here too.
    expect(JSON.stringify(readStructuralDigest(db, 'a'.repeat(40)))).toBe(JSON.stringify(digest));
    db.close();
  });

  it('★★★ AN ABSENT DIGEST IS null, NEVER AN EMPTY ONE', () => {
    // ⛔ An empty digest would compare cleanly against anything and report "no structural change"
    // for a commit that was never measured. That is the fail-open direction: it reassures.
    const db = freshDb();
    expect(readStructuralDigest(db, 'b'.repeat(40))).toBeNull();
    db.close();
  });

  it('★★ re-indexing the same commit is idempotent — one row, not a duplicate history', () => {
    const db = freshDb();
    const digest = digestFor('c'.repeat(40));
    writeStructuralDigest(db, digest);
    writeStructuralDigest(db, digest);
    expect(listDigestCommits(db)).toEqual(['c'.repeat(40)]);
    db.close();
  });

  it('★★ commits come back newest-first, so "the previous digest" is the next row', () => {
    const db = freshDb();
    writeStructuralDigest(db, digestFor('1'.repeat(40)), { createdAt: '2026-09-01T00:00:00.000Z' });
    writeStructuralDigest(db, digestFor('2'.repeat(40)), { createdAt: '2026-09-02T00:00:00.000Z' });
    expect(listDigestCommits(db)).toEqual(['2'.repeat(40), '1'.repeat(40)]);
    db.close();
  });

  it('★★★ RETENTION IS BOUNDED — measured at 961 KB per digest on this repository', () => {
    // ⛔ FOUND BY MEASURING THE REAL THING, not by review. The first live digest on this repo held
    // 3,220 symbols and 5,382 edges in 961 KB. One row per indexed commit at that size is roughly a
    // gigabyte per thousand commits, on a table whose whole job is to be written on every rebuild.
    // Unbounded growth is a defect with a delay on it.
    //
    // ⚠ PRUNING IS SAFE HERE ONLY BECAUSE A DIGEST IS DERIVED. Re-indexing that commit reproduces it
    // exactly — that is what the determinism test is for. This would not be an acceptable policy for
    // anything that could not be recomputed.
    const db = freshDb();
    for (let i = 0; i < DIGEST_RETENTION + 3; i += 1) {
      writeStructuralDigest(db, digestFor(String(i).padStart(40, '0')), {
        createdAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    const kept = listDigestCommits(db);
    expect(kept.length).toBe(DIGEST_RETENTION);
    // The NEWEST survive. Dropping the newest would leave a history that can never answer
    // "what changed since yesterday", which is the only question this table exists for.
    expect(kept).toContain(String(DIGEST_RETENTION + 2).padStart(40, '0'));
    expect(kept).not.toContain('0'.repeat(40));
    db.close();
  });

  it('★★★ THE PRODUCER IS WIRED — the rebuild writes a digest inside its own transaction', () => {
    // ⛔ THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT THIS MODULE EXISTS TO AVOID. A digest store
    // nothing writes is a delta engine that can never run, and it would stay green forever.
    const orchestrator = read('../../../mcp/stdio/freshness/orchestrator.js');
    // captureStructuralDigest, not writeStructuralDigest: the rebuild hands over the graph it just
    // wrote and the store derives the digest from it. Asserting the wrong name here failed once,
    // which is the assertion doing its job on the property while naming the wrong symbol.
    expect(orchestrator, 'the rebuild must capture a digest').toContain('captureStructuralDigest');
    // It must land BEFORE the commit, or a rollback leaves a digest describing a graph that was
    // never published — the exact "three separate promotion events" failure this file's neighbours
    // were rewritten to remove.
    const at = orchestrator.indexOf('captureStructuralDigest(db,');
    const commitAt = orchestrator.indexOf('rebuildTxn.commit()');
    expect(at, 'captureStructuralDigest must be called').toBeGreaterThan(-1);
    expect(commitAt, 'the rebuild transaction must still commit').toBeGreaterThan(-1);
    expect(at, 'the digest must be written before the transaction commits').toBeLessThan(commitAt);
    // Live control: this search CAN fail, proved by a name the file does not carry.
    expect(orchestrator).not.toContain('captureStructuralDigestZzq');
    expect(orchestrator).toContain('replaceStructuralFingerprints');
  });
});
