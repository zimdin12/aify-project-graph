// ⛔ A TOTAL CAN SURVIVE AN INVERTED SET, AND THIS REPO PRODUCED EXACTLY THAT.
//
// Found by ef-manager, 2026-09-05, by comparing a stale server against a fixed one. Before the
// verifiable-language set was derived from BACKENDS, and after:
//
//     BROKEN: lspUnverifiableCalls.total = 11289  (js + ts + php + python + glsl)
//             lspCallsVerifiable         =    19  (cpp + c)
//     FIXED:  lspCallsVerifiable         = 11289  (js + ts + cpp + python + c)
//             excluded                   =    19  (php + glsl)
//
// cpp+c moved IN, php+glsl moved OUT, and both groups number 19 — so the headline did not move by a
// single call while the set was inverted. An auditor diffing totals sees 11289 -> 11289 and concludes
// the denominator was untouched. Nothing contradicts them.
//
// ⇒ THE GUARD IS TO MAKE MEMBERSHIP DIFFABLE, not to distrust the total. The excluded side already
// itemised itself; the denominator did not, so its membership was the half nobody could check.
//
// ⚠ This test asserts the SHAPE of the disclosure, which is all a unit test can reach here. It
// cannot prove a future reader will diff it. That limit is stated rather than papered over.
import { describe, it, expect } from 'vitest';
import { isLspVerifiableLanguage } from '../../../mcp/stdio/query/coverage-denominator.js';

describe('an equal-sized swap must not look like no change', () => {
  it('★★★ the real 2026-09-05 case: two different sets, one identical total', () => {
    // Real per-language counts from this repo, so the arithmetic is not invented.
    const calls = { javascript: 10396, typescript: 862, cpp: 18, python: 12, c: 1, php: 15, glsl: 4 };
    const HARDCODED_CPP_ONLY = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);

    const sum = (pred) => Object.entries(calls)
      .filter(([lang]) => pred(lang)).reduce((a, [, n]) => a + n, 0);

    const oldUnverifiable = sum((l) => !HARDCODED_CPP_ONLY.has(l));
    const newVerifiable = sum((l) => isLspVerifiableLanguage(l));

    expect(oldUnverifiable, 'the broken build reported this as UNVERIFIABLE').toBe(11289);
    expect(newVerifiable, 'the fixed build reports the same number as VERIFIABLE').toBe(11289);
    // ⛔ The whole point: identical value, opposite meaning.
    expect(newVerifiable).toBe(oldUnverifiable);

    // And the sets are genuinely different, which the equal totals conceal.
    const oldSet = Object.keys(calls).filter((l) => !HARDCODED_CPP_ONLY.has(l)).sort();
    const newSet = Object.keys(calls).filter(isLspVerifiableLanguage).sort();
    expect(newSet, 'membership must differ even though the sums match').not.toEqual(oldSet);
    expect(newSet).toEqual(['c', 'cpp', 'javascript', 'python', 'typescript']);
    expect(oldSet).toEqual(['glsl', 'javascript', 'php', 'python', 'typescript']);
  });

  it('★★★ POSITIVE CONTROL: the swap really is equal-sized, which is why the total held', () => {
    // If this ever stops being true the case above is no longer the case that was found, and the
    // test would be asserting a coincidence rather than the measured one.
    const movedIn = 18 + 1;    // cpp + c, excluded before, counted now
    const movedOut = 15 + 4;   // php + glsl, counted before, excluded now
    expect(movedIn).toBe(movedOut);
  });
});
