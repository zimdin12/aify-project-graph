// ONE OBSERVATION OF ONE GRAPH, NOT TWO CORRECT READS OF TWO DIFFERENT ONES.
//
// ⛔ ATOMIC PUBLICATION DOES NOT CLOSE THIS. Writing the graph and everything describing it in one
// transaction guarantees each read is internally whole. It does not stop a commit landing BETWEEN
// two reads. A reader that asks "is this attested?" and then "what does it contain?" can have the
// check pass against generation N and the data arrive from N+1 — both reads correct, the conclusion
// false, and nothing in the output looking wrong.
//
// ⭐ SO THE TEST HAS TO COMMIT FOR REAL, MID-READ. Asserting that two reads inside one call return
// the same value proves nothing if nothing changed in between: it would pass against a completely
// unpinned connection. Every case here writes and COMMITS from a second connection while the
// snapshot is open, and the negative control shows an unpinned reader seeing that write — which is
// what makes the pinned result evidence rather than a coincidence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, openExistingDb, captureExistingSnapshot } from '../../../mcp/stdio/storage/db.js';
import { bumpGraphGeneration, readGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';

let dir; let dbPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-snapshot-'));
  dbPath = join(dir, 'graph.sqlite');
  const db = openDb(dbPath);
  try {
    bumpGraphGeneration(db);                       // generation 1
    db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('n1', 'File', 'a.js', 'a.js')");
  } finally { db.close(); }
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Commit a new generation plus a new node from a SEPARATE connection. */
function commitNewGeneration() {
  const writer = openDb(dbPath);
  try {
    const tx = writer.raw.transaction(() => {
      writer.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('n2', 'File', 'b.js', 'b.js')");
      bumpGraphGeneration(writer);
    });
    tx();
  } finally { writer.close(); }
}

describe('a pinned read snapshot survives a commit landing mid-read', () => {
  it('⛔ the generation check and the data reads see the SAME graph', () => {
    const observed = captureExistingSnapshot(dbPath, (db) => {
      const generationBefore = readGraphGeneration(db);
      const nodesBefore = db.all('SELECT id FROM nodes').map((r) => r.id);

      // A full rebuild publishes, right here, between the check and the data read.
      commitNewGeneration();

      return {
        generationBefore,
        generationAfter: readGraphGeneration(db),
        nodesBefore,
        nodesAfter: db.all('SELECT id FROM nodes').map((r) => r.id),
      };
    });

    expect(observed.generationBefore).toBe(1);
    expect(observed.generationAfter, 'the generation must not move under a pinned reader').toBe(1);
    expect(observed.nodesBefore).toEqual(['n1']);
    expect(observed.nodesAfter, 'a node committed mid-read must not appear in the same snapshot')
      .toEqual(['n1']);
  });

  it('⭐ NEGATIVE CONTROL: an UNPINNED reader does see the mid-read commit', () => {
    // Without this the test above proves only that nothing changed. This proves the write really
    // lands and really is visible — so the pinned result is isolation, not an inert experiment.
    const db = openExistingDb(dbPath);
    try {
      const before = db.all('SELECT id FROM nodes').map((r) => r.id);
      commitNewGeneration();
      const after = db.all('SELECT id FROM nodes').map((r) => r.id);

      expect(before).toEqual(['n1']);
      expect(after, 'an unpinned connection is exactly where the torn read comes from')
        .toEqual(['n1', 'n2']);
      expect(readGraphGeneration(db)).toBe(2);
    } finally { db.close(); }
  });

  it('the snapshot is released when the callback returns — the next one sees the new graph', () => {
    // A snapshot that outlived its call would pin the WAL open and hand every later reader a
    // frozen graph, which is a worse failure than the one being fixed.
    captureExistingSnapshot(dbPath, (db) => {
      commitNewGeneration();
      return readGraphGeneration(db);
    });
    const after = captureExistingSnapshot(dbPath, (db) => ({
      generation: readGraphGeneration(db),
      nodes: db.all('SELECT id FROM nodes').map((r) => r.id),
    }));
    expect(after.generation).toBe(2);
    expect(after.nodes).toEqual(['n1', 'n2']);
  });

  it('a throwing callback still releases the snapshot', () => {
    expect(() => captureExistingSnapshot(dbPath, () => { throw new Error('boom'); })).toThrow(/boom/);
    // If the failed call had leaked its transaction, this write would block or the read below
    // would be stale.
    commitNewGeneration();
    expect(captureExistingSnapshot(dbPath, (db) => readGraphGeneration(db))).toBe(2);
  });

  it('⛔ the handle is READ-ONLY — a pinned writer would hit SQLITE_BUSY_SNAPSHOT', () => {
    // collect_code_intel.js opens with readonly:false. If this helper ever accepted a writable
    // handle, that caller would start failing under exactly the concurrency it exists to survive.
    expect(() => captureExistingSnapshot(dbPath, (db) => {
      db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('n3', 'File', 'c.js', 'c.js')");
    })).toThrow(/readonly/i);
  });

  it('⛔ the snapshot is pinned BEFORE the callback runs, not at its first read', () => {
    // A deferred BEGIN acquires nothing until something reads. Without an explicit pin the window
    // this helper exists to close stays open for however long the callback spends on non-database
    // work — reading a manifest, awaiting a lock, formatting a response. The commit below happens
    // before the callback's FIRST read, so it is only excluded if the snapshot was already taken.
    const seen = captureExistingSnapshot(dbPath, (db) => {
      commitNewGeneration();
      return db.all('SELECT id FROM nodes').map((r) => r.id);
    });
    expect(seen, 'a commit landing before the first read must still be outside the snapshot')
      .toEqual(['n1']);
  });

  it('⛔ an ASYNC capture callback is REJECTED, not awaited', () => {
    // Reviewer executed the misuse: the finally closes the handle before an async callback resumes,
    // so it failed with "The database connection is not open" — and an async callback that DID work
    // would be worse, holding a WAL read open across git or LSP awaits. Rejecting a thenable makes
    // the WAL-pinning shape unreachable rather than merely discouraged.
    // ⚠ THE CALLBACK MUST NOT TOUCH `db` AFTER ITS AWAIT, and that is not a detail. My first
    // version did — `await Promise.resolve(); return db.get(...)` — and while the rejection below
    // fired correctly, the orphaned async function kept running, reached a handle the finally had
    // already closed, and produced an UNHANDLED REJECTION. Ten tests passed and vitest reported
    // "The database connection is not open" as a loose error attached to nothing.
    //
    // The test proving we reject async callbacks was leaking the exact failure it documents. What
    // is under test is the THENABLE being refused, not what an abandoned promise goes on to do.
    expect(() => captureExistingSnapshot(dbPath, async () => {
      await Promise.resolve();
      return 'never reaches the caller';
    })).toThrow(/must be SYNCHRONOUS/);
  });

  it('⛔ a promise returned WITHOUT async is rejected too — the shape, not the keyword', () => {
    // Catches the version that hand-rolls a promise, which an `instanceof Promise` check would
    // catch but a naive `constructor.name === 'AsyncFunction'` check would not.
    expect(() => captureExistingSnapshot(dbPath, () => Promise.resolve(1)))
      .toThrow(/must be SYNCHRONOUS/);
  });

  it('POSITIVE CONTROL: a synchronous callback returning plain data still works', () => {
    // ⛔ Without this the rejection could be unconditional and every case above would pass while
    // the helper was simply broken.
    expect(captureExistingSnapshot(dbPath, (db) => db.get('SELECT 1 AS x').x)).toBe(1);
  });

  it('the callback return value is passed through', () => {
    expect(captureExistingSnapshot(dbPath, () => 'result')).toBe('result');
  });
});
