// ⛔ A PARTIAL RUN THAT RECORDED NOTHING MUST NOT PROMISE A RESUME POINT.
//
// The provider chose between "a re-run continues" and "a re-run repeats" on whether a resume
// ledger was ACTIVE. That is the wrong fact. With `filesProcessed === 0` the ledger is active and
// EMPTY, so a caller was told:
//
//     "clangd index is now persisting and the collected files are recorded;
//      run graph_collect_code_intel again to CONTINUE from where this stopped"
//
// while the structured fields in the SAME envelope read `filesProcessed: 0` and
// `zeroFilesProcessed.reason: BUDGET_EXHAUSTED_BEFORE_FIRST_FILE`. One payload disagreeing with
// itself, and the prose is the half an agent reads.
//
// ⚠ MEASURED, not reasoned (2026-09-03, 3-TU fixture, real clangd): budgetMs 9000 gives the collect
// phase 5850ms; a ~2.9s index wait leaves under BUDGET_TAIL_RESERVE_MS (3000ms), so the per-file
// loop breaks on its first iteration. Envelope came back `partial`, ledger.collected [], elapsed
// 2944ms of a 9000ms budget. At 4000ms and 6000ms it reproduced every time.
//
// ⚠ WHY A PURE FUNCTION AND NOT AN INTEGRATION TEST. The partial-progress branch needs the budget
// to land between "one file fits" and "all files fit" — a window a few hundred milliseconds wide on
// this fixture. That timing dependence is exactly what made two real-clangd tests fail on a machine
// that had been green 40 minutes earlier. A branch reachable only by luck is a branch nothing
// guards, so the decision moved somewhere all three outcomes are reachable on demand.
import { describe, it, expect } from 'vitest';
import { budgetExhaustedMessage } from '../../../mcp/stdio/code-intel/collect-ledger.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

describe('the budget-exhausted note matches what actually happened', () => {
  it('★★★ zero files done: says NOTHING was recorded, and does not promise a resume point', () => {
    const msg = budgetExhaustedMessage({
      ledgerActive: true, filesProcessed: 0, filesTotal: 3, budgetMs: 9000,
      overall: ' Overall 0/3 first-party files collected.',
    });

    expect(msg, 'the reader must be told no file completed').toMatch(/NO file completed/i);
    expect(msg, 'and that nothing was persisted').toMatch(/NOTHING was recorded/i);

    // ⛔ THE CLAIM THAT WAS FALSE. A live matcher, not a bare not.toMatch: the canaries are the
    // real strings, so a dead or overbroad pattern fails here rather than passing silently.
    expectAbsentWithLiveMatcher(
      /the collected files are recorded/i,
      {
        forbidden: 'clangd index is now persisting and the collected files are recorded; run again',
        allowed: 'NO file completed within the budget, so NOTHING was recorded',
      },
      msg,
      'it claims recorded progress after processing zero files',
    );
    expectAbsentWithLiveMatcher(
      /CONTINUE from where this stopped/i,
      {
        forbidden: 'run graph_collect_code_intel again to CONTINUE from where this stopped',
        allowed: 'a re-run starts warmer and may get further; raising budgetMs is the reliable fix',
      },
      msg,
      'there is no "where this stopped" — it stopped before the first file',
    );

    // ★ The retry advice is KEPT on purpose: the clangd index really does persist across runs, so
    // a re-run does start warmer. Only the claim of recorded progress was false. Dropping the
    // advice entirely would trade one wrong statement for a missing one.
    expect(msg, 'the honest remedy must still be named').toMatch(/raising budgetMs/i);
  });

  it('partial progress: still promises continuation, because now there IS a resume point', () => {
    // ⛔ THE CONTROL THAT STOPS THE FIX FROM BEING A BLANKET REWORDING. If this branch also lost
    // its resume promise, the change would be silencing a true statement, not removing a false one.
    const msg = budgetExhaustedMessage({
      ledgerActive: true, filesProcessed: 2, filesTotal: 5, budgetMs: 9000,
      overall: ' Overall 2/5 first-party files collected.',
    });

    expect(msg).toMatch(/2\/5 files done/);
    expect(msg, 'progress WAS recorded here, so continuation is a true claim')
      .toMatch(/CONTINUE from where this stopped/i);
    expect(msg).toMatch(/the collected files are recorded/i);
  });

  it('an explicit files[] scope keeps its own warning: a re-run REPEATS', () => {
    // The third outcome, unchanged and re-pinned here so the refactor that moved this decision into
    // one function cannot quietly drop a branch that had no test of its own.
    const msg = budgetExhaustedMessage({
      ledgerActive: false, filesProcessed: 1, filesTotal: 4, budgetMs: 9000,
    });

    expect(msg).toMatch(/REPEATS these files/i);
    expect(msg).toMatch(/Pass the next chunk of files\[\]/i);
    expectAbsentWithLiveMatcher(
      /CONTINUE from where this stopped/i,
      {
        forbidden: 'run graph_collect_code_intel again to CONTINUE from where this stopped',
        allowed: 'a re-run REPEATS these files rather than continuing',
      },
      msg,
      'an explicit files[] scope has no ledger to continue from',
    );
  });
});
