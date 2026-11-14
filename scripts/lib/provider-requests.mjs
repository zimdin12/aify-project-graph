// Answer one call claimed from the dashboard's request queue. PURE: the resolver is passed in, nothing is read here.
//
// The calls and their shapes were agreed with dashboard-manager on 2026-10-01 against aify-dashboard 36b6217, whose
// PROVIDER_CALLS are resolve, stamp and subgraph. `signals` left the queue: sweeps are the one signal path. subgraph's
// shape was agreed on 2026-10-17 and lives in provider-subgraph.mjs.
//
// ⛔ AN ANSWER IS EITHER `ok` WITH PROVENANCE OR A REFUSAL WITH A PROBLEM. Never a bare empty list: "asked, and the
// answer is nothing" must be told apart from "could not ask", and the service refuses an ok answer that does not
// say who computed it and how much they saw.

import { parseSubgraphArgs, SUBGRAPH_HOW } from './provider-subgraph.mjs';
import { LOOKUP_CALLS, parseLookupArgs, LOOKUP_HOW } from './provider-lookups.mjs';
import { LIVE_CALLS, parseLiveArgs, LIVE_HOW } from './provider-live.mjs';
import { repoRelativeProblem } from './provider-paths.mjs';

/**
 * The answer format, published in docs/schemas/provider-answer.v1.schema.json (#1). Every ok value carries it, so a
 * reader can refuse a shape it does not know instead of reading it as this one. Bump it, and the schema, when a value
 * changes meaning or loses a field.
 */
export const PROVIDER_FORMAT_VERSION = 1;

/** How stamp and resolve were computed, in this provider's own words. */
const HOW = 'apg tree-sitter extraction of the commit (git show), not a full build';

/**
 * The calls answered here, each ({ args, deps, head }) => { ok, value | problem, how }. Anything else is refused by
 * name rather than guessed at, and the refusal lists these names, so a call added here is listed without a second edit.
 */
const CALLS = Object.freeze({
  stamp: ({ args, deps, head }) => byAnchor(args, deps, (anchors, outcomes) => (
    { stamps: anchors.map((anchor, i) => stampEntry(anchor, outcomes[i], head)) })),
  resolve: ({ args, deps }) => byAnchor(args, deps, (anchors, outcomes) => (
    { results: anchors.map((anchor, i) => resolveEntry(anchor, outcomes[i])) })),
  subgraph: ({ args, deps }) => byRead(parseSubgraphArgs(args), deps.readSubgraph, SUBGRAPH_HOW),
  ...Object.fromEntries(LOOKUP_CALLS.map((call) => [call, ({ args, deps }) =>
    byRead(parseLookupArgs(call, args), deps.readLookup && ((parsed) => deps.readLookup(call, parsed)), LOOKUP_HOW)])),
  ...Object.fromEntries(LIVE_CALLS.map((call) => [call, ({ args, deps }) =>
    byRead(parseLiveArgs(args), deps.readLive && ((parsed) => deps.readLive(call, parsed)), LIVE_HOW)])),
});

export const PROVIDER_CALLS = Object.freeze(Object.keys(CALLS));

/** Parse before touching a reader. Readers may be async, but all answers share one completion path. */
function byRead(parsed, reader, how) {
  if (!parsed.ok) return readerAnswer(parsed, how);
  if (typeof reader !== 'function') return readerAnswer({ ok: false, problem: 'this provider has no reader for the call', reasonCode: 'reader_unavailable' }, how);
  const failed = (error) => readerAnswer({ ok: false, problem: `the reader could not answer: ${error?.message ?? String(error)}`, reasonCode: 'reader_failed' }, how);
  try {
    const read = reader(parsed.value);
    return typeof read?.then === 'function' ? read.then((result) => readerAnswer(result, how)).catch(failed) : readerAnswer(read, how);
  } catch (error) { return failed(error); }
}

function readerAnswer(read, how) {
  if (read.ok) return { ok: true, value: read.value, how };
  const value = read.reasonCode ? { reasonCode: read.reasonCode } : undefined;
  for (const key of ['enable', 'candidates', 'matched', 'truncated']) {
    if (value && read[key] !== undefined) value[key] = read[key];
  }
  return { ok: false, problem: read.problem, ...(value ? { value } : {}), how };
}

/**
 * @param request      { call, args } as claimed
 * @param resolveItem  (item) => the anchor resolver's verdict for { watchId, anchor, stamp }
 * @param readSubgraph (parsedArgs) => provider-subgraph.mjs readSubgraph for this repository at `head`
 * @param readLookup   (call, parsedArgs) => a synchronous graph lookup
 * @param readLive     (call, parsedArgs) => a promise of a working-tree LSP answer
 * @param head         repository HEAD; graph and live answers disclose their distinct observation basis
 * @returns An answer envelope, or a promise of one for a live reader. Existing synchronous calls stay synchronous.
 */
export function answerRequest({ request, resolveItem, readSubgraph, readLookup, readLive, head }) {
  const call = request?.call;
  if (!Object.hasOwn(CALLS, call)) {
    return {
      ok: false,
      problem: `${JSON.stringify(call)} is not a call this provider answers (it answers: ${Object.keys(CALLS).join(', ')})`,
      provenance: provenanceOf(HOW, head),
    };
  }
  const answer = CALLS[call]({ args: request?.args, deps: { resolveItem, readSubgraph, readLookup, readLive }, head });
  const finish = ({ how, ...result }) => {
    const versioned = result.value === undefined ? result : { ...result, value: { formatVersion: PROVIDER_FORMAT_VERSION, ...result.value } };
    return { ...versioned, provenance: provenanceOf(how, head) };
  };
  return typeof answer?.then === 'function' ? answer.then(finish) : finish(answer);
}

const provenanceOf = (how, head) => ({ providerCommit: head, exhaustive: false, provenance: how });

/** stamp and resolve: validate the anchor list, ask the resolver about each, and shape the answer. */
function byAnchor(args, { resolveItem }, shape) {
  const anchors = args?.anchors;
  const problem = anchorsProblem(anchors);
  if (problem !== null) return { ok: false, problem, how: HOW };
  // A null stamp: these calls ask what is there now, never compare it with a baseline.
  const outcomes = anchors.map((anchor, i) => resolveItem({ watchId: `request-${i}`, anchor, stamp: null }));
  return { ok: true, value: shape(anchors, outcomes), how: HOW };
}

/** Why `anchors` cannot be answered, or null. An empty list is a question with nothing in it, so it is refused too. */
function anchorsProblem(anchors) {
  if (!Array.isArray(anchors)) return 'args.anchors must be a list of anchors';
  if (anchors.length === 0) return 'args.anchors is empty: there is nothing to answer';
  const bad = anchors.findIndex((a) => a === null || typeof a !== 'object' || Array.isArray(a));
  if (bad !== -1) return `args.anchors[${bad}] is not an anchor object`;
  const unsafe = anchors.findIndex((a) => typeof a.path === 'string' && repoRelativeProblem(a.path) !== null);
  if (unsafe !== -1) return `args.anchors[${unsafe}].path must be repository-relative`;
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
