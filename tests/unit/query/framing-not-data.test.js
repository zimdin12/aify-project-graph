// TWO FRAMING BUGS, FOUND BY ONE MEASURED EXPERIMENT.
//
// ef-manager ran a written-down blast-radius question both ways (2026-07-31):
// hand/grep answered 4 of 4 criteria in 54.6s; packet/pull/consequences answered
// 1 partial, 1 yes, and FAILED 2, in 65.7s. Grep won. But his diagnosis of WHY is
// what these tests pin, and it was not "the data is wrong":
//
//   "There the framing manufactured a signal that was not there; here the framing
//    discards a signal that IS there. Both are framing bugs, not data bugs."
//
// 1. graph_consequences ASSERTED a test that does not cover the symbol. He asked
//    "is there any mechanism that would tell me if I got this wrong?" and got
//    tests_adjacent: ["tests/test_main.cpp"] — a file he hand-verified has ZERO
//    matches for the symbol. The truth was that no verification mechanism exists,
//    and the flagship safety verb said one did, on the safety axis the tool exists
//    to serve.
//
// 2. The AMBIGUOUS MATCH error listed the C++ definition AND its GLSL twin — which
//    together were the answer to his question — then refused the query and never
//    mentioned the twin again on the qualified retry.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAmbiguousMatchMessage } from '../../../mcp/stdio/query/verbs/symbol_lookup.js';

const here = dirname(fileURLToPath(import.meta.url));
const consequences = readFileSync(join(here, '../../../mcp/stdio/query/verbs/consequences.js'), 'utf8');

const row = (label, file, language, type = 'Function') => ({
  label, file_path: file, language, type, start_line: 1, confidence: 1, extra: '{}',
});

describe('ambiguity across languages is a FINDING', () => {
  it('names the cross-language duplicate instead of only demanding disambiguation', () => {
    const msg = buildAmbiguousMatchMessage('cylindricalLatBandsForBody', [
      row('cylindricalLatBandsForBody', 'engine/voxel/CylindricalPosition.h', 'cpp'),
      row('cylindricalLatBandsForBody', 'engine/voxel/shaders/worldbuf.glsl', 'glsl'),
    ]);
    expect(msg).toMatch(/CROSS-LANGUAGE DUPLICATE/);
    expect(msg).toMatch(/no edge\s+linking the copies|nothing will fail if they drift/);
    // And it must point at where the silent desync actually lives — his real bug was
    // a hardcoded 32.0 in GLSL mirroring CHUNK_SIZE in C++.
    expect(msg).toMatch(/hardcoded literals that mirror a named constant/);
  });

  it('stays quiet when the candidates are same-language — that IS just ambiguity', () => {
    const msg = buildAmbiguousMatchMessage('render', [
      row('render', 'src/a.cpp', 'cpp'),
      row('render', 'src/b.cpp', 'cpp'),
    ]);
    expect(msg).toMatch(/AMBIGUOUS MATCH/);
    expect(msg).not.toMatch(/CROSS-LANGUAGE/);
  });

  it('still tells the caller how to scope the query', () => {
    const msg = buildAmbiguousMatchMessage('x', [
      row('x', 'a.h', 'cpp'), row('x', 'b.glsl', 'glsl'),
    ]);
    expect(msg).toMatch(/qualify or pass file=/);
  });
});

describe('adjacent tests cannot assert unverified coverage', () => {
  it('labels provenance so declared is distinguishable from linked', () => {
    expect(consequences).toMatch(/tests_adjacent_provenance: testsProvenance/);
    expect(consequences).toMatch(/'linked'/);
    expect(consequences).toMatch(/'feature_declared'/);
    expect(consequences).toMatch(/'none'/);
  });

  it('warns explicitly when the list is only DECLARED by a feature', () => {
    // The failure was not the fallback existing — a monolithic test entrypoint
    // defeats linkage and the overlay is real curation. The failure was that the
    // caller could not tell which kind of claim they had received.
    expect(consequences).toMatch(/tests_adjacent_warning/);
    expect(consequences).toMatch(/DECLARED by the touching feature, not verified against this symbol/);
    expect(consequences).toMatch(/do NOT read them as proof/);
  });

  it('only warns when the tests came from the overlay, not when linkage was found', () => {
    // A permanent caveat is noise, and noise on the trust surface is what makes real
    // banners ignorable — the same argument that killed the filler suggestion.
    expect(consequences).toMatch(/const testsUnverifiedForSymbol = testsProvenance === 'feature_declared'/);
    expect(consequences).toMatch(/\.\.\.\(testsUnverifiedForSymbol \?/);
  });
});
