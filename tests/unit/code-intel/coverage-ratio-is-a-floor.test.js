import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCompileDbCoverage } from '../../../mcp/stdio/code-intel/compile-db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ THE SENTENCE THIS PINS SAT BESIDE A WRONG ANSWER.
//
// ef-manager, field-testing on echoes 2026-08-25, was shown
//   "the compile DB covers 122 of ~123 first-party sources (99%) ... That is good coverage, but a
//    caller in any EXCLUDED TU is INVISIBLE to clangd"
// while the same query MISSED FOUR REAL CALLERS in a file that IS in the database.
//
// The old text bounded the risk to the ~1 uncovered source, so a reader concludes at most one
// TU's worth of callers could be hiding. That bound is FALSE, and false in the DANGEROUS
// DIRECTION — it makes a floor look nearly complete, which is what licenses acting on it.
//
// ⚠ A test asserting only "the ratio is present" would have PASSED on the old wording. The defect
// was never a missing number; it was what the number was said to bound. These assert the
// DIRECTION of the claim, on the string a caller actually receives.
//
// ⚠ AND THIS DRIVES THE REAL FUNCTION ON A REAL FIXTURE. A first version read compile-db.js as
// text and asserted on source; the suite-composition guard correctly rejected it as a
// source-contract test that cannot fail when behaviour breaks.

let repo;

/** A repo with `sources` first-party files on disk and a compile DB covering `covered` of them. */
function buildRepo(sources, covered) {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cov-'));
  const src = path.join(repo, 'src');
  fs.mkdirSync(src, { recursive: true });
  const files = [];
  for (let i = 0; i < sources; i += 1) {
    const f = path.join(src, `f${i}.cpp`);
    fs.writeFileSync(f, 'int main(){return 0;}\n');
    files.push(f.replace(/\\/g, '/'));
  }
  const buildDir = path.join(repo, 'build-clangd');
  fs.mkdirSync(buildDir, { recursive: true });
  const db = files.slice(0, covered).map((file) => ({
    directory: buildDir.replace(/\\/g, '/'),
    file,
    command: `clang-cl.exe /std:c++20 -c ${file}`,
  }));
  fs.writeFileSync(path.join(buildDir, 'compile_commands.json'), JSON.stringify(db));
  return repo;
}

beforeEach(() => { repo = null; });
afterEach(() => { if (repo) { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('compile-DB coverage reason — the ratio bounds nothing', () => {
  it('⭐ near-complete coverage does NOT tell the reader the coverage is good', () => {
    // The exact shape ef-manager hit: a high ratio, one source short.
    const root = buildRepo(20, 19);
    const cov = computeCompileDbCoverage({ projectRoot: root });
    expect(cov.reason, 'a reason must be produced at all (positive control)').toBeTruthy();
    expectAbsentWithLiveMatcher(
      /That is good coverage/,
      { forbidden: 'That is good coverage, but a caller', allowed: 'the compile DB covers 19 of ~20' },
      cov.reason,
      'the prose must not editorialise a ratio whose meaning it just got wrong',
    );
  });

  it('⛔ does not bound invisible callers to the EXCLUDED translation units', () => {
    // The load-bearing assertion. Both old phrasings put the risk only in the uncovered remainder.
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 19) });
    expectAbsentWithLiveMatcher(
      /caller in any excluded TU is INVISIBLE/i,
      { forbidden: 'a caller in any excluded TU is INVISIBLE to clangd', allowed: 'a caller anywhere may be invisible' },
      cov.reason,
      'the risk must not be bounded to the uncovered remainder',
    );
    expectAbsentWithLiveMatcher(
      /A caller in any of those is INVISIBLE/i,
      { forbidden: 'A caller in any of those is INVISIBLE to clangd', allowed: 'A caller in a covered TU can also be invisible' },
      cov.reason,
      'the earlier phrasing of the same false bound',
    );
  });

  it('says that being listed in the DB is not evidence the file was indexed or resolved', () => {
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 19) });
    expect(cov.reason).toMatch(/not whether clangd indexed it|LOWER BOUND/i);
  });

  it('carries the measured counter-example, not just an adjective', () => {
    // A caveat with a case behind it survives editing; a bare adjective gets trimmed.
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 19) });
    expect(cov.reason).toMatch(/four real callers were missed in a file that IS/i);
  });

  it('⭐ still reports the ratio — the fix must not delete the number', () => {
    // The over-correction available here was to strip the percentage. It is useful; what was
    // wrong was the sentence around it. Removing it leaves a reader unable to tell a 95% carrier
    // from a 30% one.
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 19) });
    expect(cov.reason).toMatch(/covers 19 of ~20 first-party sources/);
    expect(cov.reason).toMatch(/FLOOR/);
  });

  it('a genuinely poor ratio produces a reason too — the branch below the threshold', () => {
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 4) });
    expect(cov.reason).toBeTruthy();
    expect(cov.reason).toMatch(/LOWER BOUND ON THE RISK, NOT THE WHOLE OF IT/);
  });

  it('⛔ FULL coverage must NOT emit the caveat — the guard has to be able to stay quiet', () => {
    // A warning attached to every answer carries no information. This is the negative control:
    // if it fires here, the prose is decoration rather than a signal.
    const cov = computeCompileDbCoverage({ projectRoot: buildRepo(20, 20) });
    expectAbsentWithLiveMatcher(
      /first-party sources/,
      { forbidden: 'the compile DB covers 20 of ~20 first-party sources', allowed: 'coverage is complete for this query' },
      cov.reason ?? '',
      'a caveat attached to every answer carries no information',
    );
  });
});
