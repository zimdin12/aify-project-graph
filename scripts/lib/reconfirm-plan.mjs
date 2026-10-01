// Whether ONE anchor may be reconfirmed, and with what baseline. Pure: a resolved anchor in, a decision out.
//
// Reconfirming writes the baseline every later sweep is measured against, and it SETTLES marks. So the only
// question this module answers is: does this provider have something it can honestly vouch for as the new
// baseline? The transport lives in `dashboard-signals-client.mjs`; the per-anchor observation comes from
// `anchor-resolver.mjs`, the SAME function the sweep uses — which is what makes a baseline set here one the
// sweep will later recognise (bounded by the round-trip arm in `reconfirm-plan.test.js`).

/** Why a reconfirm is refused. Each names what is missing, in words an operator can act on. */
export const RECONFIRM_REFUSALS = Object.freeze({
  gone: 'the anchored target is not in the working tree, so there is nothing to take a baseline of — '
    + 'reconfirming would store a stamp that no later sweep can ever compare against',
  unwatched: 'this provider could not vouch for the anchor (see its reason), so it will not write a baseline '
    + 'for it — a baseline is a claim about what was seen, and nothing was seen',
  no_stamp: 'the resolver produced a result without a stamp, so there is no baseline to send',
  no_head: 'the commit the baseline was taken at is unknown, and a stamp without a commit is refused as '
    + '`bad_stamp` by the service because it cannot say what it was taken against',
  not_watched: 'this watchId is not in the current watch set, so it is not an anchor this project watches',
});

/**
 * Decide one anchor's reconfirm.
 *
 * @param resolved the `{ kind, row }` that `resolveAnchor` returned for this anchor
 * @param head     the commit the working tree was read at
 * @returns `{ ok: true, watchId, stamp }` or `{ ok: false, watchId, refusal, reason }`
 */
export function planReconfirm(resolved, { head }) {
  const watchId = resolved?.row?.watchId;
  const refuse = (refusal) => ({ ok: false, watchId, refusal, reason: RECONFIRM_REFUSALS[refusal] });

  // ⛔ `unwatched` FIRST, and without looking inside it. An anchor the resolver declined to answer — a partial
  // parse, a truncated extraction, an unhandled file type — has no observation behind it, whatever the row holds.
  if (resolved?.kind === 'unwatched') return refuse('unwatched');
  if (resolved?.kind !== 'result') return refuse('no_stamp');
  if (resolved.row.status === 'gone') return refuse('gone');

  const stamp = resolved.row.stamp;
  if (typeof stamp?.hash !== 'string' || stamp.hash === ''
    || typeof stamp?.stampVersion !== 'string' || stamp.stampVersion === '') {
    return refuse('no_stamp');
  }
  if (typeof head !== 'string' || head === '') return refuse('no_head');

  // `changed` IS reconfirmable, and it is the point: "the code moved, somebody looked, this is the new
  // baseline" is exactly the act the service's per-anchor settle exists for.
  return { ok: true, watchId, stamp: { hash: stamp.hash, stampVersion: stamp.stampVersion, commit: head } };
}

/**
 * Read the anchors to reconfirm from the command line.
 *
 * ⛔ FAILS CLOSED ON NO ANCHORS. There is no default and no "all": each anchor must be named with `--watch`. A
 * reconfirm that defaulted to every anchor would be a sweep that settles its own marks, which is the one
 * thing the service's design says a provider must never do.
 */
export function parseReconfirmArgs(argv) {
  const watchIds = [];
  let dryRun = false;
  let allowDirty = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--allow-dirty') allowDirty = true;
    else if (argv[i] === '--watch') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
        throw new Error('--watch needs a watchId after it');
      }
      watchIds.push(value);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (watchIds.length === 0) {
    throw new Error('name every anchor to reconfirm with --watch <watchId>; there is deliberately no "all"');
  }
  return { watchIds, dryRun, allowDirty };
}
