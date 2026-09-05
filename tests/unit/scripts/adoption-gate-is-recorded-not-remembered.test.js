// ⛔ THE FAILURE THESE GUARD, MEASURED 2026-09-05.
//
// TWO defects, one shape: the number that decides a measurement was not held anywhere that could
// contradict me.
//
// 1. THE CONTROL WAS ON THE WRONG POPULATION. `measure-verb-adoption.mjs` counts two populations
//    and never merges them. The preregistered adoption measurement reads n from the NESTED
//    subagent population; the positive control it published was summed over the TOP-LEVEL one. In
//    the measurement window that printed "positive control: 0, FAILS" while the nested population
//    held 6 transcripts and 255 Bash/Read/Grep calls — and the preregistration wrote that failure
//    down as CORRECT. Left alone, the verdict gate could never have opened.
//
// 2. n LIVED IN PROSE. It was carried in a loop prompt across cycles, with no record of the command
//    or the filters. It read 16 for two cycles; two independent instruments then read 5, and 16 is
//    not reproducible under any filter combination, cutoff, or mtime-versus-timestamp reading.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradeControls, runIsPublishable } from '../../../scripts/lib/population-controls.mjs';
import { ADOPTION_WINDOW, counterArgsFor, classifyReading } from '../../../scripts/lib/adoption-window.mjs';
import { COLUMNS, formatRow, lastRecordedN } from '../../../scripts/lib/n-ledger-rows.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a control vouches only for the population it counted', () => {
  it('★★★ THE REAL CASE: an empty population is UNDECIDED, never a pass and never a failure', () => {
    // This is the exact shape that misfired. The top-level population was empty, so its control
    // counted 0 — which says nothing at all about the instrument, in either direction.
    const graded = gradeControls({ population: 0, positive: 0, negative: 0 });
    expect(graded.positive.passed, '0 of 0 must not be a boolean').toBeNull();
    expect(graded.vouches, 'an undecided control cannot vouch').toBe(false);
  });

  it('★★★ a NON-EMPTY population with zero positive hits FAILS — the instrument is blind', () => {
    const graded = gradeControls({ population: 6, positive: 0, negative: 0 });
    expect(graded.positive.passed).toBe(false);
    expect(graded.vouches).toBe(false);
  });

  it('★★★ a non-empty population that saw tool calls vouches for itself', () => {
    const graded = gradeControls({ population: 5, positive: 255, negative: 0 });
    expect(graded.positive.passed).toBe(true);
    expect(graded.vouches).toBe(true);
  });

  it('★★★ the negative control failing sinks the population even when the positive fired', () => {
    // An over-broad matcher that finds a fabricated name is matching TEXT, not tool_use blocks.
    const graded = gradeControls({ population: 5, positive: 255, negative: 1 });
    expect(graded.negative.passed).toBe(false);
    expect(graded.vouches).toBe(false);
  });

  it('★★★ THE MISFIRE, END TO END: one empty population must not sink a measured one', () => {
    // The bug and its overcorrection are both wrong. The run publishes because the population that
    // was actually measured vouched; the empty one abstains rather than voting either way.
    const topLevel = gradeControls({ population: 0, positive: 0, negative: 0 });
    const subagent = gradeControls({ population: 5, positive: 255, negative: 0 });
    expect(runIsPublishable([topLevel, subagent]).ok).toBe(true);
    expect(runIsPublishable([subagent, gradeControls({ population: 6, positive: 0, negative: 0 })]).ok)
      .toBe(false);
  });

  it('★★★ every population empty is NOT a clean run — nothing was measured', () => {
    // "0 of 27" was published from a rebuild window once. A run that measured nothing has no result
    // to report, and reporting it as fine is how that happened.
    const all = runIsPublishable([
      gradeControls({ population: 0, positive: 0, negative: 0 }),
      gradeControls({ population: 0, positive: 0, negative: 0 }),
    ]);
    expect(all.ok).toBe(false);
    expect(all.why).toMatch(/nothing was measured/);
  });

  it('★★ a missing count is a broken caller, not a zero', () => {
    expect(() => gradeControls({ population: 5, positive: undefined, negative: 0 })).toThrow(/positive/);
    expect(() => gradeControls({ population: -1, positive: 0, negative: 0 })).toThrow(/population/);
  });

  it('★★★ THE WIRING: the counter grades BOTH populations, not one summed over the other', () => {
    // The defect was invisible in the pure function because the pure function was never wrong. It
    // lived at the call site, where `totals` (top-level) was handed in as the whole run's control.
    const src = read('../../../scripts/measure-verb-adoption.mjs');
    expect(src, 'the nested tally must be graded').toMatch(/gradeControls\(\{\s*\n?\s*population: nestedTally\.sessions/);
    expect(src, 'the top-level totals must be graded separately').toMatch(/population: totals\.sessions/);
    // The old shape, which summed one population's control across the whole run.
    // expectAbsentWithLiveMatcher, not a bare not.toMatch: I wrote the negative assertion here and
    // hand-rolled its control on the next line, and the ratchet caught it — a matcher I prove
    // myself is a matcher nobody checked. The helper carries the proof with the assertion.
    expectAbsentWithLiveMatcher(
      /passed: totals\.positive > 0/,
      {
        forbidden: 'positive: { names: POSITIVE_CONTROLS, count: totals.positive, passed: totals.positive > 0 },',
        allowed: 'gradeControls({ population: nestedTally.sessions, positive: nestedTally.positive })',
      },
      src,
      'one run-wide positive control cannot vouch for two populations',
    );
  });
});

describe('the gate condition n is recorded, not remembered', () => {
  it('★★★ THE REAL CASE: n going DOWN is impossible and must be flagged, not stored quietly', () => {
    // Under a fixed cutoff a transcript that was in the window stays in it. A drop means deletion,
    // an instrument change, or a previous row that was never a reading of this noun.
    const v = classifyReading(16, 5);
    expect(v.movement).toBe('shrank');
    expect(v.verdictAllowed, 'a shrunk series licenses nothing, even above the gate').toBe(false);
    expect(classifyReading(120, 110).verdictAllowed).toBe(false);
  });

  it('★★★ the gate opens at exactly n = 100, not one above it', () => {
    expect(classifyReading(99, 100).reachedGate).toBe(true);
    expect(classifyReading(98, 99).reachedGate).toBe(false);
    expect(classifyReading(99, 100).verdictAllowed).toBe(true);
  });

  it('★★★ a FIRST reading is not growth', () => {
    // If an absent previous became 0, every first reading would look like the number moving.
    expect(classifyReading(null, 5).movement).toBe('first');
    expect(classifyReading(0, 5).movement).toBe('grew');
    expect(classifyReading(5, 5).movement).toBe('unchanged');
  });

  it('★★★ an empty or malformed ledger yields UNKNOWN, never a zero baseline', () => {
    expect(lastRecordedN('')).toBeNull();
    expect(lastRecordedN(`${COLUMNS.join('\t')}\n`), 'a header alone holds no reading').toBeNull();
    expect(lastRecordedN(`${COLUMNS.join('\t')}\nshort\trow\n`), 'a short row is corrupt').toBeNull();
    const good = formatRow(Object.fromEntries(COLUMNS.map((c) => [c, c === 'n' ? 42 : 'x'])));
    expect(lastRecordedN(`${COLUMNS.join('\t')}\n${good}`)).toBe(42);
  });

  it('★★ a partial row is refused rather than written short', () => {
    const row = Object.fromEntries(COLUMNS.map((c) => [c, 'x']));
    delete row.instrumentSha;
    expect(() => formatRow(row)).toThrow(/instrumentSha/);
  });

  it('★★★ THE PREREGISTRATION AND THE CODE NAME THE SAME WINDOW', () => {
    // Two documents that are each correct can leave a hole between them. This closes it: changing
    // the cutoff in code without changing the preregistration fails here.
    const prereg = read('../../../docs/evidence/m5-scale/PREREGISTERED-did-the-routing-fix-move-subagent-adoption.md');
    expect(prereg).toContain(ADOPTION_WINDOW.since);
    expect(prereg).toContain(`--exclude-project=${ADOPTION_WINDOW.excludeProject}`);
    expect(prereg).toContain('--exclude-instructed');
    expect(prereg, 'the stopping point is part of the preregistration').toContain('n = 100');
    // Negative control: the check can fail. A cutoff the document does not name must be absent.
    expect(prereg).not.toContain('2026-09-03T20:04:28.336Z');
  });

  it('★★★ the counter is invoked with exactly the preregistered arguments', () => {
    expect(counterArgsFor('/root')).toEqual([
      '/root',
      '--since=2026-09-03T20:04:28.335Z',
      '--exclude-project=C--Docker-aify-project-graph',
      '--exclude-instructed',
    ]);
  });

  it('★★★ the ledger command never reads the gated OUTCOME', () => {
    // The counter prints n and the outcome in one JSON. This command runs every cycle, so it must
    // touch only the population side — otherwise the habit of running it breaks the gate.
    const src = read('../../../scripts/n-ledger.mjs');
    for (const forbidden of ['withAtLeastOneGraphCall', 'graphCalls', 'topVerbs', 'perVerb', 'adoptionRate']) {
      expect(src, `${forbidden} is the outcome, which is gated until n = 100`).not.toContain(forbidden);
    }
    // Live matcher: these strings do exist in the counter, so their absence here is a real result.
    const counter = read('../../../scripts/measure-verb-adoption.mjs');
    expect(counter).toContain('withAtLeastOneGraphCall');
    expect(counter).toContain('adoptionRate');
  });
});
