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
import {
  testsImporting, stagedSourceFiles, stagedTestFiles, corpusWideTests,
} from '../../../scripts/related-tests.mjs';

const TESTS = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.test.js'));

describe('related-tests finds what already describes the contract', () => {
  // ⭐ INDEPENDENT SOURCE, NAMED (ef-manager's rule for ratchets and contract tests): the expectation
  // below does NOT come from this detector's behaviour. It comes from a HISTORICAL FACT — on
  // 2026-09-04 I edited mcp/stdio/query/verbs/packet-evidence.js and did not run
  // tests/unit/query/packet-evidence.test.js, which had existed since 2026-08-12 and imported the
  // function I changed. The full suite then went red with 20 failures across four files.
  //
  // That pairing was true before this script existed and would stay true if it were deleted, which
  // is what makes it an oracle rather than a description. A ratchet that cannot name such a source
  // is only asserting that the code still does what it does.
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

  it('★★★ scripts/ is source too — the guard must cover the room it stands in', () => {
    // ⛔ The first version filtered `mcp/` only, so the commit that added
    // scripts/lib/oracle-built-fixtures.mjs ran NO related tests. A guard blind to its own code.
    expect(stagedSourceFiles(['scripts/lib/oracle-built-fixtures.mjs']))
      .toEqual(['scripts/lib/oracle-built-fixtures.mjs']);
    expect(stagedSourceFiles(['scripts/related-tests.mjs'])).toEqual(['scripts/related-tests.mjs']);
    // ...and its own test file must still be found from it.
    expect(testsImporting(['scripts/lib/oracle-built-fixtures.mjs'], TESTS))
      .toContain('tests/unit/scripts/no-oracle-built-fixtures.test.js');
  });

  it('★★ an empty staged set asks for nothing', () => {
    expect(testsImporting([], TESTS)).toEqual([]);
  });
});

// ⛔ THE SECOND MISS, 2026-09-08, AND IT IS THE SAME SHAPE ONE LEVEL UP.
//
// `tests/unit/negative-assertions-are-controlled.test.js` reads every test file in the repo and
// imports none of them. `testsImporting` matches import specifiers, so it is STRUCTURALLY unable to
// select that file — no staged path can ever produce it. The ratchet therefore caught three of my
// bare-negative violations at full-suite time, ~20 minutes each, three times in one session, when a
// pre-commit hook existed the whole time and had run for every one of those commits.
//
// ⭐ INDEPENDENT SOURCE, NAMED: the pairing asserted below is a historical fact, not a description
// of this code. The ratchet has read the whole `tests/` tree since 0d97826 and has never contained
// an import of a test file. That was true before `corpusWideTests` existed and stays true if it is
// deleted.
describe('a test that walks a tree is related to a commit no import edge connects it to', () => {
  it('★★★ THE DEFECT ITSELF: import matching cannot reach the ratchet, from anything', () => {
    // ⛔ THIS IS THE ANCHOR FOR WHY A SECOND MECHANISM EXISTS. If this ever starts passing a hit
    // back, the ratchet has grown an import edge and the extra selection below may be redundant.
    // The subject must be in the state the claim is about, so the staged path is the ratchet's own.
    expect(testsImporting(['tests/unit/negative-assertions-are-controlled.test.js'], TESTS))
      .toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: the enumerating detector finds the file that caught me three times', () => {
    expect(corpusWideTests(TESTS), 'the ratchet reads every test file and imports none of them')
      .toContain('tests/unit/negative-assertions-are-controlled.test.js');
  });

  it('★★★ NEGATIVE CONTROL: an ordinary unit test is NOT called corpus-wide', () => {
    // A detector that flags everything selects the full suite and gets bypassed within a day.
    // packet-evidence.test.js imports the module it tests and enumerates nothing.
    const wide = corpusWideTests(TESTS);
    // ⛔ LIVENESS FIRST. An empty array satisfies every `not.toContain` ever written, so the
    // rejection below means nothing until the detector is known to be speaking.
    expect(wide.length, 'the detector must have selected something before its refusals count')
      .toBeGreaterThan(0);
    expect(wide).not.toContain('tests/unit/query/packet-evidence.test.js');
    expect(wide.length, 'and it must be a minority of the corpus, or the hook is a full-suite run')
      .toBeLessThan(TESTS.length / 4);
  });

  it('★★★ a TEST-ONLY commit is no longer a commit that runs nothing', () => {
    // ⛔ `stagedSourceFiles` returns [] for a test-only change, and the hook then exited 0 having
    // selected nothing — so the file just edited, the one most likely to be wrong, was the one
    // thing not run.
    const staged = ['tests/unit/query/packet-evidence.test.js'];
    expect(stagedSourceFiles(staged), 'the source filter is still correct — it is not the fix')
      .toEqual([]);
    expect(stagedTestFiles(staged)).toEqual(['tests/unit/query/packet-evidence.test.js']);
  });

  it('★★ the staged-test filter takes tests and nothing else', () => {
    expect(stagedTestFiles([
      'docs/evidence/suite/latest.log',
      'mcp/stdio/query/verbs/callers.js',
      'tests/helpers/live-matcher.js',
      'tests/unit/a.test.js',
    ])).toEqual(['tests/unit/a.test.js']);
  });
});
