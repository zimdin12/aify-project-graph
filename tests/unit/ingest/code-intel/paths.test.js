import { describe, it, expect } from 'vitest';
import { toRepoRelative, isRepoRelative } from '../../../../mcp/stdio/ingest/code-intel/paths.js';

describe('code-intel paths', () => {
  it('normalizes absolute path inside projectRoot to forward-slash repo-relative', () => {
    const result = toRepoRelative('/repo/root', '/repo/root/src/foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('normalizes Windows-style absolute path inside projectRoot', () => {
    const result = toRepoRelative('C:\\repo\\root', 'C:\\repo\\root\\src\\foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('passes through already-repo-relative forward-slash paths unchanged', () => {
    const result = toRepoRelative('/repo/root', 'src/foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('rewrites backslashes in already-relative paths', () => {
    const result = toRepoRelative('/repo/root', 'src\\foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('throws when path escapes projectRoot', () => {
    expect(() => toRepoRelative('/repo/root', '/elsewhere/foo.cpp')).toThrow(/outside projectRoot/);
  });

  it('throws when path escapes projectRoot via .. traversal', () => {
    expect(() => toRepoRelative('/repo/root', '/repo/root/../escape.cpp')).toThrow(/outside projectRoot/);
  });

  it('isRepoRelative returns true for forward-slash relative paths', () => {
    expect(isRepoRelative('src/foo.cpp')).toBe(true);
    expect(isRepoRelative('')).toBe(true);
  });

  it('isRepoRelative returns false for absolute paths', () => {
    expect(isRepoRelative('/abs/path')).toBe(false);
    expect(isRepoRelative('C:/abs/path')).toBe(false);
    expect(isRepoRelative('C:\\abs\\path')).toBe(false);
  });

  it('isRepoRelative returns false for paths with backslashes', () => {
    expect(isRepoRelative('src\\foo.cpp')).toBe(false);
  });
});
