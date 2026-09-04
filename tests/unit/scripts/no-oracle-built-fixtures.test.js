// ⛔ FORCED DOOR: no test in this suite may build its INPUT out of its EXPECTED value.
//
// 2026-09-04, and I did it twice in ninety minutes while actively looking for it. The pure form:
//
//     for (const [reason, expected, why] of DISCRIMINATOR) {
//       const ready = expected !== false;          // the ORACLE built the STIMULUS
//       expect(fn({ ready, reason })).toBe(expected);
//     }
//
// `cold_no_warm` is emitted with `ready:false`; my table expected `null`; so that line built
// `{ready: true, reason: 'cold_no_warm'}`, a pair `lsp-client.js` never emits, and the row passed
// cleanly over the exact defect it was written to catch. A row whose stimulus comes from its own
// oracle cannot fail.
//
// ⚠ THIS IS A DETECTOR RATHER THAN A RULE BECAUSE MUTATION TESTING CANNOT FIND IT. Mutation asks
// "does this test detect a change from CURRENT behaviour". A fixture built from the oracle answers
// yes, correctly, about a baseline that was wrong to begin with — blind by construction, not by
// weakness. Demonstrated in this repo: the ratchet that pinned the `cold_no_warm` defect killed its
// mutant on the assertion naming the property, in the same session.
//
// ⇒ A KILLED MUTANT LICENSES "this test is sensitive", NEVER "this expectation is correct."
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  scanForOracleBuiltFixtures, KNOWN_BAD, KNOWN_GOOD,
} from '../../../scripts/lib/oracle-built-fixtures.mjs';

const stub = (name) => (name === 'BAD' ? KNOWN_BAD : KNOWN_GOOD);

describe('no test builds its fixture from its oracle', () => {
  it('★★★ POSITIVE CONTROL: the detector fires on the real 2026-09-04 instance', () => {
    // ⛔ WITHOUT THIS THE SWEEP BELOW IS WORTHLESS, AND THAT IS NOT HYPOTHETICAL. The first version
    // of this detector reported 0 hits across 481 files while blind: a heredoc had eaten a
    // word-boundary escape into a literal BACKSPACE, so it was matching a control character present
    // in no file. A clean sweep and a blind sweep produced IDENTICAL output.
    const hits = scanForOracleBuiltFixtures(['BAD'], stub);
    expect(hits.length, 'detector is blind — every assertion below would pass vacuously').toBe(1);
    expect(hits[0].text).toContain('const ready = expected');
  });

  it('★★★ NEGATIVE CONTROL: it stays quiet on a producer-sourced fixture', () => {
    // Proves it discriminates rather than flagging every table that mentions its oracle.
    expect(scanForOracleBuiltFixtures(['GOOD'], stub)).toEqual([]);
  });

  it('★★★ THE SWEEP: no test file in the repo has the shape', () => {
    const files = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' })
      .split('\n').filter((f) => f.endsWith('.test.js'));
    expect(files.length, 'no test files found — the sweep would be vacuous').toBeGreaterThan(100);

    const hits = scanForOracleBuiltFixtures(files, (f) => readFileSync(f, 'utf8'));
    const report = hits.map((h) => `${h.file}:${h.line}  ${h.text}`);
    expect(report, 'a fixture field is computed from the expected value — the row cannot fail')
      .toEqual([]);
  });
});
