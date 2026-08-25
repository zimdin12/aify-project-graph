#!/usr/bin/env node
// Does `degraded === true` hold EXACTLY when `cause !== null`, across every reachable branch?
//
// WHY THIS EXISTS. Migrating the evidence contract means retiring `degraded` and letting `cause`
// carry the diagnosis. The single production reader is
//
//     if (evidence.degraded && evidence.cause && !STANDING_CAUSES.has(evidence.cause))
//
// and I claimed — in a committed census, and to graph-senior-dev — that it could drop the
// `degraded &&` term with NO behaviour change "because cause is non-null exactly when degraded is
// true". I had READ that, not exercised it.
//
// ⛔ IT IS FALSE. 336 of 1,134 reachable combinations violate it, all of the same shape:
//
//     ready: false, degraded: false, cause: 'unknown'    // "usable result; readiness signal missing"
//
// A deliberate state: the answer is usable, nothing is degraded, but `exhaustive` is withheld and
// the reason is named. Dropping the `degraded &&` term would make the sticky-degraded tracker fire
// on results that are NOT degraded.
//
// ⇒ So this is kept as an instrument rather than a one-off: the equivalence is a PRECONDITION of
// the migration, and a precondition asserted from reading is how this repo produces most of its
// defects. Re-run it before any step that treats the two fields as interchangeable.
//
// Exit 0 = invariant holds AND both outcomes were observed. Exit 1 = do not proceed.

import { buildReferencesEvidence } from '../mcp/stdio/query/verbs/code_intel_live.js';

const FRESHNESS = ['fresh', 'stale', 'timeout', 'unknown', 'cold', undefined];
const COUNTS = [0, 1, 5];
const STATES = ['found', 'not_found_after_retry', undefined];
const COVERAGES = [
  undefined,
  null,
  { complete: true },
  { complete: false, kind: 'compile_db' },
  { complete: false, kind: 'tsconfig' },
  { complete: false, kind: 'python_dynamic' },
  { complete: undefined },
];

const violations = [];
const causes = new Set();
let checked = 0;
let sawTrue = 0;
let sawFalse = 0;

for (const freshness of FRESHNESS) {
  for (const callsiteCount of COUNTS) {
    for (const defCount of COUNTS) {
      for (const resultState of STATES) {
        for (const coverage of COVERAGES) {
          let e;
          try {
            e = buildReferencesEvidence({ freshness, callsiteCount, defCount, resultState, coverage });
          } catch (err) {
            violations.push({ kind: 'threw', error: err.message, freshness, callsiteCount, defCount, resultState });
            continue;
          }
          checked += 1;
          causes.add(String(e.cause));
          if (e.degraded === true) sawTrue += 1;
          if (e.degraded === false) sawFalse += 1;
          const degradedTrue = e.degraded === true;
          const causePresent = e.cause !== null && e.cause !== undefined;
          if (degradedTrue !== causePresent) {
            violations.push({ kind: 'invariant', degraded: e.degraded, cause: e.cause, freshness, callsiteCount, defCount, resultState, coverage });
          }
        }
      }
    }
  }
}

// POSITIVE CONTROLS: both outcomes must actually occur. An invariant "verified" on inputs that
// only ever produced one side has verified nothing — the enumeration would pass on a builder that
// hardcoded `degraded: true`.
const bothOutcomes = sawTrue > 0 && sawFalse > 0;
const holds = violations.length === 0 && bothOutcomes;

console.log(JSON.stringify({
  what: 'Is `degraded === true` equivalent to `cause !== null` on buildReferencesEvidence?',
  checked,
  controls: { sawDegradedTrue: sawTrue, sawDegradedFalse: sawFalse, bothOutcomesObserved: bothOutcomes },
  distinctCauses: [...causes].sort(),
  violationCount: violations.length,
  violationShapes: [...new Set(violations.map((v) => `${v.kind}:degraded=${v.degraded},cause=${v.cause}`))],
  sample: violations.slice(0, 3),
  verdict: holds
    ? 'EQUIVALENT — the `degraded &&` term may be dropped'
    : 'NOT EQUIVALENT — dropping the `degraded &&` term WOULD CHANGE BEHAVIOUR',
}, null, 2));

process.exit(holds ? 0 : 1);
