import { describe, expect, it } from 'vitest';

import { isIgnoredDirName, pathContainsIgnoredDir } from '../../../mcp/stdio/ingest/ignored-dirs.js';

describe('ignored dir matching', () => {
  it('treats common build-prefixed scratch directories as ignored', () => {
    expect(isIgnoredDirName('build-linux-techlead')).toBe(true);
    expect(isIgnoredDirName('build_debug')).toBe(true);
    expect(isIgnoredDirName('cmake-build-debug')).toBe(true);
    expect(pathContainsIgnoredDir('build-linux-techlead/generated/file.cpp')).toBe(true);
  });

  it('allows an exact prefixed directory to be opted back in via include sentinel', () => {
    const ignoredDirs = new Set(['build', '!build-linux-techlead']);

    expect(isIgnoredDirName('build-linux-techlead', ignoredDirs)).toBe(false);
    expect(pathContainsIgnoredDir('build-linux-techlead/generated/file.cpp', ignoredDirs)).toBe(false);
    expect(isIgnoredDirName('build-prod', ignoredDirs)).toBe(true);
  });
});
