// Answer one call claimed from the dashboard's request queue. PURE: the resolver is passed in, nothing is read here.
//
// The calls and their shapes were agreed with dashboard-manager on 2026-10-01 against aify-dashboard 36b6217, whose
// PROVIDER_CALLS are resolve, stamp and subgraph. `signals` left the queue: sweeps are the one signal path.
//
// ⛔ AN ANSWER IS EITHER `ok` WITH PROVENANCE OR A REFUSAL WITH A PROBLEM. Never a bare empty list: "asked, and the
// answer is nothing" must be told apart from "could not ask", and the service refuses an ok answer that does not
// say who computed it and how much they saw.

/** How every answer here was computed, in this provider's own words. */
const HOW = 'apg tree-sitter extraction of the commit (git show), not a full build';

/** The calls answered here. Anything else is refused by name rather than guessed at. */
const ANSWERERS = Object.freeze({
  stamp: (anchors, outcomes, head) => ({ stamps: anchors.map((anchor, i) => stampEntry(anchor, outcomes[i], head)) }),
  resolve: (anchors, outcomes) => ({ results: anchors.map((anchor, i) => resolveEntry(anchor, outcomes[i])) }),
});

/** Calls the queue may carry that this provider deliberately does not answer yet, with the words it says. */
const NOT_YET = Object.freeze({
  subgraph: 'subgraph is not supported by this provider yet',
});

/**
 * @param request     { call, args } as claimed
 * @param resolveItem (item) => the anchor resolver's verdict for { watchId, anchor, stamp }
 * @param head        the commit everything was read at
 * @returns {{ ok: true, value, provenance } | { ok: false, problem, provenance }}
 */
export function answerRequest({ request, resolveItem, head }) {
  const provenance = { providerCommit: head, exhaustive: false, provenance: HOW };
  const call = request?.call;
  if (Object.hasOwn(NOT_YET, call)) return { ok: false, problem: NOT_YET[call], provenance };
  if (!Object.hasOwn(ANSWERERS, call)) {
    return { ok: false, problem: `${JSON.stringify(call)} is not a call this provider answers (it answers: ${Object.keys(ANSWERERS).join(', ')})`, provenance };
  }
  const anchors = request?.args?.anchors;
  const problem = anchorsProblem(anchors);
  if (problem !== null) return { ok: false, problem, provenance };

  // A null stamp: these calls ask what is there now, never compare it with a baseline.
  const outcomes = anchors.map((anchor, i) => resolveItem({ watchId: `request-${i}`, anchor, stamp: null }));
  return { ok: true, value: ANSWERERS[call](anchors, outcomes, head), provenance };
}

/** Why `anchors` cannot be answered, or null. An empty list is a question with nothing in it, so it is refused too. */
function anchorsProblem(anchors) {
  if (!Array.isArray(anchors)) return 'args.anchors must be a list of anchors';
  if (anchors.length === 0) return 'args.anchors is empty: there is nothing to answer';
  const bad = anchors.findIndex((a) => a === null || typeof a !== 'object' || Array.isArray(a));
  if (bad !== -1) return `args.anchors[${bad}] is not an anchor object`;
  return null;
}

function stampEntry(anchor, outcome, head) {
  if (outcome.kind === 'unwatched') return { anchor, refused: outcome.row.reasonCode, reason: outcome.row.reason };
  const { row } = outcome;
  if (row.status === 'gone') return { anchor, refused: 'gone', reason: row.evidence };
  // With a null stamp the resolver's only other answer is `restamp`, the first look at this anchor.
  if (row.status !== 'restamp' || !row.stamp) {
    return { anchor, refused: 'unexpected_status', reason: `the resolver answered ${row.status} for a first look` };
  }
  return { anchor, stamp: { hash: row.stamp.hash, stampVersion: row.stamp.stampVersion, commit: head } };
}

function resolveEntry(anchor, outcome) {
  if (outcome.kind === 'unwatched') {
    if (outcome.row.reasonCode === 'ambiguous_anchor') return { anchor, status: 'ambiguous', candidates: outcome.candidates };
    return { anchor, status: 'unwatched', reasonCode: outcome.row.reasonCode };
  }
  return { anchor, status: outcome.row.status === 'gone' ? 'gone' : 'found' };
}
