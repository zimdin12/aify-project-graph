// ⛔⛔ A MULTI-LINE ANCHOR MUST RESOLVE AGAINST A CRLF FILE, AND THE MUTATION MUST NOT LEAVE A STRAY \r.
//
// Named by dashboard-manager 2026-09-29 from a live instance on their tree: two anchors stopped resolving
// with THE CODE THEY NAME COMPLETELY UNCHANGED, because the file had become CRLF and every `\n` in a
// committed multi-line span matched nothing.
//
// ⇒ THE VERDICT IS THE EXPENSIVE PART. `absent` reads as "a stale spec pointing at deleted code". It
// sends you looking for a refactor that never happened, and the honest-looking repair is to re-aim the
// anchor at whatever is there now — silently replacing one measurement with a different one.
//
// ⚠ IT WAS LATENT HERE, NOT FIRING, and the arms below say so rather than implying a rescue: 10 of the 35
// declared specs carry multi-line anchors and every one happens to target an LF file, so all 35 resolved
// `unique`. But the repo is MIXED — 122 pure-CRLF tracked .js/.mjs files against 799 LF — so the green was
// luck about which files those ten point at, and one Windows editor touching any of them would have turned
// a passing spec into a false "stale spec" report.
import { describe, it, expect } from 'vitest';
import { resolveAnchor, applyAnchor } from '../../../scripts/lib/anchor.mjs';

const LF_SOURCE = [
  'function keep() {',
  '  const a = 1;',
  '  const b = 2;',
  '  return a + b;',
  '}',
  '',
].join('\n');

const CRLF_SOURCE = LF_SOURCE.replace(/\n/gu, '\r\n');
// The anchor as a plan file would carry it: written with `\n`, spanning two lines.
const MULTILINE_ANCHOR = '  const a = 1;\n  const b = 2;';

