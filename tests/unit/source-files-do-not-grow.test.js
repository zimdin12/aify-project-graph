// ⛔ NOTHING STOPPED THE FILES GETTING BIGGER, AND THE BAR HAS BEEN WRITTEN DOWN THE WHOLE TIME.
//
// The standard is explicit: past 400 lines treat it as a signal, past 1000 refactor. A round-4
// review measured the corpus against it and found the bar quietly eroding, with no mechanism that
// would ever notice. A written standard with no instrument is the shape this repo keeps retiring —
// the negative-assertion ratchet exists because the same thing happened to `not.toMatch`.
//
// ⇒ Same remedy, same reason: the counts may go DOWN and never UP. Nobody is going to split twenty
// files tonight, and a rule demanding that would be switched off within a day. What this buys is
// that every new oversized file has to justify itself at the moment it is written, which is the
// only moment anyone will look.
//
// ⭐ AND THE BUDGET COUNTS CODE, NOT PHYSICAL LINES — see tests/helpers/code-lines.js for why.
// Enforcing physical lines in a codebase whose comments carry its evidence would pay authors to
// delete the evidence. Measured 2026-09-08: 7 files exceed 1000 PHYSICAL lines and ZERO exceed
// 1000 lines of code.
import { describe, it, expect } from 'vitest';
import { codeLines, measureSources } from '../helpers/code-lines.js';

// Fixed 2026-09-08 by measurement, not by choice. Both may fall; neither may rise.
const BASELINE_OVER_400 = 20;
// ⛔ THIS ONE IS A CEILING, NOT A RATCHET. Zero files exceed 1000 lines of code today, and the
// standard says that size demands a refactor — so the honest baseline is the one that forbids the
// first offender rather than grandfathering it.
const CEILING_OVER_1000 = 0;

describe('source files do not grow past the bar', () => {
  it('★★★ THE COUNTER SPEAKS, AND CAN SAY ZERO — controls first', () => {
    // ⛔ WITHOUT THIS THE WHOLE FILE IS DECORATION. A `codeLines` that returned 0 for everything
    // would report zero files over either budget and pass for ever, getting greener as the code
    // got worse. The budgets below mean nothing until the instrument is known to work.
    expect(codeLines('const a = 1;\nconst b = 2;\nexport { a, b };'), 'plain code').toBe(3);
    expect(codeLines('/*\n a\n b\n*/\nconst x = 1;'), 'block comment excluded').toBe(1);
    expect(codeLines('const x = 1; // note'), 'a trailing comment does not hide the code').toBe(1);
    // ...and it must be able to return ABSENT, or a zero above proves nothing.
    expect(codeLines('// only a comment'), 'comment-only file').toBe(0);
    expect(codeLines(''), 'empty file').toBe(0);
  });

  it('★★★ THE POPULATION IS REAL — a walk that found nothing would satisfy every budget', () => {
    const rows = measureSources();
    expect(rows.length, 'no source files found — the walk is broken, not the code perfect')
      .toBeGreaterThan(100);
    expect(rows[0].code, 'the largest file must have some code in it').toBeGreaterThan(0);
  });

  it('⛔ NO FILE EXCEEDS 1000 LINES OF CODE — a ceiling, not a ratchet', () => {
    const over = measureSources().filter((r) => r.code > 1000)
      .map((r) => `${r.file} (${r.code} code / ${r.physical} physical)`);
    expect(over, 'past 1000 lines the standard says refactor, and today nothing is over')
      .toEqual([]);
    expect(over.length).toBeLessThanOrEqual(CEILING_OVER_1000);
  });

  it('★★ the number of files over 400 lines of code never INCREASES', () => {
    const rows = measureSources();
    const over = rows.filter((r) => r.code > 400);

    // Reported, not just asserted: a bare count tells an author nothing about where to look.
    if (over.length >= BASELINE_OVER_400) {
      const worst = rows.slice(0, 5)
        .map((r) => `  ${String(r.code).padStart(4)} code / ${String(r.physical).padStart(4)} phys  ${r.file}`)
        .join('\n');
      // eslint-disable-next-line no-console
      console.log(`\nFILES OVER 400 LINES OF CODE: ${over.length} (baseline ${BASELINE_OVER_400})\n${worst}\n`);
    }

    expect(
      over.length,
      `${over.length} files exceed 400 lines of CODE, baseline ${BASELINE_OVER_400}. `
      + 'This number may only go down. If a change made a file bigger, split it or move the new '
      + 'behaviour somewhere it belongs; if a change made one smaller, lower the baseline in the '
      + 'same commit so the slack cannot be spent later.',
    ).toBeLessThanOrEqual(BASELINE_OVER_400);
  });
});
