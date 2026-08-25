// ⛔⛔ 0 OF 35 DECLARED WITNESS SPECS CAN RUN, AND THAT NUMBER IS FROZEN HERE.
//
// `self-review.mjs` v3 made `case` and `expect` mandatory — *"a witness is not optional"*. The five
// spec files under `tests/self-review/` predate that hardening and were never migrated, so the tool
// refuses to load any of them. Measured on the frozen carrier:
//
//     declared      35
//     ADDRESSABLE   35     the anchor resolves to exactly one site
//     RUNNABLE       0     ← the rung nobody had measured
//     WITNESSED      0
//
// ⇒ I had shipped "35 declared / 35 addressable" with an explicit caveat that addressable is not
// witnessed, and it STILL read as reassuring — **a number with a caveat is still a number.** Only
// naming the missing rung fixed that. This file exists so the empty rungs stay visible.
//
// ⛔ AND THERE IS NO TARGET. the reviewer's ruling: *"do not bulk-author 35 case/expect pairs
// and do not optimize toward 35/35. A target denominator would turn schema completion into
// manufactured agreement."* Retirement is a correct ruling, not a denominator loss to hide.
//
// ⚠ "migrated" IS NEVER A SYNONYM FOR "witnessed". The states below are deliberately granular so a
// spec cannot be promoted by having been touched.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredSpecs, SPEC_DIR } from '../../helpers/self-review-specs.js';

const LEDGER_FILE = 'migration-ledger.json';

/**
 * The states a declared spec may hold. Ordered weakest to strongest; nothing may claim a state it
 * has not earned by execution.
 *
 * ⛔ `v3_failure_observed_unattributed` is a REAL rung, not a rounding error on the way to
 * witnessed. It means the preregistered failure slot was observed while body attribution stays
 * open — a `beforeEach` throw occupies the same slot as a body assertion.
 */
const STATES = [
  'legacy_unruled',                    // pre-v3 declaration; not runnable, no witness claim
  'retired_obsolete',                  // guarantee/mutation/route no longer valid, with a reason
  'v3_runnable_unwitnessed',           // schema-valid and executable; predicted failure not observed
  'v3_failure_observed_unattributed',  // preregistered failure observed; body attribution open
  'v3_witnessed',                      // route/body attribution AND predicted RED established
];

/** Spec IDs derived PHYSICALLY from disk, through the SAME helper the addressability gate uses. */
function declaredIds() {
  return new Map(declaredSpecs().map((e) => [e.name, e]));
}

const ledger = () => JSON.parse(readFileSync(join(SPEC_DIR, LEDGER_FILE), 'utf8'));

