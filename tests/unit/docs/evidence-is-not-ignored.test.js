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
const EVIDENCE = join(REPO, 'docs/evidence');

function filesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesUnder(path, out);
    else out.push(path);
  }
  return out;
}

// `git check-ignore --stdin` prints the paths it WOULD ignore. Exit 1 means "none of them", which is
// the passing case, so a non-zero status is not an error here.
function ignoredAmong(paths) {
  if (paths.length === 0) return [];
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
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
  it('POSITIVE CONTROL: the probe can say IGNORED', () => {
    // Without this, a broken `git check-ignore` returning nothing would pass the gate below while
    // measuring nothing at all — the wrong zero that agrees with exactly what we hope to see.
    expect(ignoredAmong([join(REPO, 'node_modules/some-package/index.js')]))
      .toHaveLength(1);
  });

  it('NEGATIVE CONTROL: the probe can say NOT IGNORED', () => {
    // A probe that answered "ignored" for everything would also pass a naive positive control.
    expect(ignoredAmong([join(REPO, 'package.json')])).toEqual([]);
  });

  it('POSITIVE CONTROL: there is evidence to check', () => {
    // "No ignored files" is trivially true of an empty directory.
    expect(existsSync(EVIDENCE)).toBe(true);
    expect(filesUnder(EVIDENCE).length).toBeGreaterThan(5);
  });

  it('★ no file under docs/evidence is gitignored', () => {
    const dropped = ignoredAmong(filesUnder(EVIDENCE))
      .map((p) => p.replace(/\\/g, '/').replace(/.*docs\/evidence\//, 'docs/evidence/'));
    expect(dropped, 'a commit citing this file as proof would point at nothing in the repo')
      .toEqual([]);
  });
});
