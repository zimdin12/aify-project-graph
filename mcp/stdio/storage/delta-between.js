// THE JOIN — load two stored digests and compute the delta between them.
//
// ⛔ WHY THIS IS ITS OWN MODULE AND NOT A LINE IN A VERB. Digests are stored by the rebuild and the
// delta is a pure function; until this, nothing put the two together. A producer and a consumer that
// never meet is the defect this repository has recorded five times — most recently
// `graph_explain_diff` writing `diff-overlay.json` for a dashboard highlight that does not exist.
// Both renderers (the agent-facing JSON and the human-facing Before/Delta/After view) call THIS, so
// there is one join rather than two that drift.
//
// ⭐ EVERY REFUSAL REACHES `available`. A renderer branches on one field. A refusal returned as a
// "delta with a caveat" is a refusal the caller can page past, and this project has already shipped
// that shape more than once.
import { readStructuralDigest, listDigestCommits } from './structural-digest-store.js';
import { computeDelta } from './structural-digest.mjs';

const short = (sha) => String(sha ?? '').slice(0, 7);

/** A refusal carries no delta. Handing back numbers beside "I cannot compare these" invites their use. */
function unavailable(reason, fromCommit = null, toCommit = null) {
  return {
    available: false, reason, fromCommit, toCommit, requestedCommit: toCommit, note: null, delta: null,
  };
}

/**
 * The delta between two commits that both have stored digests.
 *
 * @returns {{available: boolean, reason: string|null, fromCommit: string|null, toCommit: string|null, delta: object|null}}
 */
export function deltaBetween(db, { fromCommit, toCommit } = {}) {
  if (!fromCommit || !toCommit) return unavailable('deltaBetween needs both a fromCommit and a toCommit');

  const before = readStructuralDigest(db, fromCommit);
  const after = readStructuralDigest(db, toCommit);

  // ⛔ NAMED, NOT JUST ABSENT. "No digest stored" is the COMMON case — the first index of any
  // repository, and every commit older than the retention bound — so the reader has to say which
  // side is missing or the caller cannot tell a young history from a broken one.
  if (!before && !after) return unavailable(`no digest stored for ${short(fromCommit)} or ${short(toCommit)}`, fromCommit, toCommit);
  if (!before) return unavailable(`no digest stored for ${short(fromCommit)} — nothing to compare against`, fromCommit, toCommit);
  if (!after) return unavailable(`no digest stored for ${short(toCommit)}`, fromCommit, toCommit);

  const delta = computeDelta(before, after);
  // The pure function already refuses across an extractor or digest version boundary. Propagate that
  // into `available` so a renderer cannot show movement the computation declined to attribute.
  if (!delta.comparable) return unavailable(delta.refusal, fromCommit, toCommit);

  return {
    available: true, reason: null, fromCommit, toCommit, requestedCommit: toCommit, note: null, delta,
  };
}

/**
 * "What changed since the last time this repository was indexed" — the question the morning view asks.
 *
 * Picks the most recent stored digest OLDER than `toCommit`. Ordering comes from
 * `listDigestCommits`, so the row a reader sees and the row this picks cannot disagree.
 */
export function deltaFromPrevious(db, { toCommit } = {}) {
  if (!toCommit) return unavailable('deltaFromPrevious needs a toCommit');

  const commits = listDigestCommits(db); // newest first

  // ⛔⛔ HEAD USUALLY HAS NO DIGEST, AND THAT IS THE COMMON CASE — measured live one hour after the
  // capture shipped. `captureStructuralDigest` runs inside the rebuild transaction, so an index that
  // finds the graph already fresh returns early and writes nothing: an ordinary index reported
  // `"indexed": true` and produced no row. Refusing here would make the feature answer "no digest
  // stored" on the exact question the morning view exists to ask.
  //
  // ⇒ Fall back to the newest stored pair, and make the substitution VISIBLE. `toCommit` reports the
  // commit actually compared and `note` says what was asked for instead. A SILENT fallback would
  // answer a different question than the one asked, which is the stand-in this project keeps
  // recording — the point is to be useful without quietly changing the subject.
  let target = toCommit;
  let note = null;
  if (!commits.includes(toCommit)) {
    if (commits.length === 0) return unavailable('no digests are stored yet', null, toCommit);
    target = commits[0];
    note = `no digest stored for ${short(toCommit)}; showing the newest stored comparison instead, `
      + `which ends at ${short(target)}`;
  }

  const at = commits.indexOf(target);

  // ⛔ ONE DIGEST IS NOT A HISTORY. Comparing a digest to itself yields a perfectly clean delta, and
  // on a repository indexed once that would render "nothing changed" forever — indistinguishable
  // from a working feature, which is the worst way for this to fail.
  const previous = commits[at + 1];
  if (!previous) {
    return unavailable(
      `only one digest is stored (${short(target)}), so there is no earlier structure to compare against`,
      null,
      toCommit,
    );
  }

  const result = deltaBetween(db, { fromCommit: previous, toCommit: target });
  // `requestedCommit` is always what the CALLER asked for, even when the pair compared is a
  // substitute, so a renderer can show both without re-deriving either.
  return { ...result, requestedCommit: toCommit, note: result.available ? note : result.note };
}
