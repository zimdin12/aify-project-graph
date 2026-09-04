// ⛔ THE MISS THIS INSTRUMENT EXISTS FOR, AND IT IS ITS OWN POSITIVE CONTROL.
//
// 2026-09-04: I edited `mcp/stdio/query/verbs/packet-evidence.js`, ran the six-case file I had just
// written to describe my change, saw green, and committed. `tests/unit/query/packet-evidence.test.js`
// had existed since 2026-08-12 and referenced `buildEvidenceBlock` four times. I never ran it. The
// full suite then went red with 20 failures across four files I had not opened.
//
// ⭐ The file I wrote describes MY INTENT. The file that already existed describes THE CONTRACT I WAS
// BREAKING. I ran the one that agreed with me.
//
// The detector is checked against that real case rather than a synthetic one — the repo's own rule
// after the hazard scanner failed to see the defect it was built from.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { testsImporting, stagedSourceFiles } from '../../../scripts/related-tests.mjs';

const TESTS = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.test.js'));

describe('related-tests finds what already describes the contract', () => {
  it('★★★ POSITIVE CONTROL: it finds the exact file the 2026-09-04 miss skipped', () => {
    const hits = testsImporting(['mcp/stdio/query/verbs/packet-evidence.js'], TESTS);
    expect(hits, 'the historical miss must be caught, or this instrument is decoration')
      .toContain('tests/unit/query/packet-evidence.test.js');
  });

  it('★★★ NEGATIVE CONTROL: a source nothing imports returns ABSENT', () => {
    // A detector that cannot return an empty set cannot be trusted when it returns a non-empty one.
    expect(testsImporting(['mcp/stdio/zzq-not-a-real-file.js'], TESTS)).toEqual([]);
  });

  it('★★★ a bare MENTION in a comment does not pull a test in — only an import specifier', () => {
    // Otherwise every doc-ish test that names a file becomes "related" and the hook turns into noise
    // that gets bypassed, which is the failure mode of every gate this repo has retired.
    expect(testsImporting(['mcp/stdio/zzq-mentioned-only.js'], TESTS)).toEqual([]);
  });

  it('★★ the staged filter ignores docs, evidence and test files', () => {
    expect(stagedSourceFiles([
      'docs/evidence/suite/latest.log',
      'docs/x.md',
      'tests/unit/a.test.js',
      'mcp/stdio/query/verbs/packet-evidence.js',
    ])).toEqual(['mcp/stdio/query/verbs/packet-evidence.js']);
  });

  it('★★ an empty staged set asks for nothing', () => {
    expect(testsImporting([], TESTS)).toEqual([]);
  });
});
