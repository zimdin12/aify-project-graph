// ⛔ `push(...arr)` IS BOUNDED BY THE ARGUMENT LIMIT, NOT BY MEMORY.
//
// Found by pointing the indexer at a repository it had never seen. `reference/graphify` — 332
// source files, Apache-2.0, vendored — died with `RangeError: Maximum call stack size exceeded`
// inside orchestrator.commitPending, which contains no recursion at all. The message names the
// stack because every element of the spread array becomes a separate ARGUMENT.
//
// ⚠ THE LIMIT IS NOT A CONSTANT, which is why the fix is structural rather than a size check. It
// is whatever is left of the stack at that call site, so it moves with call depth, engine version
// and platform. THE_LIMIT below is MEASURED at test time rather than hardcoded, because a number
// frozen from one machine would quietly stop being the boundary it claims to be.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appendAll } from '../../../mcp/stdio/util/append-all.js';

// Binary-search the real boundary on THIS runtime, at THIS stack depth. Doing it here rather than
// asserting a literal is the difference between a control and a souvenir.
function measureSpreadLimit() {
  const ok = (n) => {
    const src = new Array(n).fill(0);
    const dst = [];
    try { dst.push(...src); return true; } catch { return false; }
  };
  let lo = 1;
  let hi = 4_000_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const THE_LIMIT = measureSpreadLimit();

describe('the crash is real, and it is reachable', () => {
  it('★★★⛔ POSITIVE CONTROL ON THE INSTRUMENT: push(...) genuinely throws past the limit', () => {
    // ⛔ Without this, every assertion below is satisfied by a runtime where spread never fails —
    // and "appendAll did not throw" would be evidence of nothing whatsoever. The induction has to
    // be shown to fire before its absence means anything.
    expect(THE_LIMIT, 'the limit must be a real, finite boundary').toBeGreaterThan(1000);
    expect(THE_LIMIT).toBeLessThan(4_000_000);
    const src = new Array(THE_LIMIT + 1).fill(0);
    expect(() => { const d = []; d.push(...src); },
      'one element past the measured boundary must fail').toThrow(RangeError);
  });

  it('★★★ and the failure message says STACK, not size — why it reads as runaway recursion', () => {
    // Worth pinning: this is the reason the defect was misdiagnosable. commitPending has no
    // recursion in it, so the message points away from the actual cause.
    let caught;
    try { const d = []; d.push(...new Array(THE_LIMIT + 1).fill(0)); } catch (e) { caught = e; }
    expect(String(caught.message)).toMatch(/call stack/i);
  });
});

describe('appendAll survives what push cannot', () => {
  it('★★★⛔ THE FIX: well past the limit, and every element arrives', () => {
    const n = THE_LIMIT + 50_000;
    const src = new Array(n).fill(7);
    const dst = [];
    expect(() => appendAll(dst, src)).not.toThrow();
    expect(dst.length, 'survival is not enough — the data must all be there').toBe(n);
    expect(dst.every((v) => v === 7)).toBe(true);
  });

  it('★★★⛔ ORDER IS PRESERVED ACROSS THE BATCH SEAM', () => {
    // ⛔ THE FAILURE MODE A LENGTH CHECK CANNOT SEE. Batching is where an off-by-one silently
    // reorders or drops a window, and `length` would still be right if a batch were duplicated
    // and another skipped. These are unresolved-reference records whose order feeds resolution,
    // so a scrambled append is a wrong graph rather than a crash — the quieter, worse outcome.
    const n = THE_LIMIT + 3;
    const src = Array.from({ length: n }, (_, i) => i);
    const dst = [];
    appendAll(dst, src);
    expect(dst.length).toBe(n);
    for (const i of [0, 1, 8191, 8192, 8193, 16_383, 16_384, n - 2, n - 1]) {
      expect(dst[i], `element ${i} must be itself, not a neighbour`).toBe(i);
    }
  });

  it('★★★ it APPENDS — it does not replace what was already there', () => {
    const dst = ['a', 'b'];
    appendAll(dst, new Array(THE_LIMIT + 1).fill('x'));
    expect(dst[0]).toBe('a');
    expect(dst[1]).toBe('b');
    expect(dst[2]).toBe('x');
    expect(dst.length).toBe(THE_LIMIT + 3);
  });
});

describe('the ordinary cases are unchanged', () => {
  it('★★★ NEGATIVE CONTROL: small arrays behave exactly like push(...)', () => {
    // ⛔ Without this, the batching above is satisfied by an implementation that mangles every
    // short append — which is most appends in the codebase.
    for (const src of [[], [1], [1, 2, 3], ['a', null, undefined, 0, false]]) {
      const viaSpread = ['seed'];
      viaSpread.push(...src);
      const viaHelper = appendAll(['seed'], src);
      expect(viaHelper, JSON.stringify(src)).toEqual(viaSpread);
    }
  });

  it('★★★ a null or undefined source is a no-op, not a throw', () => {
    // These call sites append the result of an extraction that may legitimately produce nothing.
    expect(appendAll(['a'], null)).toEqual(['a']);
    expect(appendAll(['a'], undefined)).toEqual(['a']);
  });

  it('★★★ non-array iterables are accepted', () => {
    expect(appendAll([], new Set([1, 2, 2, 3]))).toEqual([1, 2, 3]);
    expect(appendAll([], (function* g() { yield 'x'; yield 'y'; }()))).toEqual(['x', 'y']);
  });

  it('★★★ it returns the target, so it can be chained', () => {
    const dst = [];
    expect(appendAll(dst, [1])).toBe(dst);
  });
});

// ⛔ A STRUCTURAL GUARD, AND ITS LIMIT STATED BEFORE ITS ASSERTIONS.
//
// The tests above prove the HELPER. They do not prove the orchestrator uses it, and I could not
// build a synthetic repository that reproduces the crash through the real orchestrator — twice:
//
//   · one 2.25MB file with 140k calls → SKIPPED by the 1MB cap at orchestrator.js:505, nodes=2
//   · 400 files × 400 calls (~160k)   → unresolved=0, and 17s, which is too slow for a unit test
//
// So the only end-to-end proof is a real one: `reference/graphify` went from
// `RangeError: Maximum call stack size exceeded` to 9,326 nodes at commit b14b52e. That is PROVEN
// on the real system and it is NOT REPLAYABLE HERE, because `reference/` is gitignored and absent
// from a fresh clone. Reading these assertions as end-to-end coverage would be reading them wrong.
//
// ⇒ What this can do is stop a silent regression at review time. It asks the source whether the
// three accumulators that scale with the corpus still go through appendAll.
describe('the orchestrator accumulators do not regress to spread', () => {
  const src = () => readFileSync('mcp/stdio/freshness/orchestrator.js', 'utf8');

  // ⛔ SUBSTRING MATCHING, DELIBERATELY, AND THE REASON IS A SCAR ON THIS VERY TEST.
  //
  // The first version built these needles with `new RegExp(\`\\b${name}\\.push\\(\\.\\.\\.\`)`,
  // written through a shell heredoc that ate one level of backslashes. `\\b` arrived as `\b` —
  // which inside a template literal is a literal BACKSPACE byte (0x08), not a word boundary — and
  // `\\(\\.\\.\\.` collapsed to `(...`, an unterminated group.
  //
  // ⚠ IT FAILED LOUDLY ONLY BY LUCK. The broken group threw at construction. Had the mangling
  // produced a VALID regex containing a backspace character, it would have matched nothing, in
  // silence, and reported the source as clean forever. This exact failure is recorded in this
  // repo's own tests/helpers/live-matcher.js header — I reproduced a documented incident.
  //
  // ⇒ A plain `includes` has no escaping layer to lose, so there is nothing for a shell, a
  // heredoc or a template literal to eat.
  const spreadNeedle = (name) => `${name}.push(...`;

  it('★★★⛔ the three corpus-scaled appends use appendAll, not push(...)', () => {
    const s = src();
    for (const accumulator of ['refs', 'pendingRefs', 'files']) {
      expect(s.includes(spreadNeedle(accumulator)),
        `${accumulator}.push(...) is bounded by the argument limit, not by memory`).toBe(false);
    }
    expect((s.match(/appendAll\(/g) ?? []).length,
      'and all three call sites are present — a count, so deleting one is not silent').toBe(3);
  });

  it('★★★ POSITIVE CONTROL: the needle would catch the shape if it came back', () => {
    // ⛔ Without this, the three negatives above pass just as well against a needle that can never
    // match anything — which is precisely what the first version of this test shipped as.
    for (const accumulator of ['refs', 'pendingRefs', 'files']) {
      expect(`        ${accumulator}.push(...pending);`.includes(spreadNeedle(accumulator)),
        `the needle for ${accumulator} must match the forbidden shape`).toBe(true);
    }
    // NEGATIVE CONTROL: it must not fire on the repaired form, or it would forbid the fix itself.
    expect('        appendAll(refs, pendingRefs);'.includes(spreadNeedle('refs'))).toBe(false);
  });
});
