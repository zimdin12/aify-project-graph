import { describe, it, expect } from 'vitest';
import { graphCapabilities } from '../../../mcp/stdio/query/graph-capabilities.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ THE DEFECT THIS CLOSES WAS MEASURED ON THIRD-PARTY REPOSITORIES, not imagined:
//
//     fast-route (PHP)  0 compiler-verified edges  ->  trust: "strong"
//     fmt (C++)         0 compiler-verified edges  ->  trust: "ok"
//     click (Python)    1,410 verified (10.4%)     ->  trust: "weak"
//
// `computeTrustLevel` is a function of unresolved-edge count alone. It is a real measure of how
// completely extraction resolved its own references, and it says NOTHING about whether a compiler
// ever checked an edge. So the repo with no spine reports the strongest trust.
//
// `graph_health` already warns in `nextActions`. The problem is that the HEADLINE CONTRADICTS THE
// WARNING — and a reader who believes the headline never reaches the correction.
//
// ⇒ Review ruled: report capabilities SEPARATELY, do not refuse to call the graph usable, do not
// auto-run a 60-second collection. These tests pin that ruling.

describe('graphCapabilities — orientation and absence authority are INDEPENDENT', () => {
  it('⭐ a graph with NO verified edges is still usable for orientation', () => {
    // The half review insisted on: a missing spine does not make the graph worthless. File and
    // symbol location, containment and module structure are all served by extraction.
    const c = graphCapabilities({ indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false });
    expect(c.orientationUsable).toBe(true);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('no_collection');
  });

  it('⛔ absence authority is FALSE when the spine is empty — the deleting claim', () => {
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true },
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('trust_spine_empty');
  });

  it('⛔ absence authority is FALSE on a PARTIAL collection, even with verified edges', () => {
    // click: 1,410 verified edges and 25 of 79 files processed. An empty caller set there is a
    // floor, not a fact, and this is the exact state that reported trust "weak" while having the
    // only real spine of the four arms.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: false },
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('collection_partial');
  });

  it('⭐ absence authority is TRUE only when every clause holds', () => {
    // The positive control. A predicate that never grants is as useless as one that always does.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true },
    });
    expect(c.absenceAuthority).toBe(true);
    expect(c.reason).toBeNull();
    expect(c.nextAction).toBeNull();
  });

  it('⛔ UNKNOWN coverage refuses — `complete !== true`, not `=== false`', () => {
    // A collection stored before the coverage columns existed reports null. Unknown coverage is not
    // complete coverage, and this repository has repeatedly paid for collapsing those two.
    for (const coverage of [null, undefined, {}, { complete: null }]) {
      const c = graphCapabilities({
        indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage,
      });
      expect(c.absenceAuthority, JSON.stringify(coverage)).toBe(false);
    }
  });

  it('⛔ an unindexed repo has NEITHER capability', () => {
    const c = graphCapabilities({ indexed: false });
    expect(c.orientationUsable).toBe(false);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('not_indexed');
  });
});

describe('the PHP case — a permanent limit must not be dressed as a pending action', () => {
  it('⭐ names the missing language server instead of suggesting a collection', () => {
    // ⛔ fast-route reports trust "strong" with zero verified edges and can NEVER earn one, because
    // no PHP language server exists here. Telling that reader to run graph_collect_code_intel
    // sends them to a command that cannot help — a remedy that cannot work is worse than naming
    // the limit, because it costs them a minute AND leaves the wrong belief intact.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false,
      language: 'php', languageHasServer: false,
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('no_language_server');
    expect(c.nextAction).toMatch(/no language server for php/i);
    expect(c.nextAction).toMatch(/rg/);
    // ⛔ CONTROLLED NEGATIVE, because a bare `not.toMatch` passes vacuously on null or on a typo in
    // the pattern. The repo's own guard caught this one — `negative-assertions-are-controlled`
    // failed the suite when I wrote the bare form, which is the mechanical control working.
    // The canaries prove the matcher is live AND not overbroad before absence is asserted.
    expectAbsentWithLiveMatcher(
      /graph_collect_code_intel/,
      { forbidden: 'graph_collect_code_intel({ scope: "all" })', allowed: 'verify with rg before any delete' },
      c.nextAction,
      'a language with no server must NOT be sent to a collection that cannot help it',
    );
  });

  it('a language WITH a server still gets the collection action', () => {
    // The negative control: without this, the assertion above is satisfied by never suggesting a
    // collection to anyone.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false,
      language: 'python', languageHasServer: true,
    });
    expect(c.nextAction).toMatch(/graph_collect_code_intel/);
  });
});

describe('every refusal carries an action a reader can take', () => {
  it('⛔ no reason is ever reported without a next action', () => {
    // A capability that says "no" and stops makes the reader re-ask, which this project has spent
    // the day removing everywhere else.
    const states = [
      { indexed: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true } },
      { indexed: true, compilerVerifiedEdges: 5, collectionAvailable: true, coverage: { complete: false } },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false, language: 'php', languageHasServer: false },
    ];
    for (const s of states) {
      const c = graphCapabilities(s);
      expect(c.absenceAuthority, JSON.stringify(s)).toBe(false);
      expect(typeof c.nextAction, JSON.stringify(s)).toBe('string');
      expect(c.nextAction.length).toBeGreaterThan(10);
    }
  });

  it('⭐ says NO more often than YES across the state space — not a rubber stamp', () => {
    const states = [
      { indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true } },
      { indexed: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true } },
      { indexed: true, compilerVerifiedEdges: 9, collectionAvailable: true, coverage: { complete: false } },
    ];
    const granted = states.filter((s) => graphCapabilities(s).absenceAuthority);
    expect(granted).toHaveLength(1);
    expect(granted.length).toBeLessThan(states.length - granted.length);
  });
});
