// ONE TRANSACTION FOR THE WHOLE REBUILD, SO THE GRAPH IS NEVER OBSERVED HALF-BUILT.
//
// The rebuild used to publish its work in pieces: the wipe committed on its own, then the extraction
// loop committed every 500 files. Between those commits the database held a real, readable, wrong
// answer. Measured on a 194-file subject settled at 8,306 edges, a concurrent reader polling every
// 20ms saw [8306, 0, 30, 1594] — 12 of 195 samples reading ZERO — and `graph_callers` rendered a
// caller set of zero. See docs/2026-08-26-the-graph-is-briefly-empty-and-a-verb-will-say-so.md.
//
// ⭐ THE STATE BOUNDARY BELONGS TO SQLITE, NOT TO EVERY READER. Under WAL a reader holds the last
// committed snapshot for the life of its statement, so if the rebuild commits exactly once, readers
// see the complete OLD graph until that moment and the complete NEW graph after it. No marker to
// check, no manifest timing to get right, no caller discipline to enforce across 118 call sites.
//
// ⛔ WHY NOT `db.transaction(fn)`: better-sqlite3 transaction functions are synchronous, and a
// rebuild awaits filesystem sweeps, extraction and LSP work throughout. Transactions are a property
// of the CONNECTION, not of a callback, so the boundary is issued directly and this class owns it.
// Nested `db.transaction()` calls inside the span keep working — better-sqlite3 turns those into
// savepoints automatically once a transaction is already open.
//
// The per-chunk failure isolation the extraction loop depends on is preserved by savepoints:
// `ROLLBACK TO` undoes one chunk without discarding the rebuild, which is exactly what the old
// COMMIT/BEGIN pair bought, minus the publishing.

const CHUNK_SAVEPOINT = 'apg_chunk';

/**
 * States: 'idle' -> 'open' -> 'closed'. A transaction that has closed cannot reopen; the caller
 * makes a new one. Every guard below fails closed, because a silently-ignored commit would publish
 * nothing and a silently-ignored rollback would publish a half-built graph.
 */
export class RebuildTransaction {
  #db;

  #state = 'idle';

  #chunkOpen = false;

  constructor(db) {
    if (!db?.raw?.exec) throw new TypeError('RebuildTransaction needs a wrapped db with a raw handle');
    this.#db = db;
  }

  get isOpen() {
    return this.#state === 'open';
  }

  get hasOpenChunk() {
    return this.#chunkOpen;
  }

  // BEGIN IMMEDIATE, not BEGIN. A deferred transaction takes its write lock at the first write,
  // which means two rebuilds can both begin and only collide later, halfway through their work.
  // Taking the lock up front makes the conflict happen at the start, where it is cheap.
  begin() {
    if (this.#state !== 'idle') throw new Error(`cannot begin a rebuild transaction from state '${this.#state}'`);
    this.#db.raw.exec('BEGIN IMMEDIATE');
    this.#state = 'open';
  }

  beginChunk() {
    this.#require('open', 'beginChunk');
    if (this.#chunkOpen) throw new Error('a chunk savepoint is already open');
    this.#db.raw.exec(`SAVEPOINT ${CHUNK_SAVEPOINT}`);
    this.#chunkOpen = true;
  }

  // Keeps the chunk's rows, still unpublished. The caller may promote its matching JS-side state
  // here: nothing after this point can undo the chunk except an outer rollback, which discards the
  // whole rebuild and writes no manifest.
  commitChunk() {
    this.#require('open', 'commitChunk');
    if (!this.#chunkOpen) throw new Error('no chunk savepoint is open');
    this.#db.raw.exec(`RELEASE ${CHUNK_SAVEPOINT}`);
    this.#chunkOpen = false;
  }

  // Discards this chunk's rows and nothing else.
  //
  // ⚠ THE `RELEASE` IS DEFENSIVE, AND ITS EFFECT IS NOT BEHAVIOURALLY OBSERVABLE — measured. ROLLBACK
  // TO rewinds to the savepoint but leaves it on the stack, so omitting the release lets the stack
  // grow for the length of the run. 5,000 rollbacks without it raised no error and left the data
  // identical, so this is a resource claim, not a correctness one, and no test below can kill a
  // mutant that removes it. Kept because an unbounded stack on a very large rebuild is a cost with
  // no upside, and said plainly rather than dressed up as a guard.
  rollbackChunk() {
    this.#require('open', 'rollbackChunk');
    if (!this.#chunkOpen) throw new Error('no chunk savepoint is open');
    this.#db.raw.exec(`ROLLBACK TO ${CHUNK_SAVEPOINT}`);
    this.#db.raw.exec(`RELEASE ${CHUNK_SAVEPOINT}`);
    this.#chunkOpen = false;
  }

  // The single moment the new graph becomes visible to anyone else.
  commit() {
    this.#require('open', 'commit');
    if (this.#chunkOpen) throw new Error('refusing to commit with a chunk savepoint still open');
    this.#db.raw.exec('COMMIT');
    this.#state = 'closed';
  }

  // Safe to call on an already-closed transaction so it can sit in a `finally` without a state
  // check at every call site. Returns whether it actually unwound anything.
  rollback() {
    if (this.#state !== 'open') return false;
    let failure = null;
    try {
      this.#db.raw.exec('ROLLBACK');
    } catch (err) {
      // A statement error can abort the transaction on its own, in which case ROLLBACK throws
      // because there is nothing left to unwind — that is success, not failure.
      failure = err;
    }
    // ⛔ DO NOT CALL THIS FAIL-CLOSED WITHOUT ASKING SQLITE. The first version swallowed every
    // ROLLBACK error and marked the object closed regardless, so a transaction that was STILL OPEN
    // would be reported as unwound — the object's own state lying about the database's. `inTransaction`
    // is the authority here; the exception is not, because the commonest exception means the
    // transaction had already ended.
    const stillOpen = this.#db.raw.inTransaction === true;
    this.#chunkOpen = false;
    if (stillOpen) {
      // Leave state 'open' so a caller cannot mistake this for a clean unwind, and surface the cause.
      throw failure ?? new Error('ROLLBACK did not end the transaction; it is still open');
    }
    this.#state = 'closed';
    return true;
  }

  #require(state, action) {
    if (this.#state !== state) throw new Error(`cannot ${action} from state '${this.#state}'`);
  }
}
