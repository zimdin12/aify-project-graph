// A STRONG TIER LABELLED FALSELY IS NOT A WEAK TIER.
//
// Measured (ef-manager, echoes, 8e09c67 — WITH the four-tier split already in
// place, so not a pre-tier wound):
//
//   cylindricalLatBandsForBody -> tests_adjacent ["tests/test_main.cpp"]
//     provenance symbol_referenced, basis: relation CALLS, via_symbol "vec3"
//     ground truth: grep -c cylindricalLatBandsForBody tests/test_main.cpp = 0
//
// `symbol_referenced` is a claim that THE TARGET is referenced. The predicate
// accepted ANY symbol edge between the test file and anything, then labelled it as
// though the target were the referent. `vec3` is a math type in nearly every C++
// file in that repo, so the claim was true about vec3 and false about the symbol
// the caller asked for.
//
// This is not the contradiction mechanism working. A correctly-labelled weak tier
// IS that mechanism — case 3 (GpuMaterialPalette.h -> [] / none) proves it, and is
// worth more than any positive the field could produce. This was a strong tier
// wearing a false label, which is a different and much more fixable thing.
//
// ★ The reversal matters: ef-manager first marked this field DELETE on the vec3
// case, then widened n=1 to n=3 and grepped every claim — 2 of 3 CORRECT,
// including a strong verified true positive on import_linked (ChunkDataCache.h,
// 25 textual occurrences, ~20 test bodies). The DELETE was retracted. The field
// earns its place; the predicate did not.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'consequences.js'),
  'utf8',
);

describe('symbol_referenced requires the referent to BE the target', () => {
  it('★ the ref tier filters on via_symbol matching a matched symbol', () => {
    // Before: filter((r) => r.relation !== 'IMPORTS') — any edge, any symbol.
    expect(src).toMatch(/r\.via_symbol && matchedSymbols\.has\(r\.via_symbol\)/);
  });

  it('★ an unmatched referent yields NO listing, not a weaker one', () => {
    // "the tier is not weaker — it is nothing, and the file must not be listed."
    // Guarding the comment because it is the reasoning a future reader needs
    // before they relax the predicate to "recover" the lost rows.
    expect(src).toMatch(/it is nothing,\s*\n?\s*\/\/ and the file must not be listed/);
  });
});

describe('the tests_adjacent warning describes the tier that actually fired', () => {
  it('★ is tier-selected, not hardcoded to feature_declared', () => {
    // Measured: provenance symbol_referenced while the warning read "DECLARED by
    // the touching feature" — the feature_declared mechanism, which had not run.
    expect(src).toMatch(/testsProvenance === 'companion_header_linked'/);
    expect(src).toMatch(/testsProvenance === 'symbol_referenced'/);
    expect(src).toMatch(/testsProvenance === 'text_mentioned'/);
  });

  it('the symbol_referenced wording points at the basis that makes it checkable', () => {
    // tests_adjacent_basis is what let the vec3 bug be found at all — without
    // via_symbol printed, "test_main.cpp" is unfalsifiable.
    // Anchor on the WARNING text, not on `testsProvenance === 'symbol_referenced'`
    // — that string also appears in the tier-assignment code 17k chars earlier,
    // so a bare indexOf lands on the wrong one and measures the wrong gap.
    const i = src.indexOf('these tests REFERENCE this symbol');
    expect(i, 'the symbol_referenced warning exists').toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toMatch(/tests_adjacent_basis/);
  });

  it('a reference is distinguished from a test of behaviour', () => {
    expect(src).toMatch(/a reference is not a test of behaviour/);
  });
});
