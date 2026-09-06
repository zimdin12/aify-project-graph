// WAS THE TREE STILL FOR THE WHOLE RUN? Pure: no git, no fs, no clock.
//
// ⛔ WHY THIS EXISTS, 2026-09-06. `run-suite.mjs` refuses to START on a tracked-dirty tree, which is
// a real door, and it guards the ENTRY ONLY. Nothing re-checked during a run that takes about eleven
// minutes, so a run could begin at one commit and finish against a tree three commits and eight
// files later — and still print `verdict is for commit <the old one>`.
//
// Measured, on this repository: that log was on its way to being committed as evidence about a
// commit it had never seen. `VITEST_EXIT=1`, five failures, of which four did not reproduce in
// isolation and one was real.
//
// ⭐ A VOID RUN IS WORSE THAN A MISSING ONE. A missing run tells you nothing. A void one hides a
// genuine finding inside artifacts, and its verdict reads afterwards as an attested fact.

/**
 * @param {object} args
 * @param {string} args.headAtStart  HEAD when the run began, or 'unknown'
 * @param {string} args.headAtEnd    HEAD when it finished, or 'unknown'
 * @param {string[]|null} args.dirtyAtEnd  tracked-dirty paths at the end, null if unreadable
 * @param {string[]} [args.expectedWrites] paths the run writes BY DESIGN, which do not void it
 * @returns {{valid: boolean, reason: string|null}}
 */
export function classifyRunIntegrity({
  headAtStart, headAtEnd, dirtyAtEnd, expectedWrites = [],
} = {}) {
  const short = (s) => String(s ?? '').slice(0, 7);

  // ⛔ UNKNOWN FAILS CLOSED. If git could not be read at either end, the run is not thereby clean —
  // it is unattestable, and a verdict is an attested fact. Every other gate in this repository
  // treats unknown as a denial and this one matches them.
  if (!headAtStart || headAtStart === 'unknown' || !headAtEnd || headAtEnd === 'unknown') {
    return { valid: false, reason: 'could not read HEAD at both ends of the run, so the verdict cannot be attributed to a commit' };
  }
  if (!Array.isArray(dirtyAtEnd)) {
    return { valid: false, reason: 'could not read the working tree at the end of the run' };
  }

  // The failure that actually happened: commits landed while the suite was executing.
  if (headAtStart !== headAtEnd) {
    return {
      valid: false,
      reason: `HEAD moved during the run (${short(headAtStart)} -> ${short(headAtEnd)}), `
        + 'so this verdict names a commit it did not measure',
    };
  }

  // ⛔ THE RUN'S OWN OUTPUT IS NOT EVIDENCE THE TREE MOVED. `run-suite` copies the finished log to a
  // TRACKED path and only then reads the end state, so that file is ALWAYS dirty at this moment.
  // Without this exemption the guard would void every single run — and a guard that fires on
  // everything is worse than none, because it teaches the reader to skip it.
  //
  // ⚠ Only the named paths are forgiven. Anything changing alongside them still voids, or the
  // exemption becomes a hole wide enough to hide the original defect in.
  const unexpected = dirtyAtEnd.filter((f) => !expectedWrites.includes(f));
  if (unexpected.length > 0) {
    return {
      valid: false,
      reason: `${unexpected.length} tracked file(s) changed during the run (${unexpected.slice(0, 5).join(', ')}`
        + `${unexpected.length > 5 ? ', …' : ''}), so the suite did not measure one fixed tree`,
    };
  }

  return { valid: true, reason: null };
}
