// ⛔ A GATE NUMBER MUST COME FROM THE PROCESS THAT PRODUCED IT.
//
// cba6c24's commit message says "vitest 2456 passed / 318 files EXIT 0". The run immediately before
// it reported exit 1, one failed file, one failed test. I had the exit code in front of me and typed
// the passing figures anyway.
//
// graph-senior-dev's ruling: *"The right procedural consequence is not 'be more careful typing.'"*
// A rule I must remember is the remedy that already failed. These gates bind the transport.
import { describe, it, expect } from 'vitest';
import {
  identityMovement, IDENTITY_KEYS, gatePassed, renderReceipt, runGate,
} from '../../../scripts/lib/gate-receipt.mjs';

const ident = (over = {}) => ({ commit: 'c'.repeat(40), tree: 't'.repeat(40), porcelain: '', ...over });
const gate = (over = {}) => ({
  label: 'vitest', commandLine: 'npx vitest run', exit: 0, signal: null, spawnError: null,
  countLines: ['  Tests  10 passed (10)'], ...over,
});

describe('a gate passes only when its PROCESS said so', () => {
  it('★★★ exit 0 with no signal and no spawn error is the only pass', () => {
    // ⛔ POSITIVE CONTROL FIRST: if gatePassed returned false always, every assertion below passes
    // while the receipt calls every green run a failure.
    expect(gatePassed(gate())).toBe(true);
  });

  it('★★★ every non-zero outcome is a FAILURE, including the ones that are not exit codes', () => {
    // A killed process and a spawn failure both produce no counts, and both used to be invisible
    // to a human reading output for a "passed" line.
    expect(gatePassed(gate({ exit: 1 })), 'nonzero exit').toBe(false);
    expect(gatePassed(gate({ exit: null })), 'no exit at all').toBe(false);
    expect(gatePassed(gate({ signal: 'SIGKILL' })), 'killed').toBe(false);
    expect(gatePassed(gate({ spawnError: 'ENOENT' })), 'never even started').toBe(false);
  });

  it('★★★ THE FABRICATED-GREEN CASE: a failing gate cannot render a passing verdict', () => {
    // ⛔ THE WHOLE POINT. This is cba6c24's exact shape — a run that exited 1 rendered as green.
    const receipt = renderReceipt({
      before: ident(), after: ident(), moved: [],
      gates: [gate({ exit: 1, countLines: ['  Tests  1 failed | 2455 passed'] })],
    });
    expect(receipt).toMatch(/VERDICT {4}1 GATE\(S\) FAILED: vitest/);
    expect(receipt, 'and the observed exit is printed, not summarised').toMatch(/exit {7}1/);
  });

  it('★★★ the counts are TRANSPORTED — the renderer invents nothing', () => {
    const receipt = renderReceipt({
      before: ident(), after: ident(), moved: [],
      gates: [gate({ countLines: ['  Tests  2460 passed | 4 skipped (2464)'] })],
    });
    expect(receipt).toContain('2460 passed | 4 skipped (2464)');
    // The renderer must not be able to produce a count that was not in the run's own output.
    const empty = renderReceipt({ before: ident(), after: ident(), moved: [], gates: [gate({ countLines: [] })] });
    expect(empty, 'no counts in, no counts out').not.toContain('passed (');
  });

  it('★★★ a receipt whose identity MOVED binds nothing, even with every gate green', () => {
    // ⚠ The carrier lesson, applied to evidence transport: a receipt naming a commit is claiming the
    // gates ran against THAT commit, and a multi-minute suite gives the tree time to change.
    const receipt = renderReceipt({
      before: ident(), after: ident({ porcelain: ' M src/x.js' }), moved: ['porcelain'], gates: [gate()],
    });
    expect(receipt).toMatch(/IDENTITY MOVED DURING THE RUN \(porcelain\) — this receipt binds NOTHING/);
  });

  it('★★★ identityMovement fails closed on every field, and on absence', () => {
    expect(identityMovement(ident(), ident()), 'a settled identity').toEqual([]);
    for (const k of IDENTITY_KEYS) {
      expect(identityMovement(ident(), ident({ [k]: 'CHANGED' })), `${k} moved`).toEqual([k]);
    }
    expect(identityMovement({}, {}), 'absent on both sides is not agreement').toEqual(IDENTITY_KEYS);
    expect(identityMovement(null, null), 'and neither is nothing at all').toEqual(IDENTITY_KEYS);
  });

  it('★★★ a dirty tree is DISCLOSED in the receipt, not silently accepted', () => {
    const receipt = renderReceipt({
      before: ident({ porcelain: ' M a.js\n M b.js' }), after: ident({ porcelain: ' M a.js\n M b.js' }),
      moved: [], gates: [gate()],
    });
    expect(receipt).toMatch(/porcelain {2}DIRTY \(2 entries\)/);
  });

  it('★★★ runGate reads the REAL process outcome — executed, not simulated', () => {
    // ⛔ The transport itself is exercised: a command that genuinely fails must report its own
    // nonzero exit, or every assertion above is about a function nothing calls.
    const ok = runGate({ label: 'ok', command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd() });
    const bad = runGate({ label: 'bad', command: process.execPath, args: ['-e', 'process.exit(3)'], cwd: process.cwd() });
    expect(ok.exit).toBe(0);
    expect(gatePassed(ok)).toBe(true);
    expect(bad.exit, 'the real exit code, from the real process').toBe(3);
    expect(gatePassed(bad)).toBe(false);
  });

  it('★★★ runGate reports a command that could not start at all', () => {
    const missing = runGate({
      label: 'missing', command: 'definitely-not-a-real-binary-xyz', args: [], cwd: process.cwd(),
    });
    expect(gatePassed(missing), 'a gate that never ran did not pass').toBe(false);
  });
});
