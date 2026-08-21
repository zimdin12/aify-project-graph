// ⛔ THE INVENTORY IS AN INSTRUMENT, SO IT GETS THE SAME CONTROLS I DEMAND OF EVERYTHING ELSE.
//
// A detector that finds nothing and a detector that cannot find anything produce the same output.
// Every category below is exercised in BOTH directions: a shape it must catch, and a nearby shape
// it must NOT catch.
//
// ⛔⛔ AND THE CONTROL THAT ACTUALLY MATTERED: my first version MISSED THE DEFECT IT WAS BUILT FROM.
// The live-instance control passed (it found safeDirtyCount), so nothing would have revealed the
// hole. Only running it against the PRE-FIX source of refactor-guard exposed it: the original was
// `entry.volatileShapeOk = excluded.every(...)`, a plain ASSIGNMENT, and I had handled variable
// declarations and object-literal properties and forgotten assignment entirely. It returned ZERO
// while the defect sat there twice.
//
// ⇒ A tool for finding vacuous checks was itself vacuous. Test an instrument against the case that
// motivated it, not merely against a case it happens to catch.
import { describe, it, expect } from 'vitest';
import {
  vacuousQuantifiers, failOpenCatches, selfReportingLiterals, NOT_IMPLEMENTED,
} from '../../../scripts/lib/hazard-detectors.mjs';

describe('vacuous quantifiers', () => {
  it('★★★⛔ THE ORIGINAL DEFECT, in its original form: assignment to a property', () => {
    // Byte-for-byte the shape from refactor-guard before the fix. Verified against the real
    // pre-fix source at cba2974^, which yielded exactly 2 hits at lines 213 and 238.
    const hits = vacuousQuantifiers('entry.volatileShapeOk = excluded.every((l) => VOLATILE_LINE.test(l));');
    expect(hits.length, 'the shape the tool exists for must be caught').toBe(1);
    expect(hits[0].quantifier).toBe('every');
    expect(hits[0].context).toMatch(/assigned to entry\.volatileShapeOk/);
    expect(hits[0].question).toMatch(/is EMPTY, this yields true/);
  });

  it('★★★ THE REPAIRED COUNTERPART: the fixed form is NOT flagged', () => {
    // ⛔ THE PAIR IS THE FIXTURE, not the defect alone. A detector holding only the broken form can
    // pass by flagging everything; a detector holding only the fixed form can pass by flagging
    // nothing. Frozen together, they pin the DISCRIMINATION rather than either half of it.
    //
    // This is the shape refactor-guard actually carries now: the quantifier moved behind a named
    // predicate that requires exact cardinality, so there is no bare quantifier left to be vacuous.
    expect(vacuousQuantifiers('entry.volatileShapeOk = volatileShapeOk(excluded);')).toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: every gate context is recognised', () => {
    // Enumerating the contexts I could think of is how the assignment case got missed, so each one
    // that IS handled is pinned. A context silently dropped later would otherwise read as "clean".
    const cases = {
      'return xs.every(p);': /returned/,
      'if (xs.every(p)) { go(); }': /if-condition/,
      'const ok = xs.every(p);': /assigned to `ok`/,
      'const o = { ok: xs.every(p) };': /assigned to property `ok`/,
      'obj.flag = xs.every(p);': /assigned to obj\.flag/,
      'const y = xs.every(p) && z;': /boolean operand/,
      'if (!xs.every(p)) fail();': /negated/,
      'const f = () => xs.every(p);': /arrow body/,
    };
    for (const [src, want] of Object.entries(cases)) {
      const h = vacuousQuantifiers(src);
      expect(h.length, src).toBe(1);
      expect(h[0].context, src).toMatch(want);
    }
  });

  it('★★★ NEGATIVE CONTROL: a quantifier used as DATA is not a gate', () => {
    // ⛔ Without this the detector is satisfied by one that flags every `.every()` in the repo,
    // which would be 100% recall and no signal — the muted-detector failure.
    expect(vacuousQuantifiers('console.log(xs.every(p));')).toEqual([]);
    expect(vacuousQuantifiers('send(xs.every(p));')).toEqual([]);
  });

  it('★★★ .some() is reported too, but its empty case yields FALSE — the other direction', () => {
    // ⚠ `[].every()` is TRUE, so it fails OPEN — the dangerous direction. `[].some()` is FALSE and
    // usually fails closed. Both are answers nobody computed, so both are reported; the question
    // text is what distinguishes them for the reader.
    const some = vacuousQuantifiers('const any = xs.some(p);');
    expect(some[0].quantifier).toBe('some');
    expect(some[0].question).toMatch(/is EMPTY, this yields false/);
  });

  it('★★★⛔ an unparsable source THROWS rather than reporting a reassuring zero', () => {
    expect(() => vacuousQuantifiers('function ( {{{ broken')).toThrow(/did not parse cleanly/);
  });
});

