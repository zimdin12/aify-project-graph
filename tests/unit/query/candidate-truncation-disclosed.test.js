// A CAPPED CANDIDATE LIST THAT DOES NOT SAY IT IS CAPPED HIDES THE ANSWER.
//
// Measured (ef-manager, echoes, 2026-08-10). graph_consequences("GpuMaterial")
// printed "16 concrete candidates found:" then FIVE bullets, all GLSL, and
// stopped. No "11 more", no truncated flag, no limit.
//
// Ground truth by rg: exactly 16 definitions — 1 C++
// (engine/rendering/GpuMaterialPalette.h:30) and 15 GLSL shader mirrors. The
// single C++ declaration, which is what a caller almost always means, was inside
// the silent eleven.
//
// His priority call, which is the right one: ranking C++ first is a nice-to-have;
// disclosing the cap is the CORRECTNESS fix. A ranking warning says the order is
// unreliable and you must still go looking. A truncation marker says the LIST IS
// INCOMPLETE — a different and load-bearing claim, and the one that sends a reader
// after the missing eleven.
//
// The idiom already existed here (documents_mentioning_note, co_consumer_files
// {items,total,truncated,limit}); it was never applied on this path.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'symbol_lookup.js'),
  'utf8',
);

describe('ambiguous-match candidates disclose their cap', () => {
  it('★ emits a SHOWING n OF m marker when candidates are omitted', () => {
    expect(src).toMatch(/SHOWING \$\{candidates\.length\} OF \$\{groups\.size\}/);
    expect(src).toMatch(/candidate\(s\) omitted/);
  });

  it('★ warns that the wanted definition may be in the omitted part', () => {
    // The specific failure: the sole first-party declaration fell outside the cap
    // on a repo full of shader mirrors. Saying "some were omitted" without saying
    // "the one you want may be among them" understates it.
    expect(src).toMatch(/definition you want may be among them/);
  });

  it('names a way to see the rest', () => {
    expect(src).toMatch(/graph_whereis\(symbol=/);
  });

  it('stays silent when nothing was actually omitted', () => {
    // A truncation notice on a complete list would train readers to ignore it.
    expect(src).toMatch(/omitted > 0\s*\?/);
  });
});