describe('the witness migration ledger accounts for every declared spec', () => {
  it('★★★ the frozen baseline records what was true at b216323, and is not rewritten', () => {
    // ⛔ IMMUTABLE. the reviewer: *"do not rewrite history by calling pre-v3 declarations
    // runnable."* If this ever needs to change, it is a new baseline with a new commit, not an
    // edit that makes the old numbers look better.
    const { frozenAt } = ledger();
    expect(frozenAt.commit).toBe('b21632346780e34ebbce6f30b9fba8006d5ee21d');
    expect(frozenAt.tree).toBe('6a90fe3e559e9009a1e59a18c90f6328837bc815');
    expect(frozenAt).toMatchObject({ declared: 35, addressable: 35, v3Runnable: 0, attributedWitnesses: 0 });
    // ⚠ The FROZEN numbers describe b216323 and do not move as specs are promoted. They are the
    // record of what was true when the corpus was first counted, not a live tally.
    expect(frozenAt.v3Runnable, 'frozen, not live').toBe(0);
  });

  it('★★★ every derived ID appears EXACTLY ONCE in the ledger', () => {
    // ⛔ POSITIVE CONTROL FIRST: the derivation must find a real population, or "all accounted for"
    // is trivially true of nothing.
    const ids = declaredIds();
    expect(ids.size, 'the physical derivation found the specs').toBe(35);

    const entries = ledger().entries;
    const unaccounted = [...ids.keys()].filter((id) => !(id in entries));
    const orphaned = Object.keys(entries).filter((id) => !ids.has(id));

    expect(unaccounted, 'a declared spec with no ruling is invisible to every count').toEqual([]);
    expect(orphaned, 'a ledger row for a spec that no longer exists inflates the denominator').toEqual([]);
  });

  it('★★★ every state is one of the declared states — no invented rung', () => {
    const bad = Object.entries(ledger().entries)
      .filter(([, v]) => !STATES.includes(v.state))
      .map(([id, v]) => `${id}: ${v.state}`);
    expect(bad, 'a state outside the vocabulary cannot be counted or trusted').toEqual([]);
  });

  it('★★★ LEGACY MAY ONLY DECREASE — the ratchet', () => {
    // ⛔ Nothing may enter as legacy. A NEW spec must be v3-schema-valid from birth, or the corpus
    // re-accumulates exactly the debt this ledger exists to pay down.
    const l = ledger();
    const legacy = Object.values(l.entries).filter((v) => v.state === 'legacy_unruled').length;
    expect(legacy, `legacy count must not exceed the ceiling ${l.legacyCeiling}`)
      .toBeLessThanOrEqual(l.legacyCeiling);
    // When it drops, lower the ceiling in the same commit — a ratchet that never tightens is a
    // baseline that quietly permits climbing back.
    if (legacy < l.legacyCeiling) {
      expect.fail(`legacy dropped to ${legacy} — lower legacyCeiling to ${legacy} in this commit`);
    }
  });

  it('★★★ a retired spec states WHY — retirement is a ruling, not a deletion', () => {
    const retired = Object.entries(ledger().entries).filter(([, v]) => v.state === 'retired_obsolete');
    for (const [id, v] of retired) {
      expect(v.reason?.length ?? 0, `${id} retired without a recorded reason`).toBeGreaterThan(30);
    }
  });

  it('★★★ only states CLAIMING v3 are held to the v3 schema', () => {
    // ⚠ Validating case/expect on a legacy row would demand the very fields whose absence defines
    // that state — the gate would fail on an honest declaration. The schema binds the claim, not
    // the file.
    const ids = declaredIds();
    const claiming = Object.entries(ledger().entries).filter(([, v]) => v.state.startsWith('v3_'));
    for (const [id, v] of claiming) {
      const spec = ids.get(id);
      expect(typeof spec?.case, `${id} claims ${v.state} but has no string 'case'`).toBe('string');
      expect(typeof spec?.expect, `${id} claims ${v.state} but has no string 'expect'`).toBe('string');
    }
  });

  it('★★★ the EXCLUSIVE state ledger sums to the declared population', () => {
    // ⛔⛔ I REPORTED A LADDER THAT COUNTED G8 TWICE AND SUMMED TO 36. I wrote
    // "1 runnable · 1 failure_observed_unattributed" for a single spec in a single state.
    // the reviewer caught it: the five states are EXCLUSIVE, so they must sum to the
    // population and nothing else. A ladder that double-counts inflates progress by construction.
    const entries = Object.values(ledger().entries);
    const count = (s) => entries.filter((v) => v.state === s).length;
    const exclusive = {
      legacy_unruled: count('legacy_unruled'),
      retired_obsolete: count('retired_obsolete'),
      v3_runnable_unwitnessed: count('v3_runnable_unwitnessed'),
      v3_failure_observed_unattributed: count('v3_failure_observed_unattributed'),
      v3_witnessed: count('v3_witnessed'),
    };
    const sum = Object.values(exclusive).reduce((a, b) => a + b, 0);
    expect(sum, 'the exclusive states must account for every declaration exactly once')
      .toBe(entries.length);

    expect(exclusive).toEqual({
      legacy_unruled: 30,
      retired_obsolete: 2,
      v3_runnable_unwitnessed: 1,
      v3_failure_observed_unattributed: 2,
      v3_witnessed: 0,
    });
  });

  it('★★★ the CUMULATIVE capability view is labelled cumulative and never sums to the population', () => {
    // ⚠ SEPARATE FROM THE LADDER ABOVE, ON PURPOSE. "How many are schema-runnable" is a rollup
    // across three exclusive states; presenting it beside them invites exactly the double count
    // I made. It answers a different question and is labelled as doing so.
    const entries = Object.values(ledger().entries);
    const count = (s) => entries.filter((v) => v.state === s).length;
    const cumulative = {
      schemaRunnable: count('v3_runnable_unwitnessed') + count('v3_failure_observed_unattributed') + count('v3_witnessed'),
      failureObservedOrBetter: count('v3_failure_observed_unattributed') + count('v3_witnessed'),
      witnessed: count('v3_witnessed'),
    };
    expect(cumulative).toEqual({ schemaRunnable: 3, failureObservedOrBetter: 2, witnessed: 0 });
    // ⚠ RETIRED SPECS ARE NOT IN ANY CUMULATIVE ROLLUP. Retirement is a ruling that a witness
    // cannot exist, not partial progress toward one — counting it as capability would be the
    // denominator-flattering move this ledger exists to prevent.
    // Monotone by construction: each rollup contains the next.
    expect(cumulative.schemaRunnable).toBeGreaterThanOrEqual(cumulative.failureObservedOrBetter);
    expect(cumulative.failureObservedOrBetter).toBeGreaterThanOrEqual(cumulative.witnessed);
  });
});
