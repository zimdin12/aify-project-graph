// ⛔ THE FAILURE THIS GUARD EXISTS FOR, AND IT COST A RED SUITE THE SAME DAY.
//
// The workflow was: edit a file, apply a mutant, run the test, `git checkout -- <file>` to undo the
// mutant. That checkout restores from the INDEX, so it reverted the mutant AND an extraction that was
// not committed yet. The next commit captured the tests without the function they imported.
//
// "Commit before mutating" is the rule that prevents it. It is in my memory under its own name. I
// walked into it anyway, because nothing enforced it — and every rule kept this session had a door
// behind it while every rule broken was one I was trusting myself to remember.
//
// ⭐ THE GUARD DOES NOT CHECK FOR A CLEAN TREE. It removes git from the restore path, so an
// uncommitted edit in the same file survives a mutation cycle. Unconstructible beats guarded.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyMutation, restore, restoreAll, outstanding, withMutation,
} from '../../../scripts/lib/mutate.mjs';

const file = () => {
  const p = join(mkdtempSync(join(tmpdir(), 'apg-mut-')), 'subject.js');
  writeFileSync(p, 'export const answer = 42;\nexport const other = 7;\n', 'utf8');
  return p;
};

afterEach(() => restoreAll());

describe('a mutation cycle cannot destroy uncommitted work', () => {
  it('★★★ THE REAL CASE: an UNCOMMITTED edit survives the mutate/restore cycle', () => {
    // This is what `git checkout --` got wrong. The file here has a change that exists nowhere in
    // git; after mutating and restoring, that change must still be present.
    const p = file();
    writeFileSync(p, 'export const answer = 42;\nexport const uncommittedWork = true;\n', 'utf8');

    applyMutation(p, 'answer = 42', 'answer = 0');
    expect(readFileSync(p, 'utf8'), 'the mutant should be live mid-cycle').toContain('answer = 0');

    restore(p);
    const after = readFileSync(p, 'utf8');
    expect(after, 'the uncommitted edit must survive').toContain('uncommittedWork = true');
    expect(after, 'and the mutant must be gone').toContain('answer = 42');
  });

  it('★★★ POSITIVE CONTROL: the mutation genuinely lands, or restore proves nothing', () => {
    // A restore that always "works" because nothing ever changed is the shape of a guard that
    // refuses everything. The mutation has to be observable first.
    const p = file();
    const before = readFileSync(p, 'utf8');
    applyMutation(p, '42', '0');
    expect(readFileSync(p, 'utf8')).not.toBe(before);
    restore(p);
    expect(readFileSync(p, 'utf8')).toBe(before);
  });

  it('★★★ an anchor matching more than once is REFUSED, not applied', () => {
    // ⛔ A mutation with an unknown blast radius is a perturbation, not the inverse of a fix. This
    // repo has already recorded a mutant that changed semantics rather than removing a fix, survived,
    // and nearly made me doubt correct code.
    const p = file();
    writeFileSync(p, 'const a = 1;\nconst b = 1;\n', 'utf8');
    expect(() => applyMutation(p, '= 1', '= 2')).toThrow(/occurs 2 times/);
    expect(readFileSync(p, 'utf8'), 'a refused mutation must not touch the file')
      .toBe('const a = 1;\nconst b = 1;\n');
  });

  it('★★★ an anchor matching ZERO times is refused too', () => {
    // The direction that silently does nothing: without this, a typo in the anchor produces a
    // "surviving mutant" that was never applied — a false all-clear.
    const p = file();
    expect(() => applyMutation(p, 'not-in-this-file', 'x')).toThrow(/occurs 0 times/);
  });

  it('★★★ withMutation restores even when the body THROWS', () => {
    // The crash path is the one that matters: a failing assertion inside the body must not leave the
    // mutant on disk.
    const p = file();
    const before = readFileSync(p, 'utf8');
    expect(async () => {
      await withMutation({ file: p, find: '42', replace: '0' }, () => { throw new Error('boom'); });
    }).rejects.toThrow('boom');
    return Promise.resolve().then(() => {
      expect(outstanding(), 'nothing should still be held after the finally block').not.toContain(p);
      expect(readFileSync(p, 'utf8')).toBe(before);
    });
  });

  it('★★ restoreAll puts back every file, so one crash cannot strand several', () => {
    const a = file();
    const b = file();
    const beforeA = readFileSync(a, 'utf8');
    const beforeB = readFileSync(b, 'utf8');
    applyMutation(a, '42', '0');
    applyMutation(b, '42', '0');
    expect(outstanding()).toHaveLength(2);

    expect(restoreAll()).toBe(2);
    expect(readFileSync(a, 'utf8')).toBe(beforeA);
    expect(readFileSync(b, 'utf8')).toBe(beforeB);
    expect(outstanding()).toHaveLength(0);
  });

  it('★★★ THE STRUCTURAL GUARANTEE: the module never consults git at all', () => {
    // The behaviour tests above use temp files, which git would not have touched anyway — so they
    // demonstrate restore works, not that it is IMMUNE to the specific hazard. The immunity is
    // structural: there is no code path through git, so there is no index to restore from and no
    // uncommitted work to lose. Asserted on the source, because that is where the property lives.
    const src = readFileSync(
      fileURLToPath(new URL('../../../scripts/lib/mutate.mjs', import.meta.url)), 'utf8');
    const NL = String.fromCharCode(10);
    const code = src.split(NL).filter((l) => !l.trim().startsWith('//')).join(NL);
    // expectAbsentWithLiveMatcher, not a bare not.toMatch: the ratchet has caught me four times, and
    // a negative assertion is only evidence if the matcher could have fired.
    expectAbsentWithLiveMatcher(
      /execFile|execSync|spawn|child_process/,
      { forbidden: "import { execFileSync } from 'node:child_process';",
        allowed: "import { readFileSync, writeFileSync } from 'node:fs';" },
      code,
      'a restore that shells out can revert more than it wrote',
    );
    expectAbsentWithLiveMatcher(
      /checkout/,
      { forbidden: 'execFileSync("git", ["checkout", "--", file])',
        allowed: 'writeFileSync(file, original)' },
      code,
      'restore must never go through git',
    );
  });
});
