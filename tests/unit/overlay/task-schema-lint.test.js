// A DROPPED LINK IS NOT AN ABSENT LINK.
//
// Field report (2026-07-27): a tasks.json written with singular `feature: "auth"`
// produced ZERO feature links and NO warning anywhere. Every downstream count
// read "0 linked / N tasks" — indistinguishable from a genuinely unlinked
// backlog — so the user had no way to learn the key was simply misspelled.
//
// Two-part rule: read the shapes people actually write, and be LOUD about any
// feature key that was recognised-but-unusable or unrecognised.
import { describe, it, expect } from 'vitest';
import { taskFeatureRefs, lintTaskSchema } from '../../../mcp/stdio/overlay/quality.js';

describe('task→feature link schema', () => {
  it('reads the singular `feature` key that silently produced zero links', () => {
    expect(taskFeatureRefs({ id: 'T-1', feature: 'auth' })).toEqual(['auth']);
  });

  it('still prefers canonical `features` when both are present', () => {
    expect(taskFeatureRefs({ id: 'T-2', features: ['billing'], feature: 'auth' }))
      .toEqual(['billing']);
  });

  it('accepts feature_ids / feature_id and related_features', () => {
    expect(taskFeatureRefs({ feature_ids: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(taskFeatureRefs({ feature_id: 'c' })).toEqual(['c']);
    expect(taskFeatureRefs({ related_features: ['d'] })).toEqual(['d']);
  });

  it('stays quiet for a task with no feature key at all (genuinely unlinked)', () => {
    // Absence is a real state and must not be reported as a schema error.
    expect(lintTaskSchema([{ id: 'T-3', title: 'something' }])).toEqual([]);
  });

  it('names an unrecognised near-miss key instead of dropping it silently', () => {
    const findings = lintTaskSchema([{ id: 'T-4', featues: ['auth'] }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/T-4/);
    expect(findings[0]).toMatch(/featues/);
    expect(findings[0]).toMatch(/rename to "features"/);
  });

  it('names a recognised key with an unusable shape', () => {
    const findings = lintTaskSchema([{ id: 'T-5', features: {} }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/"features" is present but empty or not a string\/array/);
  });

  it('stays quiet once the link actually resolves', () => {
    expect(lintTaskSchema([{ id: 'T-6', feature: 'auth' }])).toEqual([]);
  });
});
