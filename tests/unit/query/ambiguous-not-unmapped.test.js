// AN UNESTABLISHED NEGATIVE, RENDERED AS A FACT ABOUT THE CODE — AGAIN.
//
// Found by ef-manager (2026-08-09) while reviewing the timeout fix at line 764.
// The SAME defect survived 148 lines earlier, on the ambiguous-match path:
//
//   'STATUS: known to graph; ambiguous / no feature mapping (symbol-context packet)'
//
// That branch fires when graphConsequences returns a human-readable AMBIGUOUS
// MATCH string. There is no features_touching in a string — consequences
// short-circuits to candidates BEFORE computing one. So nothing on this path ever
// looked for a feature, and it claimed there was none.
//
// Disproved with data: `WorldBuffer` takes this exact path and IS
// anchors.symbols[0] of feature `world-buffer`; `GpuMaterial` likewise of
// `material-palette`. Both verified in echoes' functionality.json.
//
// Worse than the timeout case in one respect: there a lookup ran and failed. Here
// nothing was attempted. And by the cost analysis this is the CHEAP path, so it
// is the one large C++ repos land on most.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js'),
  'utf8',
);

describe('the ambiguous path does not claim a feature mapping it never checked', () => {
  it('★ no longer asserts "no feature mapping"', () => {
    expect(src).not.toMatch(/ambiguous \/ no feature mapping/);
  });

  it('★ says the lookup was NOT CHECKED, and that this is not "unmapped"', () => {
    expect(src).toMatch(/AMBIGUOUS — feature mapping NOT CHECKED/);
    expect(src).toMatch(/has NOT\n\s*'\s*established that the symbol maps to no feature|established that the symbol maps to no feature/);
    expect(src).toMatch(/Do not read it as unmapped/);
  });

  it('names the disambiguating next step, not just the same question again', () => {
    // Telling a reader "this was ambiguous" without a way to resolve it leaves
    // them where they started. Narrowing the target is the move that works.
    expect(src).toMatch(/pick a candidate above, then graph_consequences/);
  });
});
