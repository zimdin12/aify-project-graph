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


/**
 * `expectFailures` binds the TOTAL number of failing cases, so a malformed one silently changes
 * what the arm is measuring.
 *
 * ⛔ THIS WAS DECLARED OPEN IN `self-review.mjs` AND USED RAW: `const wanted = m.expectFailures ?? 1`
 * compared with `!==`. A string `"1"` would never equal a number, so every arm carrying it would be
 * INVALID for a reason nobody could see in the spec. `1.5` or `-1` are unreachable totals.
 *
 * ⛔⛔ AND ZERO IS THE DANGEROUS ONE. `expectFailures: 0` asks the apparatus to credit an arm where
 * the hostile mutation broke NOTHING — which is the definition of a SURVIVED candidate hole. It
 * would turn the tool's strongest negative signal into a pass.
 */
export function expectFailuresProblems(m, i) {
  if (m?.expectFailures === undefined) return [];          // optional; defaults to 1 at the call site
  const v = m.expectFailures;
  const label = `spec[${i}] "${m?.name || '?'}"`;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return [`${label} has a non-integer expectFailures (${JSON.stringify(v)}) — a total that cannot be compared`];
  }
  if (v < 1) {
    return [`${label} has expectFailures ${v} — a mutation expected to break nothing is a SURVIVED hole, not a witness`];
  }
  return [];
}

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
    problems.push(...expectFailuresProblems(m, i));
  });
  return { loadable: problems.length === 0, problems };
}
