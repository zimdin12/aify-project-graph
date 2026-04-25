import { describe, expect, it } from 'vitest';

import { loadEffectiveIgnoredDirs, isIgnoredDirName, pathContainsIgnoredDir } from '../../../mcp/stdio/ingest/ignored-dirs.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('honors .aifyignore path and glob patterns', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-ignore-'));
    try {
      await writeFile(join(repoRoot, '.aifyignore'), [
        'scratch/generated/*',
        'local-*.cpp',
        '',
      ].join('\n'));

      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);

      expect(pathContainsIgnoredDir('scratch/generated/mesh.cpp', ignoredDirs)).toBe(true);
      expect(pathContainsIgnoredDir('scratch/source/mesh.cpp', ignoredDirs)).toBe(false);
      expect(pathContainsIgnoredDir('src/local-copy.cpp', ignoredDirs)).toBe(true);
      expect(isIgnoredDirName('local-build.cpp', ignoredDirs)).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
