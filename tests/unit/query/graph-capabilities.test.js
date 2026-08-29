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
      // A complete collection taken at an older commit no longer grants authority, so the state that
      // means "every clause holds" now has to say the collection is current too.
      collectionCurrent: true,
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
      // collectionCurrent added when this clause landed: a complete collection taken at an older
      // commit no longer grants authority, so the one granting state must now also be current.
      { indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true }, collectionCurrent: true },
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

// ⛔ F8 — AN INTERRUPTED INDEX LEAVES A GRAPH THAT PASSES EVERY OTHER CHECK.
//
// Observed on the pinned corpus: a `graph_index` killed mid-write left click holding 90 nodes
// (Document 43, Directory 25, Config 22) and ZERO code nodes, while the file existed, opened
// cleanly, carried a plausible count, and health reported it indexed.
//
// `writeManifest` renames atomically at the END of a successful run, so the manifest keeps
// describing the last good state while the database is mangled — and nothing compared the two.
//
// ⭐ POSITIVE CONTROL, measured on all four arms in the same pass: healthy graphs agree EXACTLY
// (fmt 6735/14855, click 2572/13618, fast-route 489/1343, p-queue 184/384), so a mismatch is a real
// signal rather than ordinary drift. The `HEALTHY` case below is that control in test form: without
// it, every assertion here is satisfied by a function that calls every graph broken.
describe('graphCapabilities — an incomplete index is reported, and only when it IS one', () => {
  const FULL = { indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true }, collectionCurrent: true };

  it('⭐ POSITIVE CONTROL: a graph whose counts agree keeps every capability', () => {
    const c = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 2572, manifestEdges: 13618, dbEdges: 13618, codeNodes: 1904 } });
    expect(c.orientationUsable).toBe(true);
    expect(c.absenceAuthority).toBe(true);
    expect(c.reason).toBeNull();
  });

  it('⛔ THE OBSERVED SHAPE: manifest 2,572 / database 90 / zero code nodes', () => {
    const c = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 90, manifestEdges: 13618, dbEdges: 0, codeNodes: 0 } });
    expect(c.orientationUsable).toBe(false);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('index_incomplete');
  });

  it('⛔ ORIENTATION FAILS TOO — a half-written graph cannot answer "what is near this" either', () => {
    // The narrower fix would have failed only absenceAuthority. But the observed graph had NO code
    // nodes at all, so "what does this module contain" is wrong, not merely incomplete.
    const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 } });
    expect(c.orientationUsable).toBe(false);
  });

  it('⛔ the nextAction says REINDEX and names both counts — never "run a collection"', () => {
    // The first cut of this fix let `index_incomplete` fall through to the default branch, which
    // told the operator to run a 60-second collection on a graph that needed rebuilding. Executing
    // it caught that; reading it had not.
    const { nextAction } = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 } });
    expect(nextAction).toMatch(/graph_index/);
    // A bare negative here would pass just as happily if the regex were dead. The canaries prove
    // it fires on the wrong remedy and stays silent on the right one.
    expectAbsentWithLiveMatcher(
      /graph_collect_code_intel/,
      { forbidden: 'graph_collect_code_intel({ scope: "all" }) to build the trust spine', allowed: 'graph_index({ force: true })' },
      nextAction,
      'a partial graph must be told to reindex, never to collect',
    );
    expect(nextAction).toContain('2572');
    expect(nextAction).toContain('90');
  });

  it('⛔ index_incomplete OUTRANKS every other reason — an unusable graph explains itself first', () => {
    // A partial PHP graph must not be told its problem is the missing language server.
    const c = graphCapabilities({ indexed: true, languageHasServer: false, language: 'php', collectionAvailable: false, integrity: { manifestNodes: 489, dbNodes: 12, codeNodes: 0 } });
    expect(c.reason).toBe('index_incomplete');
  });

  describe('⛔ it must not accuse a graph that is merely SMALL, EMPTY, or UNMEASURED', () => {
    it('a docs-only repository with zero code nodes and agreeing counts is fine', () => {
      // The zero-code signal alone would condemn every legitimate documentation tree. It fires only
      // paired with the database holding LESS than the manifest promised.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 90, dbNodes: 90, codeNodes: 0 } });
      expect(c.orientationUsable).toBe(true);
      expect(c.reason).not.toBe('index_incomplete');
    });

    it('a graph holding MORE than the manifest promised is not partial', () => {
      // A collection legitimately adds nodes after the index that wrote the manifest.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2393, dbNodes: 2566, codeNodes: 0 } });
      expect(c.orientationUsable).toBe(true);
    });

    it('UNKNOWN REFUSES TO ACCUSE: absent integrity, and manifests predating these fields', () => {
      expect(graphCapabilities({ indexed: true }).orientationUsable).toBe(true);
      expect(graphCapabilities({ indexed: true, integrity: null }).orientationUsable).toBe(true);
      expect(graphCapabilities({ indexed: true, integrity: { manifestNodes: null, dbNodes: 90, codeNodes: 0 } }).orientationUsable).toBe(true);
    });

    it('short of the manifest but still HOLDING CODE is not condemned on that evidence alone', () => {
      // Short alone could be a pruned collection. The pair is required.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2572, dbNodes: 2100, codeNodes: 1500 } });
      expect(c.orientationUsable).toBe(true);
    });
  });

  it('⭐ it DISCRIMINATES: exactly one of these six states is called incomplete', () => {
    // Each negative above passes individually for a function that never fires. Counting both
    // outcomes in one pass is the cheapest proof this is not simply inert.
    const states = [
      { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 },        // the observed defect
      { manifestNodes: 2572, dbNodes: 2572, codeNodes: 1904 },   // healthy
      { manifestNodes: 90, dbNodes: 90, codeNodes: 0 },          // docs-only
      { manifestNodes: 2393, dbNodes: 2566, codeNodes: 0 },      // post-collection growth
      { manifestNodes: 2572, dbNodes: 2100, codeNodes: 1500 },   // short but holding code
      { manifestNodes: null, dbNodes: 90, codeNodes: 0 },        // unmeasured
    ];
    const fired = states.filter((integrity) => graphCapabilities({ indexed: true, integrity }).reason === 'index_incomplete');
    expect(fired).toHaveLength(1);
    expect(fired[0].dbNodes).toBe(90);
  });
});

