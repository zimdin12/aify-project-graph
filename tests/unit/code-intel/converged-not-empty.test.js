// "NOTHING TO COLLECT" AND "ALREADY COLLECTED" ARE DIFFERENT ANSWERS.
//
// Found by dogfooding the TS/JS collector on APG's own source. The second run
// returned in 33ms with status ok and the note "no first-party source files found to
// collect" — on a repo full of source files. Resume had worked perfectly and the
// remainder was legitimately empty, but:
//   - the message asserted a cause that was FALSE (files were found; they were done);
//   - every resume field came back undefined, so a caller could not distinguish
//     CONVERGED from BROKEN ENUMERATION.
//
// Same defect this pass has removed repeatedly — a message naming an unverified
// cause, and a state the response could not express. It survived because the early
// return predates resume and nobody re-read it afterwards, which is the same "one
// side of a pair changed alone" shape as the resume/invalidation interaction.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/code-intel/providers/lsp-collect.js'),
  'utf8',
);

describe('converged collection is distinguishable from an empty one', () => {
  it('reports already_collected when resume emptied the remainder', () => {
    expect(src).toMatch(/code: 'already_collected'/);
    expect(src).toMatch(/The collection is COMPLETE; re-running is a no-op/);
  });

  it('still says no_files when enumeration genuinely found nothing', () => {
    // The guard must not over-correct: a repo with no source really does have no
    // files, and calling that "already collected" would be the opposite lie.
    expect(src).toMatch(/code: 'no_files'/);
    expect(src).toMatch(/const convergedByResume =/);
  });

  it('carries the resume fields on the empty-remainder path', () => {
    // Their absence was what made converged indistinguishable from broken.
    const block = src.slice(src.indexOf('if (files.length === 0)'));
    const early = block.slice(0, block.indexOf('const budgetMs'));
    for (const f of ['resumedFrom', 'enumeratedTotal', 'resumeLedger', 'complete', 'remaining']) {
      expect(early, `empty-remainder path drops ${f}`).toMatch(new RegExp(f));
    }
  });

  it('marks completeness CONDITIONALLY — an unconditional true was a lie over a capped walk', () => {
    // ⛔ THIS ASSERTION USED TO READ `expect(early).toMatch(/complete: true/)` AND IT WAS WRONG.
    //
    // The caller should not need another call to learn it converged — that part still holds. But
    // `complete: true` was emitted unconditionally, including when the WALK had been truncated,
    // so "nothing pending" described the enumerated list and read as a statement about the repo.
    // Measured at dc26d13: 210 of 554 files collected, and the run reported CONVERGED.
    //
    // ⚠ The test moving with the code is the hazard here, so the assertion is written against the
    // PROPERTY rather than the new literal: completeness must be derived from truncation, and an
    // unconditional true must not come back.
    const block = src.slice(src.indexOf('if (files.length === 0)'));
    const early = block.slice(0, block.indexOf('const budgetMs'));
    expect(early, 'completeness is derived from whether the walk saw everything')
      .toMatch(/complete: !\(enumStats/);
    // ⚠ Through the live matcher, not a bare `not.toMatch`. A negative assertion passes when the
    // thing is absent AND when the instrument is broken, and those look identical. The canaries
    // prove this pattern can fire and that it discriminates before the prohibition is trusted.
    expectAbsentWithLiveMatcher(
      /complete: true/,
      { forbidden: 'complete: true,', allowed: 'complete: !(enumStats && enumStats.truncated),' },
      early,
      'an unconditional completion claim must not return',
    );
  });

  it('offers the escape hatch for a forced re-collect', () => {
    expect(src).toMatch(/pass resume:false to force a full re-collect/);
  });
});
