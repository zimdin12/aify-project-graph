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
import { retainedDigest } from '../../helpers/retained-digest.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ⛔ RETAINED BYTES, NOT A CALL TO THE BUILDER. `buildDigest` was retired with the comparison it
// fed; what this file tests is the STORE, and the store must keep reading rows in the format that
// was actually written. The `over` parameter the old factory carried was never once supplied.
const digestFor = (commit) => retainedDigest('renderLoad', commit);

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

  // ⛔ "THE PRODUCER IS WIRED" WAS ASSERTED HERE AND IS NOW DELIBERATELY FALSE.
  //
  // It checked that the rebuild calls `captureStructuralDigest` before its transaction commits — a
  // function itself REMOVED on 2026-09-08, once it was an orphaned producer with no call site — a
  // good assertion against the defect it was written for: a digest store nothing writes to is a
  // delta engine that can never run, and it would stay green forever.
  //
  // The commit-to-commit claim has since been WITHDRAWN. A stored digest cannot be attributed to
  // the source its commit contained — the indexer parses the working tree and carries unchanged
  // rows forward — so the capture stops at the source rather than producing rows whose only purpose
  // would be to look like history.
  //
  // Keeping the assertion would pin a wiring that must not exist. Inverting it to "must NOT be
  // called" would pin an absence while saying nothing about why, and would be satisfied by deleting
  // the module. The withdrawal and its decisive controls live in
  // tests/unit/storage/commit-comparison-is-withdrawn.test.js, which asserts the refusal AND two
  // positive controls — the pure algorithm, and ordinary indexing — so that breaking something
  // unrelated cannot satisfy it.
  //
  // Everything else in this file still holds: writeStructuralDigest, its byte-identical round trip,
  // idempotence per commit and the retention bound are unchanged and still exercised directly.
});
