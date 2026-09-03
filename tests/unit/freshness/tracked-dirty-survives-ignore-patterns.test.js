// A TRACKED FILE IS TRACKED. .gitignore DOES NOT APPLY TO IT.
//
// Git's own rule: once a file is tracked, ignore patterns are irrelevant to it. `git status` reports
// its modifications regardless of any pattern that would have excluded it before it was added. Our
// dirty counter did not follow that rule — it took `git status --porcelain` output and re-filtered it
// through our own ignore evaluation, which can only ever DROP files git deliberately reported.
//
// Measured on this repository, 2026-09-03, on an otherwise-clean tree:
//
//     git status --porcelain      ->  " M docs/evidence/suite/latest.log"
//     getDirtyFileEntriesSync()   ->  []
//
// `.gitignore:4` is `*.log`; `.gitignore:11` is `!docs/evidence/suite/*.log`, a NEGATION written
// deliberately so suite evidence could be committed. Git honours the negation. Our matcher did not,
// so the one file this project uses as its push evidence was invisible to its own freshness
// machinery, and `graph_packet` rendered `dirty=0` on a tree with a tracked modification.
//
// ⛔ WHY THIS IS THE SEVERE DIRECTION. `getTrackedDirtyFilesSync`'s own header says "every surface
// that reports a dirty COUNT to influence trust routes through here." A dirty count that reads LOW
// tells an agent the snapshot agrees with the source when it does not — the fail-open direction, and
// the same shape as every other finding in this arc.
//
// ⚠ SCOPE OF THE FIX, deliberately narrow. The ignore filter is LEGITIMATE for one input and one
// only: git reports an untracked directory as a single `?? dir/` entry, and expanding it walks the
// filesystem, so those file paths never passed git's own per-file ignore check. Paths git NAMED are
// already ignore-correct by git's evaluation and must not be re-filtered. `pathContainsIgnoredDir`
// itself is unchanged — it has 11 call sites across ingest, the watcher and collection, and altering
// its semantics would change what gets INDEXED, which is a different claim needing different evidence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getTrackedDirtyFilesSync, getDirtyFilesSync } from '../../../mcp/stdio/freshness/git.js';

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

let repo;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-ignore-negation-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  await mkdir(join(repo, 'src'), { recursive: true });
  await mkdir(join(repo, 'evidence', 'suite'), { recursive: true });
  // The real shape from this repository: a broad pattern, then a deliberate negation re-including
  // one directory, so the file below is TRACKED and NOT ignored by git.
  await writeFile(join(repo, '.gitignore'), '*.log\n!evidence/suite/*.log\n');
  await writeFile(join(repo, 'src', 'plain.js'), 'export const a = 1;\n');
  await writeFile(join(repo, 'evidence', 'suite', 'latest.log'), 'run 1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'seed');
});

afterEach(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

describe('a tracked file stays visible to the dirty counter whatever .gitignore says', () => {
  it('★★★ a modified tracked file matching an ignore pattern is COUNTED', async () => {
    // Preconditions, asserted rather than assumed: git itself must consider this file tracked and
    // must report it as modified. If git does not report it, the fixture is wrong and any verdict
    // below would describe something other than the defect.
    const tracked = execFileSync('git', ['-C', repo, 'ls-files', 'evidence/suite/latest.log'],
      { encoding: 'utf8' }).trim();
    expect(tracked, 'fixture precondition: the file must be TRACKED').toBe('evidence/suite/latest.log');

    await appendFile(join(repo, 'evidence', 'suite', 'latest.log'), 'run 2\n');

    const porcelain = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(porcelain, 'fixture precondition: git must report the modification').toMatch(/evidence\/suite\/latest\.log/);

    expect(
      getTrackedDirtyFilesSync(repo),
      'git reported this tracked file as modified; re-filtering git output through our own ignore '
      + 'rules can only drop what git deliberately named, and a low dirty count fails OPEN',
    ).toContain('evidence/suite/latest.log');
  });

  it('★★ POSITIVE CONTROL — an ordinary tracked file is counted, so the assertion above can fail', async () => {
    // Without this, a counter that returned everything unconditionally would pass the test above and
    // the suite would certify a broken instrument. This is the control whose absence has produced
    // false passes in this repository before.
    await appendFile(join(repo, 'src', 'plain.js'), 'export const b = 2;\n');
    expect(getTrackedDirtyFilesSync(repo)).toContain('src/plain.js');
  });

  it('★★ NEGATIVE CONTROL — a genuinely ignored UNTRACKED file is still excluded', async () => {
    // The fix must not become "count everything". A file git does ignore, and which was never added,
    // must stay out of both lists — otherwise we have traded a fail-open for a fail-loud and the
    // 2026-07-27 field report (dirty=592 from untracked noise) comes straight back.
    await writeFile(join(repo, 'src', 'scratch.log'), 'ignored\n');
    const porcelain = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(porcelain, 'fixture precondition: git must NOT report an ignored untracked file')
      .not.toMatch(/scratch\.log/);

    expect(getTrackedDirtyFilesSync(repo)).not.toContain('src/scratch.log');
    expect(getDirtyFilesSync(repo)).not.toContain('src/scratch.log');
  });

  it('★★ an untracked directory is still expanded AND still ignore-filtered', async () => {
    // The one input where the ignore filter is legitimate: git names the DIRECTORY, not the files,
    // so the walk's output never passed git's per-file check. `keep.js` must appear; `noisy.log`,
    // which the walk finds but `*.log` covers, must not.
    await mkdir(join(repo, 'fresh'), { recursive: true });
    await writeFile(join(repo, 'fresh', 'keep.js'), 'export const c = 3;\n');
    await writeFile(join(repo, 'fresh', 'noisy.log'), 'noise\n');

    const all = getDirtyFilesSync(repo);
    expect(all, 'the untracked directory must still be expanded to its files').toContain('fresh/keep.js');
    expect(all, 'expansion output is NOT git-checked per file, so it still needs the ignore filter')
      .not.toContain('fresh/noisy.log');
  });
});
