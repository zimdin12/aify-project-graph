// APPEND A WHOLE ARRAY WITHOUT TURNING IT INTO AN ARGUMENT LIST.
//
// ⛔ THE CRASH THIS EXISTS TO PREVENT, MEASURED. `target.push(...source)` passes every element as a
// separate ARGUMENT, so it is bounded by the engine's argument limit rather than by memory:
//
//     max spread-into-push, node v22.20.0, this machine:  125217
//
// Past that it throws `RangeError: Maximum call stack size exceeded` — a message that names the
// stack and says nothing about the array, which is why this reads as a runaway recursion when it is
// nothing of the kind. Indexing `reference/graphify` (332 source files) hit it in
// orchestrator.commitPending and the whole index died.
//
// ⚠ AND THE LIMIT IS NOT A CONSTANT. It is what is left of the stack at that call site, so it moves
// with call depth, engine version and platform. A repo that indexes today can fail after an
// unrelated refactor adds two frames. There is no threshold to check against and no "small enough"
// that stays small — which is why the fix is structural rather than a size guard.
//
// ⇒ Use this wherever the source array's length scales with the CORPUS. A spread over something
// provably small — a handful of warning lines, one node's named children — is fine and clearer.

// Chosen well below the measured 125217 so the margin survives a deeper stack, a different engine
// and a platform with a smaller default. The cost of a smaller batch is one extra call per 8k
// elements, which is not measurable next to the file I/O these call sites are already doing.
const BATCH = 8192;

/**
 * Append every element of `source` to `target`, in order, mutating `target`.
 *
 * @param {Array} target  the array to append to
 * @param {Iterable} source  the elements to append; may be any length
 * @returns {Array} target, for chaining
 */
export function appendAll(target, source) {
  if (source == null) return target;
  // Not an array (a Set, a generator, a NodeList): materialise once rather than pushing one at a
  // time, so the common array case keeps the fast batched path below.
  const items = Array.isArray(source) ? source : [...source];
  // ⛔ The single-batch shortcut still goes through push.apply, so it carries the same argument
  // limit — it is only taken when the length is known to be under it.
  if (items.length <= BATCH) {
    target.push(...items);
    return target;
  }
  for (let i = 0; i < items.length; i += BATCH) {
    target.push(...items.slice(i, i + BATCH));
  }
  return target;
}
