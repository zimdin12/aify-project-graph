// THE FIXTURE MATRIX FOR A PARSER THAT BROKE ORDINARY SUCCESS.
//
// `suite-receipt.mjs` read each category with its own regex and defaulted to -1 when a token
// was absent. Vitest OMITS zero categories, so an all-green run had no `failed` token, `failed`
// became -1, and the nonnegative gate refused. **The fix for "unparseable output exits 0"
// made a passing suite unable to emit a receipt** — and it never showed locally because every
// run since had refused earlier at the dirty-tree gate. review, hermes session found it from
// the source and required exactly this matrix.
//
// ★ Every line below is a real Vitest summary shape. The point is that an ABSENT category is
// zero only after the WHOLE line is recognised — never inferred from a failed token match.
import { describe, it, expect } from 'vitest';
import { parseSummaryLine } from '../../scripts/summary-grammar.mjs';

const files = (s) => parseSummaryLine('Test Files', s);
const tests = (s) => parseSummaryLine('Tests', s);

describe('omitted zero categories are ZERO, once the line is recognised', () => {
  it('★★ all green, no skips — the exact shape that could not emit', () => {
    const r = files(' Test Files  240 passed (240)');
    expect(r.recognised).toBe(true);
    expect(r.passed).toBe(240);
    expect(r.failed, 'an omitted category is 0, NOT -1').toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.total).toBe(240);
  });

  it('★★ all green with skips', () => {
    const r = tests(' Tests  1778 passed | 3 skipped (1781)');
    expect(r.recognised).toBe(true);
    expect(r.passed).toBe(1778);
    expect(r.skipped).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.total).toBe(1781);
  });

  it('★★ failures present', () => {
    const r = tests(' Tests  2 failed | 1776 passed (1778)');
    expect(r.recognised).toBe(true);
    expect(r.failed).toBe(2);
    expect(r.passed).toBe(1776);
    expect(r.total).toBe(1778);
  });

  it('★★ todo is carried, not dropped into the reconciliation gap', () => {
    const r = tests(' Tests  10 passed | 1 todo (11)');
    expect(r.recognised).toBe(true);
    expect(r.todo).toBe(1);
    expect(r.total).toBe(11);
  });

  it('★★ the two labels do not capture each other', () => {
    const both = ' Test Files  240 passed (240)\n Tests  1778 passed | 3 skipped (1781)';
    expect(files(both).total).toBe(240);
    expect(tests(both).total).toBe(1781);
  });
});

describe('an incompletely understood line is REFUSED, not partially believed', () => {
  it('★★ categories that do not sum to the reporter total', () => {
    // The reporter says 300; the parts say 240. Something in the grammar was missed, and the
    // honest response is refusal — not publishing the parts that happened to match.
    const r = files(' Test Files  240 passed (300)');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/sum to 240, reporter says 300/);
  });

  it('★★ an unparsed segment refuses the whole line', () => {
    const r = tests(' Tests  1778 passed | ??? weird (1778)');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/unparsed segment/);
  });

  it('★★ a missing parenthesised total is not a summary line', () => {
    expect(tests(' Tests  1778 passed').recognised).toBe(false);
  });

  it('★★ absent line — typed reason, no counts', () => {
    const r = tests('some unrelated output\nmore output');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/no "Tests" summary line/);
    expect(r, 'a refusal must not carry countable-looking fields').not.toHaveProperty('total');
  });

  it('★★ empty and non-string input do not throw or half-parse', () => {
    for (const bad of ['', null, undefined]) {
      const r = tests(bad);
      expect(r.recognised).toBe(false);
    }
  });

  it('★★★ an UNKNOWN category refuses — the grammar must not certify a population it cannot name', () => {
    // dev executed exactly this: ' Tests  1 bananas (1)' was recognised:true with total 1 and
    // every KNOWN category 0, so the receipt could publish zero known outcomes of a population
    // of one. An open vocabulary is a shape check, not a grammar.
    const r = tests(' Tests  1 bananas (1)');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/unknown category "bananas"/);
  });

  it('★★ a category valid for one label is refused on the other', () => {
    // `todo` is a Tests category; Test Files has no such vocabulary. Accepting it there would
    // mean the label was not really constraining anything.
    expect(tests(' Tests  1 passed | 1 todo (2)').recognised).toBe(true);
    const r = files(' Test Files  1 passed | 1 todo (2)');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/unknown category "todo" for "Test Files"/);
  });

  it('★★ an unknown LABEL is refused rather than parsed generically', () => {
    expect(parseSummaryLine('Snapshots', ' Snapshots  1 passed (1)').recognised).toBe(false);
  });

  it('★★ duplicate category refuses rather than silently taking the last', () => {
    const r = tests(' Tests  1 passed | 2 passed (3)');
    expect(r.recognised).toBe(false);
    expect(r.reason).toMatch(/duplicate category/);
  });
});
