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
// ⛔ RETARGETED 2026-09-04, PREMISE UNCHANGED. The requirement above is exactly as binding as it
// was; what moved is WHERE the fact is rendered. The indexed-scope qualifier left the shared trust
// line for the HEADLINE of every absence-emitting verb, because a hurried agent reads the headline
// and the clause sat ~200 B into a second line. `buildAbsenceTrustLine` no longer emits it at all,
// so asserting against that function would now be asserting against the wrong producer.
//
// ⇒ These tests point at `indexedScopePhrase`, the single owner both surfaces call. The three
// properties they guard are the ones the new placement test does NOT cover, which is why this file
// survives rather than being folded into it:
//   1. the count is STATED with the limit it implies;
//   2. the count VARIES with the graph, so it is a measurement and not decoration;
//   3. an unreadable count is SILENT and never renders as a measured zero.
// Placement across the five verbs is owned by absence-headlines-name-the-scope.test.js.
import { describe, it, expect } from 'vitest';
import { buildAbsenceTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { indexedScopePhrase } from '../../../mcp/stdio/query/miss-scope.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// A minimal stand-in for the graph db: only the File count is consulted.
const dbWith = (fileCount) => ({
  get: () => ({ c: fileCount }),
  all: () => [],
});
const dbThatThrows = { get: () => { throw new Error('no such table'); }, all: () => [] };

describe('an absence names the population the heuristic graph searched', () => {
  it('★★★ the count is stated, with the limit it implies', async () => {
    const line = indexedScopePhrase(dbWith(881));
    expect(line).toMatch(/881 indexed files/);
    // ⚠ WORDING COLLAPSED 2026-09-03. This asserted the long form, "not a statement about the
    // repository". There are no longer two wordings: `brief` was introduced for NO MATCH after
    // measuring that "not the whole repository" carries the same guarantee in 48 fewer bytes, and
    // keeping both was paying for a distinction the measurement had dissolved — on a surface just
    // measured at 2.4x the warning wall this project once removed. The LIMIT is what matters and is
    // still asserted; only its spelling changed.
    expect(line, 'the number alone invites a completeness reading it cannot support')
      .toMatch(/not the whole repository/);
  });

  it('⛔ POSITIVE CONTROL: a different count renders differently — else the number is decoration', async () => {
    // Without this, a hardcoded string would satisfy the assertion above while reporting the same
    // figure for every repository.
    const small = indexedScopePhrase(dbWith(3));
    expect(small).toMatch(/3 indexed files/);
    expectAbsentWithLiveMatcher(
      /3 indexed file[^s]/,
      { forbidden: ' in 3 indexed file (not the whole repository)',
        allowed: ' in 3 indexed files (not the whole repository)' },
      small,
      'singular/plural must follow the value too',
    );
    const one = indexedScopePhrase(dbWith(1));
    expect(one).toMatch(/1 indexed file \(/);
  });

  it('⛔ an UNREADABLE count is silent, never rendered as zero', async () => {
    // A failed COUNT must not become "INDEXED SCOPE: 0 files", which reads as a measured empty graph
    // — the failed-measurement-as-silence defect this file family has already been bitten by twice.
    const line = indexedScopePhrase(dbThatThrows);
    expect(line, 'silence is the empty string, not a sentence about zero').toBe('');
    expectAbsentWithLiveMatcher(
      /indexed file/,
      { forbidden: ' in 0 indexed files (not the whole repository)',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive' },
      line,
      'a query that threw must not be reported as a measured population',
    );
  });

  it('⛔ no db at all is silent — the caller may not have one', async () => {
    // ⚠ BOTH PRODUCERS, because "no db" has to be survivable on each. The trust line must still
    // render its own clauses, and the phrase must contribute nothing rather than crash.
    const line = await buildAbsenceTrustLine({ noun: 'callers' });
    expect(line, 'the trust line itself must still render').toMatch(/TRUST:/);
    expect(indexedScopePhrase(null), 'with no db there is no population to name').toBe('');
    expectAbsentWithLiveMatcher(
      /indexed file/,
      { forbidden: ' in 881 indexed files (not the whole repository)',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive' },
      line,
      'the trust line must not resurrect the clause the headline now owns',
    );
  });
});
