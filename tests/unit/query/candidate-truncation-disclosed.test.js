// A CAPPED CANDIDATE LIST THAT DOES NOT SAY IT IS CAPPED HIDES THE ANSWER.
//
// Measured (ef-manager, echoes, 2026-08-10). `graph_consequences("GpuMaterial")` printed
// "16 concrete candidates found:" then FIVE bullets, all GLSL, and stopped. No "11 more",
// no truncated flag, no limit.
//
// Ground truth by rg: exactly 16 definitions — 1 C++
// (engine/rendering/GpuMaterialPalette.h:30) and 15 GLSL shader mirrors. The single C++
// declaration, which is what a caller almost always means, was inside the silent eleven.
//
// His priority call, and it is the right one: ranking C++ first is a nice-to-have;
// disclosing the cap is the CORRECTNESS fix. A ranking warning says the order is
// unreliable and you must still go looking. A truncation marker says the LIST IS
// INCOMPLETE — a different and load-bearing claim, and the one that sends a reader after
// the missing eleven.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11, AFTER MUTATION PROVED IT WAS DECORATION.
//
// The previous version asserted regexes over `symbol_lookup.js`. Mutation test: make the
// banner UNREACHABLE (`omitted = 0`) while leaving every string in the file — **4/4 still
// green**. It asserted the banner's spelling, never that it fires.
//
// ⚠ It also would have survived the original defect. The bug was that the marker did not
// exist at all; once someone typed the string, the test went green forever, whether or
// not the code could ever reach it. A test that cannot distinguish "implemented" from
// "spelled" is not a guard on a correctness fix.
//
// `buildAmbiguousMatchMessage` is pure, so this needs no database — it is called with the
// exact shape the field report describes: 16 same-named definitions, 1 C++ and 15 GLSL.
import { describe, it, expect } from 'vitest';
import { buildAmbiguousMatchMessage } from '../../../mcp/stdio/query/verbs/symbol_lookup.js';

// The echoes case, reconstructed: one first-party C++ declaration among fifteen shader
// mirrors. The C++ one is placed LAST so it falls outside a 5-item cap — which is exactly
// how the real one went missing.
const ROWS = [
  ...Array.from({ length: 15 }, (_, i) => ({
    label: 'GpuMaterial',
    file_path: `engine/shaders/mirror_${String(i).padStart(2, '0')}.glsl`,
    start_line: 10 + i,
    type: 'Struct',
    language: 'glsl',
  })),
  {
    label: 'GpuMaterial',
    file_path: 'engine/rendering/GpuMaterialPalette.h',
    start_line: 30,
    type: 'Struct',
    language: 'cpp',
  },
];

describe('ambiguous-match candidates disclose their cap', () => {
  const msg = buildAmbiguousMatchMessage('GpuMaterial', ROWS, 5);

  it('harness sanity: the fixture actually triggers the ambiguous path', () => {
    // Without this every assertion below passes vacuously on a null/empty message —
    // which is precisely how the source-grep version stayed green while unreachable.
    expect(msg, 'sixteen same-named definitions must produce an ambiguous message').toBeTruthy();
    expect(msg).toMatch(/GpuMaterial/);
  });

  it('★★ states the REAL numbers — shown, total, and omitted', () => {
    // Behaviour, not spelling: these integers are computed from the fixture, so an
    // unreachable banner or a broken subtraction fails here.
    expect(msg).toMatch(/SHOWING 5 OF 16/);
    expect(msg).toMatch(/11 candidate\(s\) omitted/);
  });

  it('★ warns that the wanted definition may be in the omitted part', () => {
    // The specific failure: the sole first-party declaration fell outside the cap on a
    // repo full of shader mirrors. Saying "some were omitted" without saying "the one you
    // want may be among them" understates it.
    expect(msg).toMatch(/definition you want may be among them/);
  });

  it('names a way to see the rest', () => {
    expect(msg).toMatch(/graph_whereis\(symbol=/);
  });

  it('★ and says NOTHING about truncation when nothing was truncated', () => {
    // The other half. Without it, emitting the banner unconditionally would satisfy every
    // case above — and a marker that always fires is one nobody reads, the same argument
    // that killed the permanent caveat.
    const small = buildAmbiguousMatchMessage('GpuMaterial', ROWS.slice(0, 3), 5);
    expect(small, 'three candidates still ambiguate').toBeTruthy();
    expect(small).not.toMatch(/SHOWING/);
    expect(small).not.toMatch(/omitted/);
  });
});
