// ⛔ M2's SECOND HALF: "separate 'no callers in indexed scope' from 'no callers' and NAME the scope".
//
// `spineScopeClause` named the COMPILER-VERIFIED scope well — "processed 73 of 627 eligible files".
// The tier underneath named nothing, and a repo with no code-intel collection has ONLY that tier,
// which is the ordinary JS/Python case. Measured: neither absence shape stated an indexed
// population. docs/evidence/m2-contract/FINDING-absence-does-not-name-the-indexed-scope.md
//
// ⚠ "No callers" from a graph that indexed 881 files and the same sentence from one that indexed 200
// are the identical string. The agent deciding whether to delete cannot tell them apart — which is
// exactly the distinction M2 exists to draw.
import { describe, it, expect } from 'vitest';
import { buildAbsenceTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// A minimal stand-in for the graph db: only the File count is consulted.
const dbWith = (fileCount) => ({
  get: () => ({ c: fileCount }),
  all: () => [],
});
const dbThatThrows = { get: () => { throw new Error('no such table'); }, all: () => [] };

describe('an absence names the population the heuristic graph searched', () => {
  it('★★★ the count is stated, with the limit it implies', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers', db: dbWith(881) });
    expect(line).toMatch(/INDEXED SCOPE: 881 files/);
    expect(line, 'the number alone invites a completeness reading it cannot support')
      .toMatch(/not a statement about the repository/);
  });

  it('⛔ POSITIVE CONTROL: a different count renders differently — else the number is decoration', async () => {
    // Without this, a hardcoded string would satisfy the assertion above while reporting the same
    // figure for every repository.
    const small = await buildAbsenceTrustLine({ noun: 'callers', db: dbWith(3) });
    expect(small).toMatch(/INDEXED SCOPE: 3 files/);
    expectAbsentWithLiveMatcher(
      /3 file —/,
      { forbidden: 'INDEXED SCOPE: 3 file — this absence is within that scope',
        allowed: 'INDEXED SCOPE: 3 files — this absence is within that scope' },
      small,
      'singular/plural must follow the value too',
    );
    const one = await buildAbsenceTrustLine({ noun: 'callers', db: dbWith(1) });
    expect(one).toMatch(/INDEXED SCOPE: 1 file —/);
  });

  it('⛔ an UNREADABLE count is silent, never rendered as zero', async () => {
    // A failed COUNT must not become "INDEXED SCOPE: 0 files", which reads as a measured empty graph
    // — the failed-measurement-as-silence defect this file family has already been bitten by twice.
    const line = await buildAbsenceTrustLine({ noun: 'callers', db: dbThatThrows });
    expectAbsentWithLiveMatcher(
      /INDEXED SCOPE/,
      { forbidden: 'INDEXED SCOPE: 0 files — this absence is within that scope',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive' },
      line,
      'a query that threw must not be reported as a measured population',
    );
  });

  it('⛔ no db at all is silent — the caller may not have one', async () => {
    const line = await buildAbsenceTrustLine({ noun: 'callers' });
    expect(line, 'the trust line itself must still render').toMatch(/TRUST:/);
    expectAbsentWithLiveMatcher(
      /INDEXED SCOPE/,
      { forbidden: 'INDEXED SCOPE: 881 files — this absence is within that scope',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive' },
      line,
      'with no db there is no population to name',
    );
  });
});
