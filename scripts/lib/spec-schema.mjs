// ⛔ THE v3 SPEC CONTRACT, AS A FUNCTION THAT CAN BE CALLED.
//
// `self-review.mjs` validated specs inline, then `process.exit(2)`. Nothing could ask "is this file
// runnable?" without launching the whole apparatus and having it kill the process — which is why
// **0 of 35 declared specs were unloadable for nine days with no signal.**
//
// ⇒ Same lesson as `lib/carrier.mjs` and `lib/anchor.mjs`: a check that cannot be called cannot be
// tested, and a check that cannot be tested is a check nobody has watched fail.
//
// ⚠ THIS IS SCHEMA LOADABILITY ONLY. It says the apparatus would ACCEPT the file. It says nothing
// about the anchor resolving, the mutation landing, the route being reached, or a predicted red —
// each of those is a separate rung and none of them follows from this one.

/** Fields v3 requires of every declaration. `case` and `expect` were optional in v2. */
export const REQUIRED_V3_FIELDS = ['name', 'file', 'from', 'to', 'tests', 'case', 'expect'];

/**
 * Would `self-review.mjs` load this spec?
 *
 * Mirrors the loader's own rule: a field is missing if falsy, or an empty array.
 *
 * @returns {{loadable: boolean, problems: string[]}}
 */
export function validateV3Spec(entries) {
  const problems = [];
  if (!Array.isArray(entries)) {
    return { loadable: false, problems: ['spec is not an array of declarations'] };
  }
  if (entries.length === 0) {
    return { loadable: false, problems: ['spec declares no witnesses'] };
  }
  entries.forEach((m, i) => {
    for (const k of REQUIRED_V3_FIELDS) {
      if (!m?.[k] || (Array.isArray(m[k]) && !m[k].length)) {
        problems.push(`spec[${i}] "${m?.name || '?'}" is missing required field "${k}"`);
      }
    }
  });
  return { loadable: problems.length === 0, problems };
}
