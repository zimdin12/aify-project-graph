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

  it('marks complete:true — the caller should not need another call to learn it', () => {
    // Scope to the early-return block rather than a fixed character window: the
    // explanatory comment above it is long by design, and a window-based assertion
    // would break on any edit to prose rather than to behaviour.
    const block = src.slice(src.indexOf('if (files.length === 0)'));
    const early = block.slice(0, block.indexOf('const budgetMs'));
    expect(early).toMatch(/complete: true/);
  });

  it('offers the escape hatch for a forced re-collect', () => {
    expect(src).toMatch(/pass resume:false to force a full re-collect/);
  });
});