describe('fail-open catches', () => {
  it('★★★⛔ THE LIVE INSTANCE: safeDirtyCount returns 0 when the git query fails', () => {
    // Found in the real corpus at mcp/stdio/query/verbs/packet-input.js:143. A failed git query
    // reports ZERO DIRTY FILES, indistinguishable from a clean tree, while the same output line
    // already uses `?` for an unknown commit.
    const hits = failOpenCatches('function f() { try { return g().length; } catch { return 0; } }');
    expect(hits.length).toBe(1);
    expect(hits[0].returns).toBe('0');
    expect(hits[0].question).toMatch(/Can a caller tell that apart from a genuine 0/);
  });

  it('★★★ THE REPAIRED COUNTERPART, now real: safeDirtyCount returns null for unknown', () => {
    // ⚠ THIS TEST USED TO SAY THE PAIR WAS INCOMPLETE, and it was right at the time: the motivating
    // defect was still live, so there was no repaired form to freeze beside it. Inventing a
    // plausible one would have made the pair look complete when half of it was imaginary — the
    // false-completeness this inventory exists to prevent, and worse inside an instrument.
    //
    // ⇒ safeDirtyCount has landed. This is its ACTUAL repaired shape, so the pair is now genuine
    // rather than promised: the broken form is flagged, the shipped form is not.
    expect(failOpenCatches('function f(r) { try { return g(r).length; } catch { return null; } }'),
      'null is a typed unknown, not a success-shaped literal').toEqual([]);
    expect(failOpenCatches("function f(){ try { return g(); } catch { return '?'; } }"),
      'and so is the ? marker this repo already uses for an unknown commit').toEqual([]);
    expect(failOpenCatches('function f(r) { try { return g(r).length; } catch { return 0; } }').length,
      'while the ORIGINAL broken form is still caught — the other half of the pair').toBe(1);
  });

  it('★★★ POSITIVE CONTROL: every success-shaped literal is caught', () => {
    for (const [ret, want] of [['0', '0'], ['true', 'true'], ['[]', '[]'], ['{}', '{}'], ["''", "''"]]) {
      const h = failOpenCatches(`function f(){ try { g(); } catch { return ${ret}; } }`);
      expect(h.length, ret).toBe(1);
      expect(h[0].returns, ret).toBe(want);
    }
  });

  it('★★★ NEGATIVE CONTROL: an HONEST catch is not flagged', () => {
    // ⛔ These are the correct patterns. Flagging them would train the reader to ignore the tool.
    expect(failOpenCatches('function f(){ try { g(); } catch { return null; } }'),
      'null is an explicit unknown, not a success').toEqual([]);
    expect(failOpenCatches("function f(){ try { g(); } catch { return '?'; } }"),
      "'?' is the honest marker this repo already uses").toEqual([]);
    expect(failOpenCatches('function f(){ try { g(); } catch (e) { throw e; } }'),
      'rethrowing is not failing open').toEqual([]);
    expect(failOpenCatches('function f(){ try { g(); } catch { log(); return 0; } }'),
      'a catch that does something else first needs a human, not this rule').toEqual([]);
  });
});

describe('the inventory is honest about what it does not do', () => {
  it('★★★ the unimplemented categories are NAMED, with reasons', () => {
    // ⚠ A tool silent about its blind spots reads as coverage. Two of the six requested categories
    // are not implemented and both say why in the artifact itself.
    expect(NOT_IMPLEMENTED.length).toBe(2);
    for (const n of NOT_IMPLEMENTED) {
      expect(n.category.length).toBeGreaterThan(10);
      expect(n.why.length, `${n.category} must carry a real reason`).toBeGreaterThan(80);
    }
  });

  it('★★★ the disabled category still WORKS — it is suppressed on noise, not broken', () => {
    // ⛔ The distinction matters. "Disabled because it is too noisy here" is a measurement;
    // "disabled because it never worked" would be a different claim entirely. It finds the real
    // instance that motivated the category.
    const hits = selfReportingLiterals('const r = { allowed: true, stillBlocksNewRuns: true };');
    expect(hits.map((h) => h.key)).toContain('stillBlocksNewRuns');
    expect(hits[0].question).toMatch(/Does anything DECIDE on it/);
  });
});
