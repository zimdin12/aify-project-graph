// ⛔ THE DEFECT THESE GUARD, MEASURED ON THE REAL SERVER 2026-09-06.
//
// `graph_callers("has")` returns 25 caller rows at conf=0.90 and every one is a collision — verified
// in source: `communities.js` has no function named `has`, only `groups.has(rawId)` on a Map;
// `doc-links.js:182` builds a `new Map()` and calls `.has()` on it. No warning of any kind fired.
//
// ⭐ AND THE GUARD COULD NOT FIRE, BY CONSTRUCTION. The old trigger was:
//
//     (trust === 'weak' && resultCount < 10) || (occurrences >= 3 && resultCount < occurrences)
//
// Exactly ONE node in the graph is labelled `has`, so `occurrences = 1` kills the second clause, and
// the first requires FEWER than 10 results against 25+. The trigger encodes AMBIGUITY — many
// same-named symbols, few results. The real overcount is the mirror image: ONE symbol absorbing many
// spurious inbound edges from a builtin method name. The warning exists because of this exact symbol
// and could never fire on it. Second recorded instance of a hazard check missing the defect it was
// built from.
//
// Population measured before the threshold was chosen: leaf <= 4 chars AND fan-in >= 10 is 42 of
// 2578 symbols (1.6%), and the top of that set is join:755, trim:259, has:253, Set:182, all:159,
// Map:119 — every one a JavaScript builtin.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isOvercountSuspicious, leafName } from '../../../mcp/stdio/query/overcount-risk.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// The live shape of graph_callers("has"): one node labelled `has`, 25 heuristic rows, healthy trust.
const HAS = {
  trust: 'strong', resultCount: 25, occurrences: 1, symbol: 'has', hasVerifiedEdge: false,
};
// The live shape of graph_callers("inspectReadFreshness"): 25 genuine callers, distinctive name.
const GENUINE = {
  trust: 'strong', resultCount: 25, occurrences: 1, symbol: 'inspectReadFreshness', hasVerifiedEdge: false,
};

describe('the overcount guard fires on the shape it was written for', () => {
  it('★★★ THE REAL CASE: a short name with many heuristic callers is flagged', () => {
    const r = isOvercountSuspicious(HAS);
    expect(r.suspicious, 'graph_callers("has") must warn').toBe(true);
    expect(r.reason).toBe('short-name-overcount');
  });

  it('★★★ THE NEGATIVE CONTROL: a distinctive name with the SAME fan-in stays silent', () => {
    // ⛔ THE REQUIREMENT THAT MATTERS. Identical trust, identical resultCount, identical
    // occurrences — only the NAME differs. A guard that cannot separate these two is decoration,
    // and this repository has already had to tear out an always-on caveat.
    expect(isOvercountSuspicious(GENUINE).suspicious).toBe(false);
  });

  it('★★★ a COMPILER-RESOLVED result is never a name collision', () => {
    // Warning about an LSP-verified set would undercut the trust spine's entire point.
    expect(isOvercountSuspicious({ ...HAS, hasVerifiedEdge: true }).suspicious).toBe(false);
  });

  it('★★ the two ORIGINAL clauses still fire — this adds, it does not replace', () => {
    expect(isOvercountSuspicious({
      trust: 'weak', resultCount: 3, occurrences: 1, symbol: 'someLongName', hasVerifiedEdge: false,
    })).toMatchObject({ suspicious: true, reason: 'thin-on-weak-trust' });
    expect(isOvercountSuspicious({
      trust: 'strong', resultCount: 4, occurrences: 9, symbol: 'someLongName', hasVerifiedEdge: false,
    })).toMatchObject({ suspicious: true, reason: 'more-nodes-than-results' });
  });

  it('★★ the boundaries are where the preregistration put them', () => {
    // <= 4 chars and >= 10 results. Stated so a later reader can see the threshold was chosen, not
    // drifted into.
    expect(isOvercountSuspicious({ ...HAS, symbol: 'abcd', resultCount: 10 }).suspicious).toBe(true);
    expect(isOvercountSuspicious({ ...HAS, symbol: 'abcde', resultCount: 10 }).suspicious).toBe(false);
    expect(isOvercountSuspicious({ ...HAS, symbol: 'abcd', resultCount: 9 }).suspicious).toBe(false);
  });

  it('★★★ the leaf is what counts, not the qualified name', () => {
    // `mcp.stdio.query.verbs.collect_code_intel.has` is 40+ characters and its LEAF is `has`.
    // Measuring the qualified name would silently exempt every collision in a nested namespace.
    expect(leafName('mcp.stdio.query.verbs.collect_code_intel.has')).toBe('has');
    expect(leafName('ns::Widget::add')).toBe('add');
    expect(leafName('plain')).toBe('plain');
    expect(isOvercountSuspicious({ ...HAS, symbol: 'mcp.stdio.query.verbs.collect_code_intel.has' }).suspicious)
      .toBe(true);
  });

  it('★★★ BOTH verbs use the shared owner — the duplicate is why this defect had two homes', () => {
    // ⛔ callers.js and impact.js carried BYTE-IDENTICAL copies of the old heuristic, so the defect
    // existed twice. callers.js's own comment says why that matters: "One owner: fixing one verb and
    // pasting into the other is how the two drift apart."
    for (const rel of ['../../../mcp/stdio/query/verbs/callers.js', '../../../mcp/stdio/query/verbs/impact.js']) {
      const src = read(rel);
      expect(src, `${rel} must consult the shared guard`).toContain('isOvercountSuspicious');
      // The inlined predicate must be gone, not merely shadowed by the import.
      expect(src, `${rel} must not keep its own copy`).not.toContain('occurrences >= 3 && resultCount < occurrences');
    }
    // Live control: that string DOES exist in the module that now owns it, so its absence above is a
    // measured result and not a typo that can never match.
    expect(read('../../../mcp/stdio/query/overcount-risk.js')).toContain('occurrences >= 3');
  });
});