// A COMPLETE COLLECTION IS NOT A CURRENT ONE.
// `coverage.complete` is a frozen fact about a moving corpus: it describes the collection at
// collection time. After that commit, every changed file loses its verified evidence on the next
// rebuild, because the per-file salvage gate drops it rather than re-stamp shifted line numbers.
// Measured on this repository — 121 commits past its collection, one reindex took the spine from
// 1,943 verified edges to 1,054 — while absenceAuthority was still being granted.
//
// `lsp-evidence` already renders "the set is a FLOOR, not exhaustive" once HEAD has moved. This flag
// disagreed with it, and of the two surfaces this is the one read before deleting code.
describe('absence authority requires a CURRENT collection, not just a complete one', () => {
  const complete = {
    indexed: true,
    collectionAvailable: true,
    language: 'cpp',
    languageHasServer: true,
    coverage: { complete: true },
    compilerVerifiedEdges: 1054,
  };

  it('POSITIVE CONTROL: a current, complete collection still grants authority', () => {
    // Without this the two assertions below would pass on a clause that denies unconditionally.
    const c = graphCapabilities({ ...complete, collectionCurrent: true });
    expect(c.absenceAuthority).toBe(true);
    expect(c.reason).toBeNull();
  });

  it('denies authority when the collection was taken at an older commit', () => {
    // Catches: granting "no callers" authority from evidence whose subject has moved.
    const c = graphCapabilities({ ...complete, collectionCurrent: false });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('collection_stale');
  });

  it('fails closed when collection currency is unknown', () => {
    // Catches: treating an unsupplied or unknowable commit as currency. Null is not evidence.
    const c = graphCapabilities({ ...complete });
    expect(c.absenceAuthority, 'unknown currency must not grant authority').toBe(false);
    expect(c.reason).toBe('collection_stale');
  });

  it('names the cause and a remedy rather than only refusing', () => {
    // Catches: a bare denial. A reason with no next action gets worked around, not acted on.
    const c = graphCapabilities({ ...complete, collectionCurrent: false });
    expect(c.nextAction).toMatch(/graph_collect_code_intel/);
    expect(c.nextAction, 'must say WHY it decayed').toMatch(/older commit/i);
    expect(c.nextAction, 'must tell the reader what the caller set is worth meanwhile').toMatch(/FLOOR/);
  });

  it('does not mask a more severe reason that was already firing', () => {
    // Catches: the new clause jumping the precedence order and hiding an empty trust spine.
    const c = graphCapabilities({ ...complete, compilerVerifiedEdges: 0, collectionCurrent: false });
    expect(c.reason).toBe('trust_spine_empty');
  });
});
