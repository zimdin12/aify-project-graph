// ⛔ "NO MATCH" IS READ AS A CLAIM ABOUT THE REPOSITORY — this repo's own recorded defect class.
//
// An agent asking whether a symbol exists got a bare no, with nothing saying how much was searched,
// across the NINE verbs that share `noMatchMessage`. The empty-set absence was given an INDEXED
// SCOPE clause first; this closes the other shape.
// docs/evidence/m2-contract/FINDING-absence-does-not-name-the-indexed-scope.md
//
// ⚠ THE BRIEF WORDING IS A MEASURED DECISION. Real NO MATCH answers on this repository are 251-281 B.
// The full wording is 26-28% of the smallest — over a 25% budget fixed BEFORE the numbers existed —
// while brief is 17.4%. ⚠ Disclosed: the brief wording was written AFTER seeing those numbers,
// because both preregistered options were flawed (one over budget, one dropping the limit clause a
// mutant already pinned). The threshold itself was not moved.
import { describe, it, expect } from 'vitest';
import { noMatchMessage } from '../../../mcp/stdio/query/did-you-mean.js';
import { indexedScopeClause } from '../../../mcp/stdio/query/miss-scope.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// Minimal db stand-in: the File count, and no similar-symbol suggestions.
const dbWith = (fileCount) => ({
  get: () => ({ c: fileCount }),
  all: () => [],
  raw: { prepare: () => ({ all: () => [], get: () => null }) },
});
const dbThatThrows = {
  get: () => { throw new Error('no such table'); },
  all: () => [],
  raw: { prepare: () => ({ all: () => [], get: () => null }) },
};

describe('a NO MATCH names the population that was searched', () => {
  it('★★★ the count and the limit both appear', () => {
    const out = noMatchMessage(dbWith(881), 'zzqAbsent');
    expect(out, 'precondition: this is the NO MATCH shape').toMatch(/NO MATCH/);
    expect(out).toMatch(/INDEXED SCOPE: 881 files/);
    expect(out, 'a bare count invites the completeness reading the limit blocks')
      .toMatch(/not the whole repository/);
  });

  it('⛔ POSITIVE CONTROL: the number tracks the db — else it is decoration', () => {
    expect(noMatchMessage(dbWith(7), 'zzqAbsent')).toMatch(/INDEXED SCOPE: 7 files/);
    expect(noMatchMessage(dbWith(1), 'zzqAbsent')).toMatch(/INDEXED SCOPE: 1 file —/);
  });

  it('⛔ an unreadable count is silent, never rendered as zero', () => {
    const out = noMatchMessage(dbThatThrows, 'zzqAbsent');
    expect(out, 'the NO MATCH itself must still render').toMatch(/NO MATCH/);
    expectAbsentWithLiveMatcher(
      /INDEXED SCOPE/,
      { forbidden: 'INDEXED SCOPE: 0 files — not the whole repository.',
        allowed: 'NO MATCH for "zzqAbsent". Try graph_search(query="zzqAbsent") to find similar names.' },
      out,
      'a query that threw must not be reported as a measured population',
    );
  });

  it('⛔ the BRIEF form stays inside the measured budget', () => {
    // The reason this wording exists at all. If someone lengthens it, the ratio that justified
    // putting it on NO MATCH stops holding, and this fails rather than silently regressing.
    const brief = indexedScopeClause(dbWith(881), { brief: true });
    const SMALLEST_REAL_NO_MATCH = 251; // measured, scripts/probe-no-match-byte-budget.mjs
    const pct = (brief.length / (SMALLEST_REAL_NO_MATCH + brief.length)) * 100;
    expect(pct, `clause is ${pct.toFixed(1)}% of the smallest real NO MATCH`).toBeLessThan(25);
    // ⚠ THE full/brief COMPARISON IS GONE, DELIBERATELY. It asserted the long form was longer — true
    // until the two wordings were collapsed into one, at which point the assertion was pinning a
    // distinction that no longer earns its bytes. What still matters is that the ONE wording carries
    // the limit, which is asserted here rather than left to the vanished comparison.
    expect(brief, 'the single wording must still carry the limit').toMatch(/not the whole repository/);
  });

  it('⛔ both surfaces get their number from ONE owner', () => {
    // Two renderers of the same fact drift. This repo already records a dirty-file count where one
    // verb said 592 and another said 4 for the same tree at the same commit.
    const brief = indexedScopeClause(dbWith(42), { brief: true });
    const full = indexedScopeClause(dbWith(42));
    expect(brief).toMatch(/42 files/);
    expect(full).toMatch(/42 files/);
  });
});
