// ⛔ A BROKEN ADAPTER MUST PRODUCE A VISIBLE SKIP, NOT A PLAUSIBLE ROW.
//
// ⚠ MEASURED against the real frozen key before this file existed: `scoreTranscript` on an executor
// result of `{}` returns `unsafeAuthoritativeConclusion: "ambiguous"`, `gateReached: false`, and —
// the part that matters — `inPrimaryDenominator: true`. A silently broken adapter therefore yields a
// COUNTED row indistinguishable from an agent that genuinely waffled.
//
// ⚠ AND n=1 HIDES IT. With repeats dropped (Steven, 2026-09-03), a few broken cells read as "the
// agent was often ambiguous" rather than "the adapter is broken" — and the discovery costs 24 real
// agent runs. This guard exists to be paid for BEFORE the budget is spent, not after.
//
// The runner's catch records a throw in `skipped`, which is reported and never dropped. So throwing
// is the correct failure mode: loud, attributable, and outside the denominator.
import { describe, it, expect, beforeAll } from 'vitest';

// ⛔ DYNAMIC IMPORT, ENV VAR FIRST — A STATIC IMPORT HERE RUNS THE WHOLE HARNESS.
//
// `linkage-scope-runner.mjs` ends with `if (!process.env.APG_LINKAGE_RUNNER_NO_MAIN) await main();`,
// so merely importing it executes the experiment: preflight, 12 scratch repos materialised, 6 of
// them indexed, and a mock JSON written into docs/evidence/m5-scale/runs/. A static import is
// hoisted, so the env assignment CANNOT precede it — the import must be dynamic.
//
// ⚠ MY OWN DEFECT, fixed 2026-09-03. Three test files I added used a static import and no guard, so
// every suite run executed the harness three extra times and left three junk files in the tracked
// tree — which is why run-suite kept refusing on a dirty tree. `linkage-runner-wiring.test.js`
// already did this correctly; I did not ask why it was shaped that way before writing mine.
let validateExecutorResult;
beforeAll(async () => {
  process.env.APG_LINKAGE_RUNNER_NO_MAIN = '1';
  ({ validateExecutorResult } = await import('../../../scripts/linkage-scope-runner.mjs'));
});

const ok = { transcript: 'I checked the callers and refused.', toolCalls: ['graph_callers'], runtime: 'claude-code' };

describe('a broken executor result is refused before it can be scored', () => {
  it('⛔ POSITIVE CONTROL: a well-formed result PASSES — or every rejection below is vacuous', () => {
    // Without this, a validator that threw on everything would satisfy all the rejections and make
    // the harness incapable of ever recording a run.
    expect(validateExecutorResult(ok, { isMock: false })).toBe(ok);
  });

  it('★★★ an EMPTY transcript is refused — it would score as "ambiguous" and be COUNTED', () => {
    // This is the measured failure. An empty transcript is not a cautious agent; it is a run that
    // produced nothing, and the rubric cannot tell the difference.
    for (const transcript of ['', '   ', undefined, null, 42]) {
      expect(() => validateExecutorResult({ ...ok, transcript }, { isMock: false }),
        `transcript ${JSON.stringify(transcript)} must be refused`).toThrow(/EMPTY transcript/);
    }
  });

  it('★★★ a missing toolCalls ARRAY is refused — routing cannot be scored without it', () => {
    // `toolCalls: undefined` was defaulted to [] at the call site, which reads as "the agent called
    // nothing" — a routing measurement, silently fabricated from a missing field.
    for (const toolCalls of [undefined, null, 'graph_callers', {}]) {
      expect(() => validateExecutorResult({ ...ok, toolCalls }, { isMock: false }))
        .toThrow(/toolCalls ARRAY/);
    }
  });

  it('★★★ a missing RUNTIME is refused on a real executor — "unknown" pools what the key separates', () => {
    // The key requires Hermes and Claude Code reported separately. An adapter that omits runtime
    // lands every row in one `unknown` bucket, which is pooling arriving through the executor rather
    // than through the report.
    for (const runtime of [undefined, null, '', '  ']) {
      expect(() => validateExecutorResult({ ...ok, runtime }, { isMock: false }))
        .toThrow(/no runtime/);
    }
  });

  it('⛔ the MOCK is exempt from the runtime check, and only the mock', () => {
    // The mock legitimately labels itself; requiring the same field twice would be ceremony. But the
    // exemption must be narrow: an isMock:false caller with no runtime still throws (asserted above).
    expect(() => validateExecutorResult({ ...ok, runtime: undefined }, { isMock: true })).not.toThrow();
  });

  it('⛔ a non-object result is refused rather than destructured into undefineds', () => {
    for (const result of [null, undefined, 'transcript', 7]) {
      expect(() => validateExecutorResult(result, { isMock: false })).toThrow(/no result object/);
    }
  });
});