describe("an anchor matches in the file's own line endings", () => {
  it('★★★ POSITIVE CONTROL — the anchor genuinely resolves in the LF form', () => {
    // Without this, every arm below could pass for an anchor that was never resolvable at all.
    const r = resolveAnchor(LF_SOURCE, MULTILINE_ANCHOR);
    expect(r.state, 'the anchor must be resolvable somewhere, or the fixture is the bug').toBe('unique');
  });

  it('★★★ the SAME span resolves when the file is CRLF — this is the arm that was red', () => {
    const r = resolveAnchor(CRLF_SOURCE, MULTILINE_ANCHOR);
    expect(r.state, 'a file differing only in line endings names the same code').toBe('unique');
  });

  it('★★★ NEGATIVE CONTROL — a genuinely absent span is still reported absent', () => {
    // A resolver that "helpfully" matched anything would pass the arm above and be useless. Both
    // directions, because a fix that can no longer say ABSENT cannot say PRESENT either.
    expect(resolveAnchor(CRLF_SOURCE, 'const zzq = 99;').state).toBe('absent');
    expect(resolveAnchor(LF_SOURCE, '  const a = 1;\n  const zzq = 2;').state).toBe('absent');
  });

  // ⚠ NAMED FOR WHAT IT ASSERTS. It was "leaves NO stray carriage return" until the mutation run showed
  // that no stray CR is produced by either the correct code OR the bug, so the title described a property
  // nothing here tests and the load-bearing assertion is the byte-for-byte one.
  it('★★★ applying to a CRLF file yields exactly the expected bytes, with the span fully removed', () => {
    // ⛔ THE FAILURE THIS ARM EXISTS FOR IS WORSE THAN THE ONE ABOVE. Resolving by a converted variant
    // while splicing by `anchor.length` removes one byte per line too few, so the replacement lands with
    // an orphaned `\r` on every line of the span — a mutation that reports `applied: true` and corrupts
    // the file. An `absent` is at least loud.
    const result = applyAnchor(CRLF_SOURCE, MULTILINE_ANCHOR, '  const merged = 3;');
    expect(result.applied).toBe(true);
    expect(result.after).toContain('  const merged = 3;');
    expect(result.after, 'the replaced span must be gone').not.toContain('const a = 1;');
    // ⚠ THE FIRST VERSION OF THIS ASSERTION WENT RED AGAINST CORRECT CODE, which is worth recording
    // because a red for the wrong reason costs exactly what a green for the wrong reason does. It matched
    // `/\r\s*const merged = 3;/` — and `\s` matches `\n`, so it flagged the PRECEDING LINE'S legitimate
    // `\r\n` as an orphan. Measured before changing anything: the output was already clean.
    //
    // ⇒ The property is not "no \r near the replacement", it is A LONE CR ANYWHERE — a `\r` not followed
    // by `\n`. That is what corruption looks like, and it is a whole-string property rather than a
    // neighbourhood one, so it is both correct and stricter than what it replaced.
    expect(/\r(?!\n)/u.test(result.after), 'a lone CR anywhere is corruption').toBe(false);
    expect(/(?:^|[^\r])\n/u.test(result.after), 'and no bare LF smuggled into a CRLF file').toBe(false);

    // ⛔⛔ THE ARM THAT ACTUALLY CATCHES THE SPLICE-LENGTH BUG, and it exists because the two assertions
    // above DO NOT. Watched: reverting the splice to `anchor.length` left every assertion above green.
    //
    // MEASURED, having first described this wrongly: splicing `anchor.length` when the match is longer by
    // k removes k bytes too few and leaves THE LAST k BYTES OF THE SPAN behind — `  const merged = 3;;`,
    // a doubled semicolon. No lone CR is produced, so a CR-shaped assertion is structurally blind to it.
    //
    // ⇒ So the expectation is the WHOLE resulting string, built independently from the fixture rather
    // than by reasoning about what should have changed. An exact-equality arm cannot be off by k.
    const expected = [
      'function keep() {',
      '  const merged = 3;',
      '  return a + b;',
      '}',
      '',
    ].join('\r\n');
    expect(result.after, 'the whole file, byte for byte — an off-by-k splice cannot survive this')
      .toBe(expected);
    // And the untouched lines keep their CRLF, so the fix did not silently rewrite the whole file.
    expect(result.after).toContain('function keep() {\r\n');
  });

  it('★★★ a span appearing as BOTH LF and CRLF in one mixed file is a DUPLICATE, never a unique match', () => {
    // ⛔ THE HAZARD THE FIX COULD HAVE RE-INTRODUCED. Trying the raw anchor and falling back to the
    // converted form would accept whichever matched first and report `unique` — re-opening the
    // duplicate-anchor hole this module exists to close, through the fix for a different hole. Counting
    // both variants into one occurrence list is what makes this arm pass.
    const mixed = `${LF_SOURCE}\n${CRLF_SOURCE}`;
    const r = resolveAnchor(mixed, MULTILINE_ANCHOR);
    expect(r.state, 'two spellings of the same span are still two sites').toBe('duplicate');
    expect(r.occurrences?.length).toBe(2);
  });

  it('★★★ converting is idempotent — an anchor already carrying CRLF is not mangled to \\r\\r\\n', () => {
    const crlfAnchor = MULTILINE_ANCHOR.replace(/\n/gu, '\r\n');
    expect(resolveAnchor(CRLF_SOURCE, crlfAnchor).state, 'CRLF anchor against CRLF source').toBe('unique');
    expect(resolveAnchor(LF_SOURCE, crlfAnchor).state, 'and against LF source too').toBe('unique');
  });

  it('★★★ single-line anchors are unaffected — the fix must not change what already worked', () => {
    expect(resolveAnchor(LF_SOURCE, 'const a = 1;').state).toBe('unique');
    expect(resolveAnchor(CRLF_SOURCE, 'const a = 1;').state).toBe('unique');
    const applied = applyAnchor(LF_SOURCE, 'const a = 1;', 'const a = 42;');
    expect(applied.applied).toBe(true);
    expect(applied.after).toContain('const a = 42;');
  });
});
