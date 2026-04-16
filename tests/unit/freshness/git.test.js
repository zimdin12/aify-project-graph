import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync,
}));

describe('git freshness helpers', () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

  it('returns the current HEAD commit', async () => {
    execFileSync.mockReturnValueOnce('0123456789abcdef0123456789abcdef01234567\n');

    const { getHeadCommit } = await import('../../../mcp/stdio/freshness/git.js');
    const head = await getHeadCommit('C:/repo');

    expect(head).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(execFileSync).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], {
      cwd: 'C:/repo',
      encoding: 'utf8',
    });
  });

  it('lists dirty tracked and untracked files', async () => {
    execFileSync.mockReturnValueOnce(' M app.py\n?? notes.txt\n');

    const { getDirtyFiles } = await import('../../../mcp/stdio/freshness/git.js');
    const dirty = await getDirtyFiles('C:/repo');

    expect(dirty).toEqual(['app.py', 'notes.txt']);
    expect(execFileSync).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
      cwd: 'C:/repo',
      encoding: 'utf8',
    });
  });

  it('lists changed files across commits', async () => {
    execFileSync.mockReturnValueOnce('src/app.py\r\nsrc/lib/util.py\r\n');

    const { getChangedFiles } = await import('../../../mcp/stdio/freshness/git.js');
    const changed = await getChangedFiles('C:/repo', 'HEAD~1', 'HEAD');

    expect(changed).toEqual(['src/app.py', 'src/lib/util.py']);
    expect(execFileSync).toHaveBeenCalledWith('git', ['diff', '--name-only', 'HEAD~1..HEAD'], {
      cwd: 'C:/repo',
      encoding: 'utf8',
    });
  });
});
