// THE GUARD'S DECISIONS, AS FUNCTIONS THAT CAN BE CALLED.
//
// ⛔ WHY THEY LEFT THE CLI. `refactor-guard.mjs` decided PASS / REFUSE / FAIL inline, interleaved
// with `console.error` and `process.exit`, inside a `main()` that ran at import. Nothing could
// execute a decision except by running the whole 61-entry corpus and letting it kill the process.
// **A check that cannot be called cannot be tested**, and this one shipped a false accusation
// against unchanged code that no test could have caught, because no test could reach the branch.
//
// ⛔⛔ AND THEN IT CERTIFIED A CHANGED POPULATION. the reviewer executed this through the
// shipped function:
//
//     baseline results  [A, B]   corpusSize 2
//     current results   [A, A]   length 2        carrier settled, both rows routeExecuted
//     verdict           PASS — "2 of 2 identical", "routes 2/2"
//
// `B` disappeared, `A` was duplicated, and the guard called it unchanged. The Map collapsed the
// duplicate key, the lookup found baseline `A` twice, the size stayed 2, and the aggregate route
// count stayed 2. ⇒ **A COUNT IS NOT A POPULATION** — the same sample-as-population defect this
// project has spent days removing from verbs, sitting at the guard's own corpus boundary.
//
// ⇒ Membership and uniqueness are compared as MULTISETS of a canonical key, and route coverage is
// compared as a SET OF IDENTITIES, before any output is looked at.
import { carrierMovement } from './carrier.mjs';

export const VERDICT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REFUSE: 'REFUSE',
};

/**
 * Refusal reasons, kept distinct because they tell the reader to do DIFFERENT things.
 *
 * ⛔ Collapsing `CARRIER_MIDRUN` into `CARRIER_DRIFT` would send someone to re-baseline into the
 * same non-determinism that just bit them. A refusal that names the wrong remedy is a loop.
 */
export const REFUSAL = {
  CARRIER_MIDRUN: 'carrier moved during the corpus run',
  CARRIER_DRIFT: 'carrier moved between baseline and verify',
  CORPUS_MEMBERSHIP: 'corpus membership changed',
  DUPLICATE_KEYS: 'corpus contains duplicate keys',
  ROUTES_UNREACHED: 'declared routes did not execute exactly once each',
  ALL_THREW: 'every corpus entry threw',
};

/**
 * The canonical identity of a corpus row.
 *
 * ⛔ ONE DEFINITION. The comparison, the duplicate check and the output lookup must all agree on
 * what "the same entry" means, or a row can be identical under one and distinct under another —
 * which is exactly how `[A,B] → [A,A]` passed.
 *
 * `route` is included because two rows may share target+mode while exercising different declared
 * routes; without it a route swap would read as the same entry.
 */
export function corpusKey(r) {
  return `${r.target} [${r.mode}]${r.route ? ` <${r.route}>` : ''}`;
}

