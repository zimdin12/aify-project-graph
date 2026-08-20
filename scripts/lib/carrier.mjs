// THE CARRIER: everything a verb's output depends on that is NOT the code under test.
//
// ⛔⛔ WHY THIS IS ITS OWN MODULE. `refactor-guard.mjs` reported **"BEHAVIOUR CHANGED on 7 of 61
// corpus entries"** on a byte-identical working tree (2026-08-21) — `git status --porcelain` empty,
// `diff -q` confirming the file identical, no commit in between. Three further runs of the same
// unchanged code gave two REFUSALs and one PASS. Three verdicts, one tree.
//
// The comparison that should have caught it lived inside a CLI script whose `main()` runs on
// import, so nothing could exercise it except by running the whole corpus. **A check that cannot be
// called cannot be tested, and this one was wrong for weeks.**
//
// ⇒ The predicate is a pure function in its own module: two carriers in, the moved keys out.

/**
 * The fields that make two runs comparable.
 *
 * ⛔ ONE LIST. Two copies would eventually disagree, and the weaker one would be the one deciding
 * whether a receipt binds.
 *
 * ⚠ `workingTreeDirty` is deliberately ABSENT: it changes on every edit of the work being guarded,
 * so treating it as movement would refuse every real slice. `graphBytes` is absent because
 * `graphSha256` already covers the same object more strictly — a size check would miss a
 * same-size edit.
 */
export const CARRIER_KEYS = ['graphSha256', 'indexedCommit', 'nodes', 'edges'];

/**
 * Which carrier fields differ between two samples. Empty means comparable.
 *
 * ⛔ A MISSING FIELD IS MOVEMENT, NOT AGREEMENT. If a sample lacks `graphSha256` because the graph
 * was absent, `undefined === undefined` would report "did not move" and let the run certify itself
 * against nothing. Guards fail closed: a key absent from either side counts as moved.
 */
export function carrierMovement(before, after) {
  const a = before ?? {};
  const b = after ?? {};
  return CARRIER_KEYS.filter((k) => {
    const missing = !(k in a) || !(k in b) || a[k] == null || b[k] == null;
    return missing || a[k] !== b[k];
  });
}
