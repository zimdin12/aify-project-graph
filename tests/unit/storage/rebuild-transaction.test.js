// THE INVARIANT: A REBUILD PUBLISHES ONCE, OR NOT AT ALL.
//
// Every assertion below observes from a SECOND CONNECTION, because "did the writer's own handle see
// its own write" is not the question — the question is what everyone else sees while a rebuild is
// running. That is the property a torn read violated: measured on a 194-file subject, a concurrent
// reader saw [8306, 0, 30, 1594] with 12 of 195 samples reading zero, and graph_callers rendered a
// caller set of zero. See docs/2026-08-26-the-graph-is-briefly-empty-and-a-verb-will-say-so.md.
//
// These run in milliseconds and test the actual mechanism, which is why the runtime marker that used
// to guard this was removed rather than kept: it was measured unobservable (364 samples of a real
// rebuild, never once set), and a guard that cannot fire is decoration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { RebuildTransaction } from '../../../mcp/stdio/storage/rebuild-transaction.js';

let dir; let dbPath; let writer;
const nodeCount = () => {
  const reader = openExistingDb(dbPath);
  try { return reader.all('SELECT COUNT(*) AS n FROM nodes')[0].n; } finally { reader.close(); }
};
const visibleIds = () => {
  const reader = openExistingDb(dbPath);
  try { return reader.all('SELECT id FROM nodes ORDER BY id').map((r) => r.id); } finally { reader.close(); }
};
const seed = (id) => writer.run(
  `INSERT INTO nodes (id, type, label, file_path) VALUES ($id, 'Function', $id, 'a.js')`, { id },
);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-txn-'));
  dbPath = join(dir, 'graph.sqlite');
  writer = openDb(dbPath);
  seed('before-1');
});
afterEach(() => {
  try { writer.close(); } catch { /* a test may have closed it */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('an open rebuild transaction publishes nothing', () => {
  it('a reader on another connection keeps seeing the OLD graph until the commit', () => {
    // Catches the original defect directly: work becoming visible before the rebuild finishes.
    expect(nodeCount(), 'POSITIVE CONTROL: the reader can see rows at all').toBe(1);

    const txn = new RebuildTransaction(writer);
    txn.begin();
    writer.exec('DELETE FROM nodes');           // the wipe that used to autocommit
    seed('after-1');
    seed('after-2');

    expect(visibleIds(), 'mid-rebuild reads must show the previous graph, never the half-built one')
      .toEqual(['before-1']);

    txn.commit();
    expect(nodeCount(), 'and the whole new graph appears at once').toBe(2);
  });

  it('a rollback leaves the previous graph exactly as it was', () => {
    // Catches: a failed rebuild destroying the old graph. Before the outer transaction, a rebuild
    // that threw after the wipe left the repository with no graph at all.
    const txn = new RebuildTransaction(writer);
    txn.begin();
    writer.exec('DELETE FROM nodes');
    seed('doomed');
    expect(txn.rollback(), 'rollback should report that it unwound something').toBe(true);
    expect(nodeCount(), 'the old graph must survive a failed rebuild').toBe(1);
  });
});

describe('chunk savepoints isolate a failure without publishing', () => {
  it('a rolled-back chunk drops its own rows and keeps the rest, still unpublished', () => {
    const txn = new RebuildTransaction(writer);
    txn.begin();
    writer.exec('DELETE FROM nodes');
    txn.beginChunk();
    seed('chunk-1-kept');
    txn.commitChunk();

    // ⛔ ASSERT IDENTITY, NOT COUNT. A count of 1 is true in BOTH worlds here — one old node if the
    // chunk stayed private, one new node if it published — so counting let a mutant that turned
    // commitChunk into a real COMMIT pass untouched. What separates the two worlds is WHICH node an
    // outside reader can see.
    expect(visibleIds(), 'a released chunk must NOT become visible outside the transaction')
      .toEqual(['before-1']);

    txn.beginChunk();
    seed('chunk-2-lost');
    txn.rollbackChunk();

    expect(visibleIds(), 'and a rolled-back chunk is not visible either').toEqual(['before-1']);

    txn.commit();
    expect(visibleIds(), 'only the surviving chunk lands, all at once').toEqual(['chunk-1-kept']);
  });

  it('survives many consecutive chunk failures and still commits the survivor', () => {
    // ⚠ NAMED FOR WHAT IT ACTUALLY CHECKS. An earlier name claimed this kept the savepoint stack
    // flat, which it never measured: 5,000 rollbacks with no RELEASE raise no error and leave the
    // data identical, so removing the RELEASE is a mutant no test here can kill. What this does
    // check is that repeated chunk failures leave the transaction usable and the survivor lands.
    const txn = new RebuildTransaction(writer);
    txn.begin();
    for (let i = 0; i < 50; i += 1) {
      txn.beginChunk();
      seed(`fails-${i}`);
      txn.rollbackChunk();
    }
    expect(txn.hasOpenChunk).toBe(false);
    txn.beginChunk();
    seed('survivor');
    txn.commitChunk();
    txn.commit();
    expect(nodeCount()).toBe(2);
  });
});

describe('the state machine fails closed', () => {
  it('refuses to commit with a chunk still open', () => {
    // Catches: an early return inside the extraction loop committing a partial chunk.
    const txn = new RebuildTransaction(writer);
    txn.begin();
    txn.beginChunk();
    expect(() => txn.commit()).toThrow(/chunk savepoint still open/);
    txn.rollbackChunk();
    txn.commit();
  });

  it('refuses to begin twice, or to commit what was never begun', () => {
    const txn = new RebuildTransaction(writer);
    expect(() => txn.commit()).toThrow(/from state 'idle'/);
    txn.begin();
    expect(() => txn.begin()).toThrow(/from state 'open'/);
    txn.commit();
    expect(() => txn.commit()).toThrow(/from state 'closed'/);
  });

  it('rollback after commit is a no-op, so it is safe in a finally', () => {
    // Catches: a post-commit failure path discarding a graph that was already published.
    const txn = new RebuildTransaction(writer);
    txn.begin();
    seed('published');
    txn.commit();
    expect(txn.rollback(), 'nothing left to unwind').toBe(false);
    expect(nodeCount(), 'the committed graph must survive a stray rollback').toBe(2);
  });
});

describe('the transaction takes its write lock up front', () => {
  it('makes a second writer fail at BEGIN, not after it has done work', () => {
    // Catches: plain `BEGIN` instead of `BEGIN IMMEDIATE`. A deferred transaction takes its write
    // lock at the first write, so two rebuilds can both begin and only collide later, halfway
    // through their work. Measured difference: with IMMEDIATE the second writer is refused at BEGIN;
    // deferred, it begins happily and is refused at the first insert.
    const second = openDb(dbPath);
    second.raw.pragma('busy_timeout = 0');
    const txn = new RebuildTransaction(writer);
    txn.begin();
    // ⛔ DO NOT WRITE FIRST. An earlier version seeded a row here, and that write takes the lock on
    // its own — so the second writer was refused whichever BEGIN the first had used, and the mutant
    // survived. The whole difference lives in the window BEFORE the first write.

    let failedAtBegin = false;
    try { second.raw.exec('BEGIN IMMEDIATE'); } catch { failedAtBegin = true; }
    expect(failedAtBegin, 'the conflict must surface at BEGIN, before the second run does any work')
      .toBe(true);

    try { second.raw.exec('ROLLBACK'); } catch { /* never began */ }
    second.close();
    seed('holder');
    txn.commit();
    expect(nodeCount()).toBe(2);
  });
});

// ⛔ THE OBJECT'S STATE MUST NOT LIE ABOUT THE DATABASE'S.
// rollback() used to swallow every ROLLBACK error and mark itself closed regardless, so a
// transaction that was still open would be reported as cleanly unwound. `inTransaction` is the
// authority; the exception is not, because the commonest exception means the transaction had
// already ended on its own.
describe('rollback reports what actually happened', () => {
  it('a normal rollback ends the transaction and says so', () => {
    const txn = new RebuildTransaction(writer);
    txn.begin();
    seed('doomed');
    expect(txn.rollback()).toBe(true);
    expect(writer.raw.inTransaction, 'and SQLite agrees it ended').toBe(false);
  });

  it('treats an already-aborted transaction as unwound, not as a failure', () => {
    // A statement error can abort the transaction on its own; ROLLBACK then throws because there is
    // nothing left to unwind. That is success, and the old code was right about this case.
    const txn = new RebuildTransaction(writer);
    txn.begin();
    writer.raw.exec('ROLLBACK');            // ended out from under the object
    expect(() => txn.rollback()).not.toThrow();
    expect(writer.raw.inTransaction).toBe(false);
  });

  it('POSITIVE CONTROL: rollback after commit is still a no-op', () => {
    const txn = new RebuildTransaction(writer);
    txn.begin();
    seed('published');
    txn.commit();
    expect(txn.rollback()).toBe(false);
  });
});
