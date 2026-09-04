// ⛔ A PER-ITEM BUDGET IS NOT A BUDGET.
//
// Every caveat on the absence answer was added with its own byte measurement against its own
// preregistered threshold, and every one is individually defensible. Each was measured against the
// answer as it stood BEFORE the previous one landed, and never against the total. Measured
// 2026-09-03: 1057 B of caveat around a 200 B answer — 2.4x the 445-byte warning wall this project
// already tore out once for being unreadable.
// docs/evidence/m2-contract/FINDING-the-wall-is-rebuilt.md
//
// ⛔ THE CEILING BELOW IS NOT A BLESSING. It is above the historical wall and is recorded as a
// STOP-GROWTH line, not a target. The next clause added here must make room by trimming, which is
// the discipline that was missing while this was assembled.
//
// ⚠ It measures COMPOSITION, not rendering: the clause builders are called directly with a stub db,
// so the test is deterministic and does not depend on this repository's own graph or dirty state.
// A real answer also carries SNAPSHOT WARNINGS and a verb-specific SCOPE line, so the live total is
// LARGER than what is asserted here — this is a floor on the problem, not the whole of it.
import { describe, it, expect } from 'vitest';
import { buildAbsenceTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { noMatchMessage } from '../../../mcp/stdio/query/did-you-mean.js';

// Stub db: a File count for INDEXED SCOPE, no collection rows, no suggestions.
const db = {
  get: () => ({ c: 932 }),
  all: () => [],
  raw: { prepare: () => ({ all: () => [], get: () => null }) },
};

// The measured ceiling. Raising it is a deliberate act that should carry a reason in the diff.
// ⛔ THESE ARE THE MEASURED CURRENT VALUES, SET EXACTLY, AND THAT BRITTLENESS IS THE FEATURE.
// Any addition fails this test, which forces the trim that was missing while the surface was
// assembled. Both numbers are ABOVE the 445 B wall this project removed once, so they are
// stop-growth lines and not targets: the correct direction for either is DOWN.
// ⬇ LOWERED 2026-09-03 after collapsing two wordings of the indexed-scope clause into one. The
// ratchet only ever moves DOWN without a stated reason; moving it up requires one in the diff.
// ⬇ LOWERED AGAIN 2026-09-04, when the indexed-scope clause left this surface for the HEADLINE of
// every absence-emitting verb (callers, callees, impact, neighbors, trace) and the duplicate here
// was deleted with the `scopeInHeadline` migration flag.
//
// ⚠ AND THIS IS NOT A BYTE WIN — say so, or the next reader banks a saving that was never made.
// The clause left this line (-53 B) and the same fact arrived in the headline as
// " in N indexed files (not the whole repository)" (+47 B). Net across the whole answer is about
// -6 B, which is noise. The change bought PLACEMENT, not size: a reader who stops at the first
// period now has the qualifier, and a caveat is no longer stated twice in one answer. The ceilings
// move down because this surface genuinely got smaller, not because the answer did.
// ⛔ AND THE WORST-CASE NUMBER CAME FROM THE TEST, NOT FROM MY OWN PROBE. I measured 813 B in a
// scratch script and nearly set the ceiling there; the fixture below produces 946 B, because my
// probe's `freshness` object never fired the `NOT COVERED:` clause this test explicitly asserts.
// A shape that RESEMBLES the one under test is not the one under test — the ceiling would have been
// set 133 B below anything reachable, and the next real change would have failed against a number
// nothing had ever produced.
const CAVEAT_CEILING_BYTES = 545;        // javascript, clean tree      (was 598, 641)
const WORST_CASE_CEILING_BYTES = 946;    // cpp + an uncommitted source (was 999, 1042)
const NO_MATCH_CEILING_BYTES = 157;      // the OTHER surface, shared by nine verbs

describe('the absence caveat surface has an aggregate budget', () => {
  it('⛔ POSITIVE CONTROL: the line is actually assembled — else the budget guards nothing', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', db, language: 'javascript' });
    expect(line, 'the trust banner must be present').toMatch(/TRUST:/);
    // ⛔ THE PREMISE EXPIRED; THE SPECIMEN DID NOT MOVE. This asserted `INDEXED SCOPE:` was in the
    // assembled line, and that clause was DELETED from this surface on purpose — every absence
    // headline now carries the fact, and repeating it here is the duplication the migration removed.
    // So the assertion is not repaired by pointing it somewhere else: the thing it checked should no
    // longer exist. `absence-headlines-name-the-scope.test.js` owns the fact's new home, including
    // a check that it appears exactly ONCE per answer.
    //
    // ⚠ What this control is FOR still stands — proving the line is really assembled, or the ceiling
    // guards nothing — so the proof moves to two clauses that do belong here.
    expect(line, 'the LSP scope clause is this surface, not the headline').toMatch(/LSP SCOPE:/);
    expect(line).toMatch(/NOT MODELLED:/);
    expect(line.length, 'a non-trivial surface, or the ceiling is vacuous').toBeGreaterThan(200);
  });

  it('★★★ the assembled caveat surface stays under the recorded ceiling', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', db, language: 'javascript' });
    expect(line.length,
      `absence caveats are ${line.length} B against a ${CAVEAT_CEILING_BYTES} B ceiling. `
      + 'This surface is ALREADY over the 445 B wall this project removed once. To add a clause, '
      + 'take bytes out of an existing one — do not raise this number without saying why in the diff.')
      .toBeLessThanOrEqual(CAVEAT_CEILING_BYTES);
  });

  it('★★★ the NO MATCH surface has its own ceiling — a mutant proved the gate had a hole', async () => {
    // ⛔ ADDED BECAUSE A MUTANT SURVIVED. Growing the BRIEF clause by a few words changed nothing
    // here: this budget guarded `buildAbsenceTrustLine`, and the brief form renders only on the
    // NO MATCH surface, which is produced by a different function shared by nine verbs. A budget
    // that covers one of two surfaces is not a budget — the same "one fix is not a sweep" shape the
    // clauses themselves kept hitting.
    const out = noMatchMessage(db, 'zzqAbsentSymbolName');
    expect(out, 'precondition: this is the NO MATCH shape').toMatch(/NO MATCH/);
    expect(out, 'and it carries the clause under budget').toMatch(/INDEXED SCOPE:/);
    expect(out.length,
      `NO MATCH is ${out.length} B against a ${NO_MATCH_CEILING_BYTES} B ceiling. It is the smallest `
      + 'absence answer, so a clause costs proportionally most here — the 445 B wall this project '
      + 'removed was 79% of a NO MATCH.')
      .toBeLessThanOrEqual(NO_MATCH_CEILING_BYTES);
  });

  it('⛔ the worst case — every clause firing at once — is the one that must fit', async () => {
    // C++ carries the longest NOT MODELLED text, and an uncommitted source adds its own clause. If
    // the budget is only checked on a cheap language it will not see the wall it exists to stop.
    const worst = await buildAbsenceTrustLine({
      noun: 'callers', db, language: 'cpp',
      freshness: { uncommittedSources: [{ path: 'src/a.js', why: 'untracked' }] },
    });
    expect(worst).toMatch(/NOT COVERED:/);
    expect(worst.length,
      `worst-case absence caveats are ${worst.length} B. This is the shape an agent actually meets `
      + 'on a C++ repo with uncommitted work, and it is the number that decides whether the surface '
      + 'is readable.')
      .toBeLessThanOrEqual(WORST_CASE_CEILING_BYTES);
  });
});
