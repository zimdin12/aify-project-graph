// ⛔ AN EVIDENCE ARTIFACT THAT CANNOT SETTLE THE CLAIM IT CARRIES IS NOT EVIDENCE.
//
// ef-manager, grading the held-out doc-ref sample, hit row `qualified #14`: the artifact reported
// `target_label: auth_flow`, the BARE method name, while `worked/httpx/raw/auth.py` declares FIVE
// sibling `auth_flow` methods — on Auth, BasicAuth, BearerAuth, DigestAuth and NetRCAuth. From the
// row alone nobody could tell which one the edge bound.
//
// The resolver was innocent, and that was checked rather than assumed: `buildSymbolIndex` keys on
// the dotted qname tail and starts its loop at length-2, so `DigestAuth.auth_flow` and
// `BasicAuth.auth_flow` bind to DIFFERENT symbols and a bare `auth_flow` is not indexed at all.
//
// ⇒ SO THE HOLE WAS IN THE EVIDENCE, NOT THE CODE. A grader could score "did the author mean this
// element" but never "did we bind this element", and the qualified rule's entire premise is that
// the qualifier decides. Note the direction: an unverifiable row still gets a verdict, and the
// verdict flatters the tool.
//
// ⚠ THIS FILE WAS WRONG FIRST, and the suite-composition guard caught it. Every assertion matched
// SOURCE TEXT of the sampler — which cannot fail when the behaviour breaks and can fail when a
// line is reflowed. Rewriting it to exercise real code forced the better question: why was the
// sampler parsing qnames at all when `buildSymbolIndex` already did? It was a second copy. One
// `qnameOf` now serves both, and this tests that function rather than a string that mentions it.
import { describe, it, expect } from 'vitest';
import { qnameOf, buildSymbolIndex } from '../../../mcp/stdio/analysis/doc-refs.js';

describe('qnameOf is the one parse, and it fails toward blank', () => {
  it('★★★ it reads the qualified name a node carries', () => {
    expect(qnameOf('{"qname":"worked.httpx.raw.auth.DigestAuth.auth_flow"}'))
      .toBe('worked.httpx.raw.auth.DigestAuth.auth_flow');
  });

  it('★★★⛔ every unknown is null — never a bare label, never a throw', () => {
    // ⛔ A LABEL FALLBACK WOULD RECREATE THE DEFECT WHILE LOOKING LIKE THE FIX. `auth_flow` as a
    // qname is the same unusable string that made row #14 unverifiable, except delivered in a
    // field whose name promises a qualifier. A blank is honest; a wrong answer under a trusted
    // label is not. And a throw would take down the whole artifact over one malformed node.
    for (const extra of ['{}', '', null, undefined, '{ not json', '{"qname":""}', '{"qname":null}']) {
      expect(qnameOf(extra), `extra=${JSON.stringify(extra)}`).toBeNull();
    }
  });

  it('★★★ a non-string qname is coerced, not passed through raw', () => {
    // Node `extra` is written by extractors, not by this module, so its shape is an assumption.
    expect(qnameOf('{"qname":42}')).toBe('42');
  });
});

describe('the qualifier is what BINDS, which is why the artifact must show it', () => {
  it('★★★⛔ THE ROW THAT COULD NOT BE VERIFIED: five siblings, one binding each', () => {
    // ⛔ THE INDUCTION IS THE POINT. If only one `auth_flow` existed, `DigestAuth.auth_flow`
    // resolving to it would prove nothing at all about whether the qualifier was used. Five
    // siblings is what makes the discrimination observable — this is the real shape from
    // reference/graphify's vendored httpx copy, which is where the finding came from.
    const siblings = ['Auth', 'BasicAuth', 'BearerAuth', 'DigestAuth', 'NetRCAuth'].map((cls) => ({
      id: `id_${cls}`,
      type: 'Method',
      label: 'auth_flow',
      extra: `{"qname":"worked.httpx.raw.auth.${cls}.auth_flow"}`,
    }));
    const idx = buildSymbolIndex(siblings);

    expect(idx.get('DigestAuth.auth_flow'), 'the qualifier selects exactly one').toEqual(['id_DigestAuth']);
    expect(idx.get('BasicAuth.auth_flow')).toEqual(['id_BasicAuth']);
    expect(idx.get('DigestAuth.auth_flow')[0], 'and they are different symbols')
      .not.toBe(idx.get('BasicAuth.auth_flow')[0]);

    // ⛔ THE OTHER HALF. A bare method name is not indexed at all — so an artifact printing only
    // `auth_flow` shows a string that could not have been the lookup key. That is precisely why
    // the row was unverifiable, and why `target_qname` is not cosmetic.
    expect(idx.has('auth_flow'), 'a bare tail is excluded by construction').toBe(false);
  });

  it('★★★ NEGATIVE CONTROL: a node with no qname contributes nothing to the index', () => {
    // Without this, the index above is satisfied by one that admits everything it is given.
    expect(buildSymbolIndex([{ id: 'x', type: 'Method', label: 'auth_flow', extra: '{}' }]).size).toBe(0);
    expect(buildSymbolIndex([{ id: 'y', type: 'Method', label: 'f', extra: '{ broken' }]).size).toBe(0);
  });
});
