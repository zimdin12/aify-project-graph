// ★ ATTACK EIGHT — AN EDGE NOBODY COULD HAVE VERIFIED IS NOT AN EDGE THAT FAILED
//   VERIFICATION.
//
// ef-manager, 2026-07-31, on the headline coverage number I had been quoting to him
// since day one and that neither of us had ever opened up. The denominator of
// lspVerifiedPctOfCalls was every CALLS edge, unrestricted. This repo's graph
// contains GLSL and Python; clangd cannot verify a single one of those edges — not
// because the index is cold, but because they are not C++ and were never in
// compile_commands.json.
//
// Measured on echoes: 15530 CALLS = 12830 cpp + 1458 glsl + 1242 python. 17% of the
// denominator was unverifiable BY CONSTRUCTION, so:
//   · the number could never approach 100 however good collection got;
//   · its MOVEMENT was uninterpretable — a rise could mean better verification or
//     merely fewer shader edges after a refactor;
//   · and it broke the word `floor`, which is load-bearing. A floor implies the
//     true value is above it and reachable. A ratio over a contaminated
//     denominator is a different quantity wearing a coverage label.
//
// Sixth instance of the session's organizing shape: a percentage stood in for
// coverage while the real thing — the verifiable subset — was computable from data
// already in hand.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const health = readFileSync(join(here, '../../../mcp/stdio/query/verbs/health.js'), 'utf8');

describe('coverage is reported over what could be verified', () => {
  it('does not divide by every CALLS edge', () => {
    expect(health).not.toMatch(/lspVerifiedPctOfCalls = calls > 0 \? Math\.round\(\(verified \/ calls\)/);
  });

  it('divides by the verifiable subset and says so', () => {
    expect(health).toMatch(/verified \/ verifiable/);
    expect(health).toMatch(/lspVerifiedPctDenominator = 'verifiable_calls'/);
  });

  it('reports the excluded population separately, with a reason per language', () => {
    // Excluding them silently would be its own version of the bug: the reader
    // could not tell a small honest denominator from a hidden one.
    expect(health).toMatch(/lspUnverifiableCalls/);
    expect(health).toMatch(/by_reason/);
    expect(health).toMatch(/non_cpp_language/);
  });

  it('names the principle so the next backend inherits it', () => {
    expect(health).toMatch(/unverifiable BY CONSTRUCTION/);
    expect(health).toMatch(/not an edge that failed verification/);
  });

  it('scopes verifiability to languages an LSP backend here actually covers', () => {
    // When a TS/Python backend lands, that language moves from unverifiable to
    // verifiable and the denominator grows — which is the correct behaviour and
    // the reason this is a set rather than a hardcoded 'not glsl'.
    expect(health).toMatch(/LSP_VERIFIABLE_LANGUAGES/);
  });
});
