import { beforeEach, describe, expect, it, vi } from 'vitest';

const lockMock = vi.fn();
const mkdirMock = vi.fn();

vi.mock('proper-lockfile', () => ({
  default: { lock: lockMock },
  lock: lockMock,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    mkdir: mkdirMock,
  };
});

describe('write lock wrapper', () => {
  beforeEach(() => {
    lockMock.mockReset();
    mkdirMock.mockReset();
  });

  it('acquires and releases the project write lock', async () => {
    const release = vi.fn();
    lockMock.mockResolvedValue(release);

    const { withWriteLock } = await import('../../../mcp/stdio/freshness/lock.js');
    const result = await withWriteLock('C:/repo', async () => 'ok');

    expect(result).toBe('ok');
    expect(mkdirMock).toHaveBeenCalledWith('C:/repo/.aify-graph', { recursive: true });
    expect(lockMock).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('releases the lock when the callback fails', async () => {
    const release = vi.fn();
    lockMock.mockResolvedValue(release);

    const { withWriteLock } = await import('../../../mcp/stdio/freshness/lock.js');

    await expect(withWriteLock('C:/repo', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(release).toHaveBeenCalled();
  });
});