/** Keys appearing more than once, each reported with its count. */
export function duplicateKeys(results) {
  const seen = new Map();
  for (const r of results ?? []) {
    const k = corpusKey(r);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
}

/**
 * Multiset difference between two corpus populations.
 *
 * ⚠ ORDER IS DELIBERATELY NOT MEANINGFUL. Two runs may enumerate the same corpus in a different
 * order without any behaviour changing; requiring identical order would refuse valid runs. What
 * must hold is that every key present once on one side is present once on the other.
 */
export function membershipDiff(baselineResults, currentResults) {
  const count = (rows) => {
    const m = new Map();
    for (const r of rows ?? []) m.set(corpusKey(r), (m.get(corpusKey(r)) ?? 0) + 1);
    return m;
  };
  const a = count(baselineResults);
  const b = count(currentResults);
  const missing = [];
  const extra = [];
  for (const [k, n] of a) {
    const m = b.get(k) ?? 0;
    if (m < n) missing.push(n - m === 1 ? k : `${k} (x${n - m})`);
  }
  for (const [k, n] of b) {
    const m = a.get(k) ?? 0;
    if (m < n) extra.push(n - m === 1 ? k : `${k} (x${n - m})`);
  }
  return { missing, extra };
}

/**
 * Which declared routes actually executed, by IDENTITY.
 *
 * ⛔ NOT A COUNT. `routes executed 2/2` was satisfied by running one route twice while another
 * never ran at all. The aggregate is the number that hid the hole.
 */
export function routeCoverage(results, declaredRouteIds) {
  const declared = new Set(declaredRouteIds ?? []);
  const executed = new Map();
  for (const r of results ?? []) {
    if (r.route && r.routeExecuted) executed.set(r.route, (executed.get(r.route) ?? 0) + 1);
  }
  return {
    missing: [...declared].filter((id) => !executed.has(id)),
    undeclared: [...executed.keys()].filter((id) => !declared.has(id)),
    duplicated: [...executed.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`),
  };
}

/**
 * Everything both modes must establish before their result set means anything.
 *
 * ⚠ CLAIM LIMIT on the carrier pair: two equal endpoints prove no ENDPOINT-VISIBLE movement during
 * the window. They cannot exclude an ABA — a move and a restore between the samples. Acceptable
 * here because auto-reindex advances a snapshot and does not revert; NOT acceptable against a
 * hostile writer.
 */
function sharedRefusals({ before, after, results, routeIds }) {
  const midRun = carrierMovement(before, after);
  if (midRun.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CARRIER_MIDRUN,
      detail: midRun.map((k) => `${k}: ${before?.[k]} -> ${after?.[k]} (mid-run)`),
    };
  }

  const dupes = duplicateKeys(results);
  if (dupes.length) {
    return { verdict: VERDICT.REFUSE, reason: REFUSAL.DUPLICATE_KEYS, detail: dupes };
  }

  const routes = routeCoverage(results, routeIds);
  const routeProblems = [
    ...routes.missing.map((id) => `${id}: declared but never executed`),
    ...routes.undeclared.map((id) => `${id}: executed but not declared`),
    ...routes.duplicated.map((d) => `${d}: executed more than once`),
  ];
  if (routeProblems.length) {
    return { verdict: VERDICT.REFUSE, reason: REFUSAL.ROUTES_UNREACHED, detail: routeProblems };
  }

  return null;
}

/**
 * May this baseline be published?
 *
 * ⛔ THE ARTIFACT USED TO BE WRITTEN BEFORE THESE CHECKS RAN. `writeFileSync(ARTIFACT, ...)` came
 * first, then the route-coverage and all-threw refusals. A REFUSED baseline therefore stayed on
 * disk and could be consumed by a later verify — the refusal printed, and the bad artifact
 * survived to certify something.
 */
export function baselineVerdict({ before, after, results, routeIds }) {
  const refusal = sharedRefusals({ before, after, results, routeIds });
  if (refusal) return refusal;

  // A baseline where everything threw would make any later run "match".
  const threw = (results ?? []).filter((r) => r.outcome === 'threw').length;
  if (results?.length && threw === results.length) {
    return { verdict: VERDICT.REFUSE, reason: REFUSAL.ALL_THREW, detail: [`${threw}/${threw} threw`] };
  }

  return { verdict: VERDICT.PASS, detail: [`${results.length} entries`, `routes ${routeIds.length}/${routeIds.length}`] };
}

/**
 * Decide whether a verify run may attribute its outputs to the code.
 *
 * ⛔ ORDER IS LOAD-BEARING. Every refusal is evaluated before any output is compared, because an
 * output difference observed across a moved carrier or a changed population is not evidence about
 * the code — reporting it as a behaviour change is a false accusation.
 */
export function guardVerdict({ baseline, before, after, results, routeIds }) {
  const refusal = sharedRefusals({ before, after, results, routeIds });
  if (refusal) return refusal;

  // The carrier must also not have moved since the baseline was taken.
  //
  // ⛔ THIS BOUNDARY USED TO FAIL OPEN with a handwritten loop whose first conjunct compared
  // `undefined !== undefined`. One predicate, both boundaries.
  const drift = carrierMovement(baseline?.carrier, before);
  if (drift.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CARRIER_DRIFT,
      detail: drift.map((k) => `${k}: baseline ${baseline?.carrier?.[k]} -> now ${before?.[k]}`),
    };
  }

  // A duplicate in the STORED baseline is as disqualifying as one in the current run.
  const baseDupes = duplicateKeys(baseline?.results);
  if (baseDupes.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.DUPLICATE_KEYS,
      detail: baseDupes.map((d) => `baseline: ${d}`),
    };
  }

  // ⛔ MEMBERSHIP, NOT SIZE. `[A,B] -> [A,A]` has the same length and is a different population.
  const { missing, extra } = membershipDiff(baseline?.results, results);
  if (missing.length || extra.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CORPUS_MEMBERSHIP,
      detail: [
        ...missing.map((k) => `missing from this run: ${k}`),
        ...extra.map((k) => `not in the baseline: ${k}`),
      ],
    };
  }

  // Only now may outputs be compared. Membership is established, so every lookup resolves.
  const byKey = new Map((baseline.results ?? []).map((r) => [corpusKey(r), r]));
  const changes = [];
  for (const r of results) {
    const b = byKey.get(corpusKey(r));
    // ⛔ UNREACHABLE BY CONSTRUCTION, AND IT THROWS RATHER THAN SKIPS. Membership and uniqueness
    // are established above, so every key resolves. If that ever stops being true the comparison
    // is over a population nobody checked — which must break loudly, not `continue` past a row.
    if (!b) throw new Error(`invariant violated: ${corpusKey(r)} passed membership but has no baseline row`);
    if (b.outcome !== r.outcome) {
      changes.push(`${corpusKey(r)}: outcome ${b.outcome} -> ${r.outcome}${r.error ? ` (${r.error})` : ''}`);
    } else if (r.outcome === 'ok' && b.sha256 !== r.sha256) {
      changes.push(`${corpusKey(r)}: output changed (${b.bytes} -> ${r.bytes} stable bytes)`);
    } else if (r.outcome === 'ok' && b.volatileLines !== r.volatileLines) {
      // The excluded line disappearing is a behaviour change the exclusion would otherwise hide.
      changes.push(`${corpusKey(r)}: snapshot line count changed (${b.volatileLines} -> ${r.volatileLines})`);
    } else if (r.outcome === 'ok' && !r.volatileShapeOk) {
      changes.push(`${corpusKey(r)}: snapshot line no longer matches its pinned shape`);
    }
  }
  if (changes.length) return { verdict: VERDICT.FAIL, detail: changes };

  return {
    verdict: VERDICT.PASS,
    detail: [`${results.length} of ${results.length} identical`, `routes ${routeIds.length}/${routeIds.length}`],
  };
}
