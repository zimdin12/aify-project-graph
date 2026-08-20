// ROUTE FROM THE VERB PEOPLE CALL TO THE ONES THEY SHOULD.
//
// Field accounting (ef-manager, 2026-07-30): "I used 2 verbs out of ~17. I never
// once called graph_packet or graph_pull — your documented front door — despite
// returning to a repo I hadn't touched in seven weeks, where orientation was
// literally my problem. Nothing in my workflow PULLED me toward them."
//
// That is a routing failure, not a capability failure, and no amount of correctness
// work touches it. Documentation does not pull; a suggestion at the moment of use
// does. graph_health is the one verb he DID reach for unprompted, so it is the only
// surface with standing to route.
//
// The suggestions must be DERIVED FROM MEASURED STATE, never generic advice —
// recommending graph_packet on a repo with no overlay would be noise, and noise
// here costs the routing its credibility on the repos where it is right.
import { describe, it, expect } from 'vitest';
import { buildNextActions } from '../../../mcp/stdio/query/verbs/health.js';

// ⚠ FIXTURES GAINED `coverage` WHEN "HEALTHY" GAINED A REQUIREMENT.
//
// These built `codeIntel: { available: true, lspVerifiedEdges: 900 }` and asserted silence. That
// stopped being a healthy state: a collection that does not record HOW MUCH of the repo it covered
// has UNKNOWN coverage, and unknown is not clean. The first real collection on this repo covered
// 3 files of 484 and produced `nextActions: []`, because "a collection exists" was the whole test.
//
// ⛔ AND THE ALTERNATIVE WAS WORSE. Treating an unrecorded coverage as complete is the two-state
// collapse — and it is not a permanent alarm either, because re-collecting resolves it. A warning
// that can be answered is a warning; one that cannot is noise.
const COMPLETE_COVERAGE = Object.freeze({
  filesProcessed: 484, filesInScope: 484, filesEligible: 484, complete: true,
});

describe('health next-action routing', () => {
  it('puts TRUST before orientation — a shortcut over an untrustworthy graph is worse than none', () => {
    const actions = buildNextActions({
      codeIntel: { available: true, compileDbDrifted: true, lspVerifiedEdges: 0 },
      overlayQuality: { featureCount: 16 },
      artifactAges: { functionality: 96 },
      briefStaleVsManifest: true,
      stale: false,
    });
    expect(actions[0].do).toMatch(/graph_collect_code_intel/);
    expect(actions[0].why).toMatch(/different compile DB/);
  });

  it('a STALE overlay produces a regenerate action, not a go-use-it one', () => {
    // ★ This test previously asserted the OPPOSITE and pinned a filler rule I
    // shipped an hour earlier: "this repo has 16 features → try graph_packet".
    // A field reviewer took it apart (ef-manager, 2026-07-31): inventory is not a
    // finding; the why said the overlay was 96 days stale while the do said go use
    // it; and it fired on a healthy repo, breaking the "empty on a healthy repo,
    // never generic" contract stated in the same function.
    //
    // Measured state still deserves an action — but the action the measurement
    // implies. A 96-day-old overlay means REGENERATE, not consume.
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 1507, coverage: COMPLETE_COVERAGE },
      overlayQuality: { featureCount: 16 },
      artifactAges: { functionality: 96 },
      stale: false,
    });
    const overlay = actions.find(a => a.why.includes('overlay'));
    expect(overlay).toBeTruthy();
    expect(overlay.why).toMatch(/96d old/);
    expect(overlay.do).toMatch(/regenerate/i);
    // The contradiction is the thing being prevented: do not tell someone to
    // consume an artifact you have just told them not to trust.
    expect(overlay.do).not.toMatch(/graph_packet/);
  });

  it('a FRESH overlay produces NOTHING — inventory is not a finding', () => {
    // The contract, now actually enforced: an empty nextActions on a healthy repo
    // is a stronger statement than a populated one, because it is what makes a
    // populated one mean something.
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 1507, coverage: COMPLETE_COVERAGE },
      overlayQuality: { featureCount: 16 },
      artifactAges: { functionality: 2 },
      stale: false,
      briefStaleVsManifest: false,
    });
    expect(actions).toEqual([]);
  });

  it('does NOT suggest graph_packet on a repo with no overlay — that would be noise', () => {
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 100 },
      overlayQuality: { featureCount: 0 },
      artifactAges: {},
      stale: false,
    });
    expect(actions.some(a => a.do.includes('graph_packet'))).toBe(false);
  });

  it('names the empty trust spine, and says the live verbs are unaffected', () => {
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 0 },
      overlayQuality: { featureCount: 0 },
      artifactAges: {},
      stale: false,
    });
    expect(actions[0].why).toMatch(/heuristic and cannot attest exhaustiveness/);
    expect(actions[0].do).toMatch(/live verbs are unaffected/);
  });

  it('offers the per-call fresh flag alongside graph_index when stale', () => {
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 5 },
      overlayQuality: { featureCount: 0 },
      artifactAges: {},
      stale: true,
    });
    expect(actions.some(a => a.do.includes('fresh:true'))).toBe(true);
  });

  it('caps at 3 — a list of ten suggestions is a list nobody reads', () => {
    const actions = buildNextActions({
      codeIntel: { available: false },
      overlayQuality: { featureCount: 16 },
      artifactAges: { functionality: 200 },
      briefStaleVsManifest: true,
      stale: true,
    });
    expect(actions.length).toBeLessThanOrEqual(3);
  });

  it('says nothing when there is nothing worth saying', () => {
    // Silence on a healthy repo is the whole reason the suggestions stay credible.
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 900, coverage: COMPLETE_COVERAGE },
      overlayQuality: { featureCount: 0 },
      artifactAges: {},
      stale: false,
      briefStaleVsManifest: false,
    });
    expect(actions).toEqual([]);
  });
});
