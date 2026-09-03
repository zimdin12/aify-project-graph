// ⛔ RUNNING THIS HARNESS BY ACCIDENT MUST NOT SPEND 24 AGENT RUNS.
//
// The runner's own header promises it: "No real executor ships with this file. The default is a mock
// that proves the plumbing... Pointing --executor at a real agent adapter is a deliberate, separate
// act; it cannot happen by running this script." The plan says the same thing — writing a real
// executor is "the only remaining step that could accidentally spend".
//
// ⚠ THAT PROMISE WAS IMPLEMENTED AND UNGUARDED. Traced 2026-09-03: the implementation is robust on
// every input path, but NO test asserted it and `loadExecutor` was not even exported, so no test
// could reach it. A refactor changing the default would have passed the entire suite. The risk was
// never that it was wrong today; it was that nothing would notice if it stopped being right.
//
// ⚠ Found by checking a claim I had been REPEATING ("M5 is wired, green, spends nothing") rather
// than by inspecting the product. The claims stated most confidently are the ones least likely to
// have been verified.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ⛔ DYNAMIC IMPORT, AND THE ENV VAR FIRST — A STATIC IMPORT HERE RUNS THE WHOLE HARNESS.
//
// `linkage-scope-runner.mjs` ends with `if (!process.env.APG_LINKAGE_RUNNER_NO_MAIN) await main();`,
// so merely IMPORTING it executes the experiment: preflight, 12 scratch repos materialised, 6 of
// them indexed, and a mock JSON written into docs/evidence/m5-scale/runs/.
//
// ⚠ MY FAULT, MEASURED: I wrote this file (and two others) with a static top-level import and no
// env guard, so every suite run executed the harness three extra times and left three junk files in
// the tracked tree — which is why run-suite kept refusing on a dirty tree. A static import is
// hoisted, so the assignment CANNOT precede it; the import must be dynamic.
//
// The pre-existing `linkage-runner-wiring.test.js` already did exactly this. I did not ask why it
// was shaped that way before writing mine differently.
async function runnerModule() {
  process.env.APG_LINKAGE_RUNNER_NO_MAIN = '1';
  return import('../../../scripts/linkage-scope-runner.mjs');
}

let dir = null;
afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

describe('the linkage runner cannot spend by accident', () => {
  // Every way a caller can arrive with NO deliberate executor choice. `argOf` returns the fallback
  // when the flag is absent, and an EMPTY `--executor=` yields '' — traced against the real argOf,
  // not assumed: '' is falsy and must land on the mock like everything else here.
  for (const [label, spec] of [
    ['no --executor flag at all (argOf fallback)', 'mock'],
    ['--executor=mock, named explicitly', 'mock'],
    ['--executor= with an EMPTY value', ''],
    ['a caller passing undefined', undefined],
    ['a caller passing null', null],
  ]) {
    it(`★★★ ${label} → the MOCK, which spends nothing`, async () => {
      const { fn, isMock } = await (await runnerModule()).loadExecutor(spec);
      expect(isMock, 'a non-mock here means an accidental run could spend').toBe(true);
      expect(typeof fn).toBe('function');

      // ⛔ AND THE MOCK MUST STAY DELIBERATELY BAD. Its own comment: "a mock that answered well would
      // make a green wiring run look like a product result." If it ever starts producing a
      // convincing transcript, a plumbing run becomes indistinguishable from evidence.
      const out = await fn({ prompt: 'x', arm: 'graph', klass: { id: 'C1' } });
      expect(out.mock, 'the row must be self-identifying as mock output').toBe(true);
      expect(out.runtime).toBe('mock');
      expect(out.cost, 'a mock must not fabricate a cost figure')
        .toEqual({ tokens: null, durationMs: null });
    });
  }

  it('⛔ POSITIVE CONTROL: a real executor path DOES load — or the assertions above are vacuous', async () => {
    // Without this, a loadExecutor that returned the mock unconditionally would satisfy every
    // safety assertion above while making the harness incapable of ever running the experiment.
    // That is the "passes for the wrong reason" shape that made an earlier M1 check worthless.
    dir = mkdtempSync(join(tmpdir(), 'apg-exec-'));
    const mod = join(dir, 'fake-executor.mjs');
    writeFileSync(mod, 'export default async function run() { return { transcript: "real", toolCalls: [] }; }\n');

    const { fn, isMock } = await (await runnerModule()).loadExecutor(pathToFileURL(mod).href);
    expect(isMock, 'an explicit path must be honoured, or the harness can never run').toBe(false);
    expect((await fn({})).transcript).toBe('real');
  });

  it('⛔ a module without a default export function is REFUSED, not silently mocked', async () => {
    // Falling back to the mock on a bad path would be the worst outcome: the operator believes a
    // real run happened and reads mock numbers as product evidence. It must throw.
    dir = mkdtempSync(join(tmpdir(), 'apg-exec-bad-'));
    const mod = join(dir, 'not-an-executor.mjs');
    writeFileSync(mod, 'export const notDefault = 1;\n');

    await expect((await runnerModule()).loadExecutor(pathToFileURL(mod).href))
      .rejects.toThrow(/no default export function/);
  });
});
