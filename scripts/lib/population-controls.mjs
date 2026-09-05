// A CONTROL BELONGS TO THE POPULATION IT VOUCHES FOR, AND MINE DID NOT.
//
// ⛔ THE DEFECT, MEASURED 2026-09-05. `measure-verb-adoption.mjs` counts two populations and is
// emphatic that they must never be merged: TOP-LEVEL sessions, and NESTED subagent sidechains. The
// preregistered adoption measurement reads its `n` from the NESTED population. But the positive
// control it published was summed over the TOP-LEVEL tallies only.
//
// In the measurement window that is not a detail. Top-level sessions in window: 0. Nested
// transcripts in window: 6, carrying 255 Bash/Read/Grep tool calls between them. So the control
// reported `0 ... FAILS` while the population it was supposed to vouch for was busy and visible.
//
// ⭐ AND THE FAILURE WAS WRITTEN DOWN AS CORRECT. The preregistration records "[POSITIVE CONTROL]
// ... 0 <- FAILS, correctly", reasoning that an empty population records no tool calls. The
// population was not empty. The control was pointed at a different one. Same arithmetic, wrong
// noun — which is the error this repo has recorded more often than any other.
//
// ⚠ WHY IT MATTERS LATER RATHER THAN NOW: the verdict gate says no verdict is rendered unless the
// positive control passes in the same run. Left alone, that gate could never open, because the
// control could not fire on the population being measured however long the corpus grew.
//
// ⭐ AND 0 OF 0 IS NOT A PASS. An empty population cannot demonstrate that an instrument works, so
// its control is UNDECIDED rather than passing. A vacuous true certified a wired gate's own failure
// in this repo once already; here it is made unconstructible by giving `passed` three states.

/** The three states a control can be in. `null` means undecided, never "fine". */
export const CONTROL_UNDECIDED = null;

/**
 * Grade one population's controls.
 *
 * @param {{population: number, positive: number, negative: number}} counts
 *   population — transcripts ADMITTED into this population (after every window filter)
 *   positive   — occurrences of a tool that must appear if the parser sees tool calls at all
 *   negative   — occurrences of a name that cannot exist; anything but 0 means the matcher is
 *                matching text rather than tool_use blocks
 * @returns {{population: number, positive: {count: number, passed: boolean|null},
 *            negative: {count: number, passed: boolean}, vouches: boolean}}
 */
export function gradeControls({ population, positive, negative }) {
  for (const [name, value] of [['population', population], ['positive', positive], ['negative', negative]]) {
    // Guards fail closed: a missing count is not a zero, it is a broken caller.
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`gradeControls: ${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
  const positivePassed = population === 0 ? CONTROL_UNDECIDED : positive > 0;
  const negativePassed = negative === 0;
  return {
    population,
    positive: { count: positive, passed: positivePassed },
    negative: { count: negative, passed: negativePassed },
    // ⭐ THE ONLY STATE THAT LICENSES A CLAIM ABOUT THIS POPULATION. Undecided does not vouch.
    vouches: positivePassed === true && negativePassed,
  };
}

/**
 * Whether a run's controls permit publishing anything at all.
 *
 * A population that was measured must have vouched. A population that was empty is neither a pass
 * nor a failure — but a run in which EVERY population was empty measured nothing, and reporting
 * that as a clean result is how "0 of 27" got published from a rebuild window.
 *
 * @param {Array<ReturnType<typeof gradeControls>>} graded
 * @returns {{ok: boolean, why: string}}
 */
export function runIsPublishable(graded) {
  if (graded.length === 0) return { ok: false, why: 'no populations were graded' };
  const broken = graded.filter((g) => g.positive.passed === false || g.negative.passed === false);
  if (broken.length > 0) {
    return { ok: false, why: `${broken.length} population(s) failed a control that could fire` };
  }
  if (graded.every((g) => g.population === 0)) {
    return { ok: false, why: 'every population was empty — nothing was measured, which is not a result' };
  }
  return { ok: true, why: 'every non-empty population vouched for itself' };
}
