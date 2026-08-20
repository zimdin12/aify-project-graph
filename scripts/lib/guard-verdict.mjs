// THE VERIFY DECISION, AS A FUNCTION THAT CAN BE CALLED.
//
// ⛔ WHY IT LEFT THE CLI. `refactor-guard.mjs` decided PASS / REFUSE / FAIL inline, interleaved with
// `console.error` and `process.exit`, inside a `main()` that runs at import. Nothing could execute
// the decision except by running the whole 61-entry corpus and letting it kill the process.
//
// **A check that cannot be called cannot be tested**, and this one shipped a false accusation
// against unchanged code (see `lib/carrier.mjs`) that no test could have caught, because no test
// could reach the branch.
//
// ⇒ Context object in, result object out. The CLI keeps printing and exiting; the DECISION is
// here, where a test can hand it a settled carrier and a changed output and demand a FAIL.
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
  CORPUS_SIZE: 'corpus size changed',
  ROUTES_UNREACHED: 'declared routes did not execute',
};

const describe = (r) => `${r.target} [${r.mode}]`;

/**
 * Decide whether a verify run may attribute its outputs to the code.
 *
 * @param {object} ctx
 * @param {object} ctx.baseline   the stored baseline artifact ({carrier, corpusSize, results})
 * @param {object} ctx.before     carrier sampled BEFORE the corpus ran
 * @param {object} ctx.after      carrier sampled AFTER the corpus ran
 * @param {Array}  ctx.results    this run's corpus results
 * @param {number} ctx.routeCount how many routes are declared
 * @returns {{verdict: string, reason?: string, detail: string[]}}
 *
 * ⛔ ORDER IS LOAD-BEARING. Every refusal is evaluated before any output is compared, because an
 * output difference observed across a moved carrier is not evidence about the code — reporting it
 * as a behaviour change is a false accusation, which is strictly worse than saying nothing.
 */
export function guardVerdict({ baseline, before, after, results, routeCount }) {
  // 1. Did the carrier move DURING this run? Two endpoint samples, both must agree.
  //
  // ⚠ CLAIM LIMIT, and it is a real one: two equal endpoints prove no ENDPOINT-VISIBLE movement
  // during the window. They cannot exclude an ABA — a move and a restore between the samples.
  // Acceptable here because the mechanism (auto-reindex advancing a snapshot) is not adversarial
  // and does not revert; it would NOT be acceptable against a hostile writer.
  const midRun = carrierMovement(before, after);
  if (midRun.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CARRIER_MIDRUN,
      detail: midRun.map((k) => `${k}: ${before?.[k]} -> ${after?.[k]} (mid-run)`),
    };
  }

  // 2. Did the carrier move since the baseline? Same fail-closed predicate, both boundaries.
  //
  // ⛔ THIS BOUNDARY USED TO FAIL OPEN with a handwritten loop whose first conjunct compared
  // `undefined !== undefined`. Baseline missing `edges` + current carrying `edges:2` reported NO
  // drift. One predicate, both boundaries — a second copy is a second thing to get wrong.
  const drift = carrierMovement(baseline?.carrier, before);
  if (drift.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CARRIER_DRIFT,
      detail: drift.map((k) => `${k}: baseline ${baseline?.carrier?.[k]} -> now ${before?.[k]}`),
    };
  }

  // 3. Same population, or the comparison is between two different things.
  if (baseline?.corpusSize !== results.length) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.CORPUS_SIZE,
      detail: [`${baseline?.corpusSize} -> ${results.length}`],
    };
  }

  // 4. Only now may outputs be compared.
  const byKey = new Map((baseline.results ?? []).map((r) => [describe(r), r]));
  const changes = [];
  for (const r of results) {
    const b = byKey.get(describe(r));
    if (!b) { changes.push(`${describe(r)}: NEW entry absent from baseline`); continue; }
    if (b.outcome !== r.outcome) {
      changes.push(`${describe(r)}: outcome ${b.outcome} -> ${r.outcome}${r.error ? ` (${r.error})` : ''}`);
    } else if (r.outcome === 'ok' && b.sha256 !== r.sha256) {
      changes.push(`${describe(r)}: output changed (${b.bytes} -> ${r.bytes} stable bytes)`);
    } else if (r.outcome === 'ok' && b.volatileLines !== r.volatileLines) {
      // The excluded line disappearing is a behaviour change the exclusion would otherwise hide.
      changes.push(`${describe(r)}: snapshot line count changed (${b.volatileLines} -> ${r.volatileLines})`);
    } else if (r.outcome === 'ok' && !r.volatileShapeOk) {
      changes.push(`${describe(r)}: snapshot line no longer matches its pinned shape`);
    }
  }
  if (changes.length) return { verdict: VERDICT.FAIL, detail: changes };

  // 5. A clean comparison that never reached the moved code proves nothing about it.
  //
  // ⛔ THIS IS A REFUSAL, NOT A PASS. graph-senior-dev proved the guard reporting "55 of 55
  // unchanged" while no corpus cell ever executed the moved builder. More inputs is not coverage.
  const ran = results.filter((r) => r.route && r.routeExecuted).length;
  if (ran !== routeCount) {
    return {
      verdict: VERDICT.REFUSE,
      reason: REFUSAL.ROUTES_UNREACHED,
      detail: [`routes executed ${ran}/${routeCount}`],
    };
  }

  return { verdict: VERDICT.PASS, detail: [`${results.length} of ${results.length} identical`, `routes ${ran}/${routeCount}`] };
}
