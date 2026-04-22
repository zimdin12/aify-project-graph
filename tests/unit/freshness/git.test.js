import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync,
}));

import { getDirtyFileEntries, getDirtyFiles } from '../../../mcp/stdio/freshness/git.js';

describe('getDirtyFiles', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-git-'));
    execFileSync.mockReset();
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('filters default ignored scratch paths from git status output', async () => {
    execFileSync.mockReturnValue(
      ' M src/app.py\n?? .codex_tmp/task89batch/tmp.py\n?? worktrees/echoes/scratch.cpp\n',
    );

    const files = await getDirtyFiles(repoRoot);
    expect(files).toEqual(['src/app.py']);
  });

  it('honors .aifyignore additions when filtering dirty files', async () => {
    await writeFile(join(repoRoot, '.aifyignore'), 'scratch\n');
    execFileSync.mockReturnValue(' M src/app.py\n?? scratch/out.py\n');

    const files = await getDirtyFiles(repoRoot);
    expect(files).toEqual(['src/app.py']);
  });

  it('honors .aifyinclude removals so intentionally-included dirs still refresh', async () => {
    await writeFile(join(repoRoot, '.aifyinclude'), '.codex_tmp\n');
    execFileSync.mockReturnValue('?? .codex_tmp/task89batch/tmp.py\n');

    const files = await getDirtyFiles(repoRoot);
    expect(files).toEqual(['.codex_tmp/task89batch/tmp.py']);
  });

  it('preserves tracked vs untracked status in the richer dirty-file entry API', async () => {
    execFileSync.mockReturnValue(' M src/app.py\n?? src/new_file.py\n');

    const entries = await getDirtyFileEntries(repoRoot);
    expect(entries).toEqual([
      { path: 'src/app.py', status: ' M', untracked: false },
      { path: 'src/new_file.py', status: '??', untracked: true },
    ]);
  });
});
