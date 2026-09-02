// ⛔ NOTHING UNDER docs/evidence/ MAY BE SILENTLY GITIGNORED.
//
// Found 2026-09-02: `docs/evidence/m5-scale/suite-preflight.log` held the full-suite result a commit
// cited as its proof — 444 files, 3682 tests, VITEST_EXIT=0 — and `*.log` in .gitignore meant it was
// never in the repo at all. `git status` was clean, the directory listing showed the file, and
// nothing anywhere said the evidence had been dropped.
//
// That is the shape this arc keeps finding: the failure and the success look IDENTICAL to every
// instrument a reader would casually reach for. "Evidence lives where the work lives, never in temp"
// is a rule I have to remember; a rule is not a remedy. This is the mechanical version.
//
// ⚠ WHAT THIS DOES NOT CLAIM. It checks REACHABILITY into git, not that the content is true, current,
// or worth keeping. A tracked file full of wrong numbers passes this gate — as it should; that is a
// different defect with a different check.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const EVIDENCE = 'docs/evidence';

// Repo-relative, forward-slashed: what git wants and what a reader can paste.
function filesUnder(dir, out = []) {
  for (const entry of readdirSync(join(REPO, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(REPO, rel)).isDirectory()) filesUnder(rel, out);
    else out.push(rel);
  }
  return out;
}

// `git check-ignore --stdin` prints the paths it WOULD ignore. Exit 1 means "none of them", which is
// the passing case, so a non-zero status is not an error here.
//
// ⛔ TWO FLAGS, TWO DEFECTS THIS GATE ALREADY HAD — both found by mutating it, neither by reading it:
//
//   --no-index is REQUIRED. Without it, check-ignore SKIPS TRACKED FILES: the tracked suite log came
//   back "not ignored" while `*.log` matched it perfectly. Every file this gate exists to protect is
//   tracked, so without this flag the gate answers a question about a population it never measures.
//
//   -v must NOT be used. It prints the matching rule even when that rule is a NEGATION, so exit is 0
//   whether the path is ignored or explicitly un-ignored — the diagnostic flag destroys the very
//   discrimination the gate is made of.
function ignoredAmong(paths) {
  if (paths.length === 0) return [];
  try {
    const out = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: REPO, input: paths.join('\n'), encoding: 'utf8',
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    // status 1 = nothing ignored. Any other status is a real failure and must not read as "clean".
    if (e.status === 1) return [];
    throw e;
  }
}

describe('evidence under docs/evidence is reachable from git', () => {
  it('POSITIVE CONTROL: the probe can say IGNORED — and the negation is SCOPED, not global', () => {
    // Without this, a broken `git check-ignore` returning nothing would pass the gate below while
    // measuring nothing at all — the wrong zero that agrees with exactly what we hope to see.
    //
    // The control path is a .log OUTSIDE docs/evidence on purpose. It fires the same `*.log` rule the
    // real defect fired, which proves in one assertion that the probe still says IGNORED and that the
    // fix un-ignored only docs/evidence rather than switching `*.log` off across the repo.
    expect(ignoredAmong(['docs/scratch/run.log'])).toHaveLength(1);
  });

  it('NEGATIVE CONTROL: the probe can say NOT IGNORED', () => {
    // A probe that answered "ignored" for everything would also pass a naive positive control.
    expect(ignoredAmong(['package.json'])).toEqual([]);
  });

  it('POSITIVE CONTROL: there is evidence to check', () => {
    // "No ignored files" is trivially true of an empty directory.
    expect(existsSync(join(REPO, EVIDENCE))).toBe(true);
    expect(filesUnder(EVIDENCE).length).toBeGreaterThan(5);
  });

  it('★ no file under docs/evidence is gitignored', () => {
    // Repo-relative, forward-slashed. An ABSOLUTE Windows path comes back C-QUOTED by git — the
    // failure message read `"C://Docker//...//suite-preflight.log"` — which is exactly the moment an
    // agent needs the path to be copy-pasteable.
    expect(ignoredAmong(filesUnder(EVIDENCE)),
      'a commit citing this file as proof would point at nothing in the repo')
      .toEqual([]);
  });
});
