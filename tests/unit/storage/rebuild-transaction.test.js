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

  it('releasing a rolled-back savepoint keeps the stack flat across many failures', () => {
    // Catches: ROLLBACK TO without RELEASE. SQLite leaves the savepoint on the stack, so a long run
    // with repeated chunk failures would grow it for the length of the rebuild.
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
