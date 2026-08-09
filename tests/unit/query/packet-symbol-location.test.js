// A PACKET THAT RESOLVES TO A FEATURE MUST STILL SAY WHERE THE SYMBOL IS.
//
// Field report (sc-manager / sc-coder, Sand Castle, 2026-08-09) from a real
// 223-member status-object census in a 50k-line header set: graph_packet on a
// symbol returned the broad owning feature and omitted the declaring file.
// graph_whereis recovered it instantly at game/UnifiedFluidRuntime.h:378.
//
// The branches were inverted. DEFINED IN was emitted only by the symbol-pointer
// packet — the path taken when the symbol maps to NO feature, i.e. when the
// packet can say least. As soon as a feature resolved, the packet gained
// authority and lost the line saying where the thing is. Their verdict: worse
// than returning nothing, because it looks like an answer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js'),
  'utf8',
);

describe('symbol-derived packets carry the symbol location', () => {
  it('★ the MATCHED VIA branch also emits DEFINED IN', () => {
    // Locate the feature-match branch and assert the location lines are built
    // inside it — not only in buildSymbolPointerPacket further up the file.
    const i = src.indexOf('MATCHED VIA: symbol');
    expect(i, 'the matched-via branch exists').toBeGreaterThan(-1);
    const branch = src.slice(i - 1600, i + 900);
    expect(branch, 'reads the symbol hits').toMatch(/symbolConsequences\?\.matched\?\.symbols/);
    expect(branch, 'emits a DEFINED IN section').toMatch(/DEFINED IN \(the symbol you asked for/);
  });

  it('distinguishes the symbol from the feature in the label', () => {
    // "DEFINED IN" alone, under a FEATURE header, would read as the feature's
    // files. The reader asked about a symbol and must be able to tell which.
    expect(src).toMatch(/DEFINED IN \(the symbol you asked for, not the feature\)/);
  });

  it('the symbol-pointer packet still has its own DEFINED IN', () => {
    // Guard against the fix being made by MOVING the section rather than adding
    // one — the no-feature path is the case that always had it right.
    expect(src).toMatch(/renderListSection\('DEFINED IN'/);
  });
});
