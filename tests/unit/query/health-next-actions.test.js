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

  it('routes to graph_packet when the repo actually has features to orient with', () => {
    // The case that would have caught ef-manager: healthy trust, 16 mapped
    // features, and he never learned graph_packet existed for them.
    const actions = buildNextActions({
      codeIntel: { available: true, lspVerifiedEdges: 1507 },
      overlayQuality: { featureCount: 16 },
      artifactAges: { functionality: 96 },
      stale: false,
    });
    expect(actions.some(a => a.do.includes('graph_packet'))).toBe(true);
    // And it must carry the overlay's age, since a 96-day-old feature map is a
    // different proposition from a current one.
    expect(actions.find(a => a.do.includes('graph_packet')).why).toMatch(/96d old/);
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
      codeIntel: { available: true, lspVerifiedEdges: 900 },
      overlayQuality: { featureCount: 0 },
      artifactAges: {},
      stale: false,
      briefStaleVsManifest: false,
    });
    expect(actions).toEqual([]);
  });
});
