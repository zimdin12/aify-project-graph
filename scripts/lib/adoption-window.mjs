// THE PREREGISTERED MEASUREMENT WINDOW, IN ONE PLACE, SO IT CANNOT BE RETYPED DIFFERENTLY.
//
// Every value here is fixed by docs/evidence/m5-scale/PREREGISTERED-did-the-routing-fix-move-
// subagent-adoption.md, written before the outcome could be seen. A test asserts that document
// still names these exact values, so changing one here and not there fails rather than drifts.
//
// ⛔ WHY THIS FILE EXISTS AT ALL, 2026-09-05. The gate condition — how many independent post-fix
// transcripts exist — was being carried in prose, in a loop prompt, with no record of the command
// that produced it. It read 16 for two cycles. Two independent instruments then read 5, and no
// combination of filters, cutoffs or mtime-versus-timestamp reproduces 16. The number that decides
// when a measurement may be read was held nowhere that could contradict me.

/** Fixed 2026-09-04, before the outcome existed. Changing any field voids the preregistration. */
export const ADOPTION_WINDOW = Object.freeze({
  // The transcript's OWN first timestamp, never the file mtime: a session already open when the
  // fix landed keeps being appended to, so mtime admits exactly what the cutoff excludes.
  since: '2026-09-03T20:04:28.335Z',
  // Where my own instrumentation lives. The probes I spawn to verify a routing fix call the graph
  // because I told them to; counting them measures my own prompt.
  excludeProject: 'C--Docker-aify-project-graph',
  // The opening prompt names the tool. Deliberately over-broad: over-exclusion can only lower a
  // measured adoption rate, so it can never manufacture the success being tested for.
  excludeInstructed: true,
  // n = 100, reject at k >= 2. Chosen for 80% power against a 10x improvement, stated in advance.
  gateN: 100,
});

/** The exact argument list the preregistration specifies. Derived, so nobody assembles it by hand. */
export function counterArgsFor(transcriptsRoot, window = ADOPTION_WINDOW) {
  const args = [transcriptsRoot, `--since=${window.since}`, `--exclude-project=${window.excludeProject}`];
  if (window.excludeInstructed) args.push('--exclude-instructed');
  return args;
}

/**
 * Compare a new reading of n against the last recorded one.
 *
 * ⭐ THE MOVEMENT THAT MATTERS IS DOWNWARD. Under a fixed cutoff and a growing corpus, n cannot
 * shrink: a transcript that was in the window stays in it. A drop therefore means the corpus was
 * deleted, or the instrument changed, or the previous row was never a reading of this noun. All
 * three void the gate, and none of them announces itself.
 *
 * @param {number|null} previous last recorded n, or null if this is the first reading
 * @param {number} current
 * @param {number} gateN
 */
export function classifyReading(previous, current, gateN = ADOPTION_WINDOW.gateN) {
  if (!Number.isInteger(current) || current < 0) {
    throw new TypeError(`classifyReading: current must be a non-negative integer, got ${String(current)}`);
  }
  if (previous !== null && (!Number.isInteger(previous) || previous < 0)) {
    throw new TypeError(`classifyReading: previous must be a non-negative integer or null, got ${String(previous)}`);
  }
  const movement = previous === null ? 'first'
    : current > previous ? 'grew'
      : current === previous ? 'unchanged'
        : 'shrank';
  const reachedGate = current >= gateN;
  return {
    movement,
    reachedGate,
    // A shrink invalidates the series, so reaching the gate on a shrunk count licenses nothing.
    verdictAllowed: reachedGate && movement !== 'shrank',
  };
}
