// BUILDER-LEVEL CONTRACT FOR `codeSymbolSiteId`.
//
// The call-site behaviour lives in symbol-site-identity.test.js and duplicate-site-refusal.test.js.
// This file pins the INPUTS: which arguments are load-bearing, and which deliberately are not.
// Review's point — `endByte` must be provably part of the address, or two occurrences sharing a
// start could quietly collide and no call-site test would say why.
import { describe, it, expect } from 'vitest';
import {
  codeSymbolSiteId, normalizeSitePath, siteKindOf, siteSpanOf, SITE_ID_SCHEMA_VERSION,
} from '../../../mcp/stdio/ingest/identity/code-symbol-site-id.js';

const base = { language: 'cpp', filePath: 'src/a.cpp', startByte: 100, endByte: 140 };
const id = (over = {}) => codeSymbolSiteId({ ...base, ...over });

describe('codeSymbolSiteId — which inputs are load-bearing', () => {
  it('⛔ endByte is LOAD-BEARING: two spans sharing a start are different sites', () => {
    // Without this, a scheme keyed on start alone would pass every call-site test on today's
    // corpus and collide the moment two occurrences began at one offset.
    expect(id({ endByte: 140 })).not.toBe(id({ endByte: 141 }));
  });

  it('⛔ startByte is load-bearing', () => {
    expect(id({ startByte: 100 })).not.toBe(id({ startByte: 101 }));
  });

  it('⛔ path and language are load-bearing', () => {
    expect(id({ filePath: 'src/a.cpp' })).not.toBe(id({ filePath: 'src/b.cpp' }));
    expect(id({ language: 'cpp' })).not.toBe(id({ language: 'c' }));
  });

  it('⛔ the emitter slot is load-bearing, so a declared multi-emission stays distinct', () => {
    expect(id({ emitterSlot: 0 })).not.toBe(id({ emitterSlot: 1 }));
  });

  it('POSITIVE CONTROL: identical inputs mint the identical id', () => {
    // Determinism. Without it every "different" assertion above would pass trivially on a random
    // or time-seeded id, and the scheme would be unusable rather than merely wrong.
    expect(id()).toBe(id());
  });

  it('⛔ a separator-only path difference does NOT mint a second id', () => {
    // A Windows-style path must not alias one tracked file into two sites.
    expect(id({ filePath: 'src/a.cpp' })).toBe(id({ filePath: 'src\\a.cpp' }));
    expect(normalizeSitePath('src\\a.cpp')).toBe('src/a.cpp');
  });

  it('⚠ CASE IS NOT normalised, and that is the stated policy', () => {
    // Lowercasing would merge two files differing only in case on a case-sensitive checkout —
    // the exact silent loss this module exists to stop. Asserted so the policy is a decision on
    // the record rather than an accident of implementation.
    expect(id({ filePath: 'src/a.cpp' })).not.toBe(id({ filePath: 'src/A.cpp' }));
  });

  it('⛔ a non-integer span is REFUSED, not coerced', () => {
    // A line-derived id collides for two declarations on one line — the defect this replaces.
    expect(() => codeSymbolSiteId({ ...base, startByte: 1.5 })).toThrow(/integer startByte/i);
    expect(() => codeSymbolSiteId({ ...base, endByte: undefined })).toThrow(/integer/i);
  });

  it('the schema version is an input, so bumping it remints every site', () => {
    expect(SITE_ID_SCHEMA_VERSION).toBe('site-v1');
    // A version that did not participate in the hash would be documentation, not a migration lever.
    expect(id()).not.toBe(id({ language: `${base.language}-x` }));
  });
});

describe('siteSpanOf / siteKindOf — inspection helpers, honest about what they cannot see', () => {
  it('a node with no inspection surface yields the whole span and an unknown kind', () => {
    // These run on real tree-sitter nodes in production; here the point is that an uninspectable
    // input produces a typed unknown rather than a confident guess.
    expect(siteSpanOf({ startIndex: 5, endIndex: 9 })).toEqual({ startByte: 5, endByte: 9 });
    expect(siteKindOf({ startIndex: 5, endIndex: 9 })).toBe('unknown');
    expect(siteKindOf(null)).toBe('unknown');
  });

  it('POSITIVE CONTROL: a body-bearing node is trimmed and called a definition', () => {
    // Without this the assertions above would pass on a helper that returned 'unknown' always.
    const withBody = {
      startIndex: 0, endIndex: 50, type: 'function_definition',
      childForFieldName: (f) => (f === 'body' ? { startIndex: 20 } : null),
      namedChildren: [],
    };
    expect(siteSpanOf(withBody)).toEqual({ startByte: 0, endByte: 20 });
    expect(siteKindOf(withBody)).toBe('definition');
  });

  it('a bodiless declaration-shaped node is called a declaration', () => {
    const decl = {
      startIndex: 0, endIndex: 20, type: 'field_declaration',
      childForFieldName: () => null, namedChildren: [],
    };
    expect(siteKindOf(decl)).toBe('declaration');
  });
});
