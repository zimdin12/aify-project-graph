// IS THE GRAPH STILL CURRENT WITH THE WORKING TREE? A FACT, NOT A DECISION.
//
// ⛔ THIS EXISTS BECAUSE THE COMPARISON WAS WRITTEN INLINE TWICE, BOTH TIMES AS A BOOLEAN:
//
//     const head = await getHeadCommit(repoRoot).catch(() => null);
//     if (manifest?.commit && head && manifest.commit !== head) { ... }
//
// The `&& head &&` term collapses three states into two. When HEAD cannot be read — a directory
// that is not a git checkout, a broken `.git`, git missing from PATH — the predicate is false, and
// at the warning site that means the reader is told NOTHING. Not "currency unknown": silence, at
// the choke point every string-returning verb returns through.
//
// ⚠ THIRD INSTANCE OF ONE SHAPE. `lsp-evidence.js` carried it twice — `stale` as a boolean set from
// two different causes with one hard-coded sentence, which emitted "indexed 8af5aaa, HEAD has
// moved" while HEAD *was* 8af5aaa. Both were repaired the same way: a third state, and a cause the
// renderer can say out loud. This is that repair applied to the third site, and having it in one
// place is what stops a fourth.
//
// ⭐ THE DECISION IS DELIBERATELY NOT HERE. The two callers want different things from the same
// fact: one triggers an auto-reindex, one emits a warning. NOT reindexing on an unknown is
// defensible — do not spend work you cannot justify. Saying NOTHING on an unknown is not. Splitting
// the fact from the decision is what lets those differ on purpose rather than by accident, and it
// is why this returns a state instead of a boolean the caller would have to re-interpret.

/**
 * @param {object}      [input]
 * @param {string|null} [input.indexedCommit] the commit the manifest recorded, or null if unreadable
 * @param {string|null} [input.head]          the working tree's HEAD, or null if unreadable
 * @returns {{ state: 'current'|'stale'|'unknown', reason: string|null }}
 *   current — both sides read, and they match. The ONLY state that licenses silence.
 *   stale   — both sides read, and they differ.
 *   unknown — a side could not be read. Says which, because a reader chasing one needs to know.
 */
export function graphCurrency({ indexedCommit = null, head = null } = {}) {
  // ⚠ THE TWO UNKNOWNS SHARE A STATE AND NOT A REASON. They grant the same thing — nothing can be
  // certified — but they point at different repairs: an unreadable HEAD is an environment problem,
  // a missing indexed commit means the graph never recorded one.
  if (!indexedCommit && !head) {
    return { state: 'unknown', reason: 'neither the indexed commit nor HEAD could be read' };
  }
  if (!head) {
    return { state: 'unknown', reason: 'HEAD could not be read, so the graph may be arbitrarily far behind' };
  }
  if (!indexedCommit) {
    return { state: 'unknown', reason: 'the manifest recorded no indexed commit to compare against' };
  }
  if (indexedCommit !== head) return { state: 'stale', reason: 'the indexed commit is not HEAD' };
  // ⚠ `null` and not an empty string: there is nothing to explain, and an empty reason would render
  // as a dangling clause on any caller that concatenates it without checking.
  return { state: 'current', reason: null };
}
