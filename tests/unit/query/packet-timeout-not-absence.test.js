// A TIMEOUT IS NOT AN ABSENCE.
//
// Root-caused 2026-08-09 from ef-manager's field report. graph_packet("SimCoordinator")
// on echoes returned `ERROR: not found as feature, task, or symbol mapping to a
// feature` — while graph_consequences on the SAME symbol, the SAME overlay, in the
// SAME process resolved it to TWO features with anchor_match "symbol".
//
// Measured cause: the symbol→feature lookup runs under a 2000ms budget.
//   this repo   3,958 nodes →  601ms   under budget, resolves
//   echoes     12,126 nodes → 4316ms   over budget, times out
//
// So on any repo large enough for the tool to matter, a latency fact was rendered
// as a fact about the code. That also explains the count inversion ef-manager
// measured: a UNIQUE match runs the full traversal and blows the budget, while
// AMBIGUOUS matches return early and cheap. Not inverted on count — on COST.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js'),
  'utf8',
);

describe('graph_packet distinguishes a timeout from a missing symbol', () => {
  it('★ records that the lookup timed out instead of discarding it', () => {
    // The bug was that `raw.__timeout` was checked only to SKIP the success path.
    // The timeout itself was never carried forward, so it became indistinguishable
    // from "consequences returned nothing".
    expect(src).toMatch(/featureLookupTimedOut\s*=\s*true/);
  });

  it('★ emits a TIMED OUT status that explicitly denies being an absence', () => {
    expect(src).toMatch(/TIMED OUT — this is NOT "symbol not found"/);
    expect(src).toMatch(/NOTHING here says the symbol is absent or unmapped/);
  });

  it('the timeout branch runs BEFORE the not-found error', () => {
    // Order is the whole fix. Placed after, the ERROR would still win and the new
    // branch would be dead code that passes its own assertions.
    // Anchor both on EMITTED strings. The comment above the timeout branch quotes
    // the error text while explaining it, so a bare indexOf finds the prose first
    // and compares the wrong two positions — which is how this assertion failed
    // on a correctly-ordered file the first time it ran.
    const timeoutAt = src.indexOf('featureLookupTimedOut) {');
    const errorAt = src.indexOf('ERROR: target "${target}" not found');
    expect(timeoutAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(-1);
    expect(timeoutAt, 'timeout branch precedes the error branch').toBeLessThan(errorAt);
  });

  it('names the unbudgeted verb that will actually answer', () => {
    // Telling a reader "this timed out" without a next step leaves them stuck at
    // the same question. graph_consequences is the same lookup without the budget.
    const i = src.indexOf('TIMED OUT — this is NOT');
    expect(src.slice(i, i + 1200)).toMatch(/graph_consequences\(target=/);
  });
});
