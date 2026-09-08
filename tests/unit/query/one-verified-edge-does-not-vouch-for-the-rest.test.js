// ⛔ ONE COMPILER-RESOLVED EDGE SILENCED THE COLLISION WARNING FOR A HUNDRED NAME-MATCHED ONES.
//
// The short-name overcount branch was gated on `!hasVerifiedEdge`, and `hasLspVerifiedEdge` is
// `edges.some(e => e.provenance === LSP_PROVENANCE)`. The comment above the gate says
//
//     "An LSP-verified SET was resolved by a compiler rather than by name, so it is not a
//      collision, and warning about one would undercut the trust spine's whole purpose."
//
// which is a correct argument about a SET. The predicate asks about ANY. So a result holding one
// verified edge and ninety-nine heuristic name matches — the exact shape `has` and `dir` produce on
// a C++ repository — was declared not-a-collision by its single good edge.
//
// ⭐ AND THE REPAIR IS NOT `.some()` -> `.every()`. That would swap one wrong population for
// another: it would silence the warning only when the set is perfectly clean, and shout on a set
// that is 99% compiler-resolved. The collision risk lives in the HEURISTIC edges specifically, so
// the question is how many of THOSE there are. The exemption then falls out for free: a fully
// verified set has zero unresolved edges and cannot trip it.
import { describe, it, expect } from 'vitest';
import { isOvercountSuspicious } from '../../../mcp/stdio/query/overcount-risk.js';

// A short leaf name with a large result set: the collision shape.
const SHORT = { trust: 'strong', symbol: 'has', occurrences: 1 };

describe('a verified edge vouches for itself, not for its neighbours', () => {
  it('★★★ THE REAL CASE: 1 verified + 99 heuristic still warns', () => {
    const r = isOvercountSuspicious({ ...SHORT, resultCount: 100, verifiedCount: 1 });

    expect(r.suspicious).toBe(true);
    expect(r.reason).toBe('short-name-overcount');
  });

  it('★★★ THE EXEMPTION SURVIVES: a fully compiler-resolved set is not a collision', () => {
    // This is what the original gate was protecting, and it must keep working — warning about a
    // set clangd resolved would undercut the trust spine this project is built on.
    const r = isOvercountSuspicious({ ...SHORT, resultCount: 100, verifiedCount: 100 });

    expect(r.suspicious).toBe(false);
  });

  it('★★★ THE DISCRIMINATING CONTROL: a long name with the same mix does NOT warn', () => {
    // Without this, a predicate that simply always warned would pass both tests above. The branch
    // is about SHORT leaf names, and that has to still be what decides it.
    const r = isOvercountSuspicious({
      ...SHORT, symbol: 'authenticateUserSession', resultCount: 100, verifiedCount: 1,
    });

    expect(r.suspicious).toBe(false);
  });

  it('★★ a small heuristic set does not warn, however short the name', () => {
    // The other half of the shape: the branch needs BOTH a short name and enough unresolved
    // results. Ten name matches on `has` is not the hundred-fold collision this exists to catch.
    const r = isOvercountSuspicious({ ...SHORT, resultCount: 3, verifiedCount: 0 });

    expect(r.suspicious).toBe(false);
  });

  it('★★ MOSTLY verified is still exempt — the count is what decides, not the presence', () => {
    // 98 of 100 resolved by a compiler leaves 2 name-matched edges, which is not a collision set.
    // This is the case `.every()` would have got wrong in the opposite direction.
    const r = isOvercountSuspicious({ ...SHORT, resultCount: 100, verifiedCount: 98 });

    expect(r.suspicious).toBe(false);
  });
});
