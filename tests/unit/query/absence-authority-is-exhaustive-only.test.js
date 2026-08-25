import { describe, it, expect } from 'vitest';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { buildHierarchyEvidence } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';

// Step 3 of graph-senior-dev's evidence-contract migration: "migrate absence authority to
// `exhaustive === true` only".
//
// ⚠ I HAVE BEEN CALLING THIS "already true in practice" FOR THREE CYCLES WITHOUT RUNNING IT.
// Today I stated three things as established that I had only read, and was wrong about all three
// — the graph_index drop that never happened, a coverage sentence I said failed to name its
// population when it did, and an invariant that 336 of 1,134 combinations violate. So this is
// EXECUTED across the reachable input space rather than asserted from the source.
//
// ⭐ AND THE ZERO CARRIES A POSITIVE CONTROL. "No branch grants exhaustive" is worthless if the
// enumeration never reaches the branch that used to grant it. The control below drives the EXACT
// input that granted `exhaustive: true` before 0d1fd1d and proves it is reached and now refused.

const FRESHNESS = ['fresh', 'stale', 'timeout', 'unknown', 'cold', undefined];
const COUNTS = [0, 1, 5];
const STATES = ['found', 'not_found_after_retry', undefined];
const COVERAGES = [
  undefined, null, { complete: true },
  { complete: false, kind: 'compile_db' },
  { complete: false, kind: 'tsconfig' },
  { complete: false, kind: 'python_dynamic' },
];

describe('absence authority — `exhaustive === true` is the only gate, and no verb issues it', () => {
  it('code_intel_references never grants exhaustive on any reachable branch', () => {
    const granted = [];
    let combinations = 0;
    for (const freshness of FRESHNESS) {
      for (const callsiteCount of COUNTS) {
        for (const defCount of COUNTS) {
          for (const resultState of STATES) {
            for (const coverage of COVERAGES) {
              combinations += 1;
              const e = buildReferencesEvidence({ freshness, callsiteCount, defCount, resultState, coverage });
              if (e.exhaustive === true) granted.push({ freshness, callsiteCount, defCount, resultState, coverage });
            }
          }
        }
      }
    }
    expect(combinations, 'the enumeration must actually run (positive control)').toBeGreaterThan(900);
    expect(granted).toEqual([]);
  });

  it('code_intel_hierarchy never grants exhaustive on any reachable branch', () => {
    const granted = [];
    let combinations = 0;
    for (const mode of ['indexed', 'bounded']) {
      for (const indexReady of [true, false, null]) {
        for (const nodeCount of [0, 1, 4]) {
          for (const kind of ['callers', 'callees', 'subtypes']) {
            for (const coverage of COVERAGES) {
              for (const truncated of [0, 7]) {
                combinations += 1;
                const e = buildHierarchyEvidence({ mode, indexReady, nodeCount, kind, coverage, truncated });
                if (e.exhaustive === true) granted.push({ mode, indexReady, nodeCount, kind, coverage, truncated });
              }
            }
          }
        }
      }
    }
    expect(combinations, 'the enumeration must actually run (positive control)').toBeGreaterThan(600);
    expect(granted).toEqual([]);
  });

  it('⭐ POSITIVE CONTROL — the input that USED to grant exhaustive is reached, and now refused', () => {
    // Before 0d1fd1d, code_intel_hierarchy granted `exhaustive: true` on exactly this shape:
    // INDEXED mode, index ready, a non-empty tree, proven coverage, nothing truncated. If the
    // enumeration above could not reach it, its zero would prove nothing at all.
    const e = buildHierarchyEvidence({
      mode: 'indexed', indexReady: true, nodeCount: 4, kind: 'callers',
      coverage: { complete: true }, truncated: 0,
    });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('index_population_unattested');
    // And the reason survives with it — a withheld grant with no cause misdirects the remedy
    // exactly as a false grant misdirects the decision.
    expect(e.completeness).toBe('floor');
    expect(e.precision).toBe('compiler_resolved');
  });

  it('⭐ POSITIVE CONTROL — the references equivalent is reached and refused too', () => {
    // Fresh index, real callsites, complete coverage: the healthiest possible references answer.
    const e = buildReferencesEvidence({
      freshness: 'fresh', callsiteCount: 5, defCount: 1, resultState: 'found',
      coverage: { complete: true },
    });
    expect(e.exhaustive).toBe(false);
    expect(e.cause).toBe('index_population_unattested');
  });

  it('a caller branching ONLY on `exhaustive === true` therefore never claims an absence', () => {
    // The contract stated as a consumer would use it: this is what step 3 is protecting.
    const answers = [
      buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 0, defCount: 1, resultState: 'not_found_after_retry', coverage: { complete: true } }),
      buildHierarchyEvidence({ mode: 'indexed', indexReady: true, nodeCount: 1, kind: 'callers', coverage: { complete: true } }),
    ];
    for (const e of answers) {
      const wouldClaimAbsence = e.exhaustive === true;
      expect(wouldClaimAbsence).toBe(false);
    }
  });
});
