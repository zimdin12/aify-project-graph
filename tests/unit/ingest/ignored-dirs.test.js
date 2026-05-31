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

  it('does not treat a source filename with a build prefix as an ignored directory', () => {
    expect(pathContainsIgnoredDir('mcp/stdio/query/verbs/target_rollup.js')).toBe(false);
    expect(pathContainsIgnoredDir('src/build_report.ts')).toBe(false);
  });

  // R2-2026-05-31 (BUG 3) — agent worktree copies under .claude/worktrees/ are
  // stale duplicate first-party sources that pollute hotspots/shader-loaders/
  // digest. They must be excluded from extraction.
  it('excludes .claude/worktrees agent copies (both segments are ignored dirs)', () => {
    expect(pathContainsIgnoredDir('.claude/worktrees/agent-1/src/Engine_chunks.cpp')).toBe(true);
    expect(pathContainsIgnoredDir('.claude/worktrees/agent-7/shaders/pcas_powder.comp.glsl')).toBe(true);
    expect(isIgnoredDirName('.claude')).toBe(true);
    expect(isIgnoredDirName('worktrees')).toBe(true);
    // _deps (CMake FetchContent) is also excluded.
    expect(isIgnoredDirName('_deps')).toBe(true);
    expect(pathContainsIgnoredDir('build/_deps/glfw-src/src/window.c')).toBe(true);
    // Real source under a similarly-named path is NOT over-excluded.
    expect(pathContainsIgnoredDir('src/claude_helpers.cpp')).toBe(false);
    expect(pathContainsIgnoredDir('engine/world/worktree_planner.cpp')).toBe(false);
  });

  // Belt-and-suspenders: even if `.claude` is opted back in via .aifyinclude,
  // the built-in `.claude/worktrees` path pattern still excludes worktree copies.
  it('keeps excluding .claude/worktrees even when .claude is re-included', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-claude-wt-'));
    try {
      await writeFile(join(repoRoot, '.aifyinclude'), '.claude\n');
      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      // .claude itself is now allowed (re-included)…
      expect(isIgnoredDirName('.claude', ignoredDirs)).toBe(false);
      // …but the worktrees subtree is still pruned by the built-in path pattern.
      expect(pathContainsIgnoredDir('.claude/worktrees/agent-1/src/x.cpp', ignoredDirs)).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

// Plan #17 F: .gitignore-driven zero-config indexing.
describe('.gitignore as default ignore source', () => {
  it('reads .gitignore patterns by default (bare names go to dir set, paths to pathPatterns)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-gi-'));
    try {
      await writeFile(join(repoRoot, '.gitignore'), [
        '# default build artifacts',
        'dist-custom',
        'logs/',
        '/anchored-root',
        'tmp/*.log',
        '',
      ].join('\n'));

      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      expect(isIgnoredDirName('dist-custom', ignoredDirs)).toBe(true);
      expect(isIgnoredDirName('logs', ignoredDirs)).toBe(true);
      expect(isIgnoredDirName('anchored-root', ignoredDirs)).toBe(true);
      expect(pathContainsIgnoredDir('tmp/build.log', ignoredDirs)).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('APG_IGNORE_GITIGNORE=1 disables gitignore reading (opt-out)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-gi-'));
    try {
      await writeFile(join(repoRoot, '.gitignore'), 'gitignored-only\n');
      const enabled = loadEffectiveIgnoredDirs(repoRoot);
      const disabled = loadEffectiveIgnoredDirs(repoRoot, { env: { APG_IGNORE_GITIGNORE: '1' } });
      expect(isIgnoredDirName('gitignored-only', enabled)).toBe(true);
      expect(isIgnoredDirName('gitignored-only', disabled)).toBe(false);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('skips gitignore negation lines and unsupported glob constructs (safe by default)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-gi-'));
    try {
      await writeFile(join(repoRoot, '.gitignore'), [
        '!keep-this',          // re-include — skipped
        'unsupported{foo,bar}', // brace alternation — skipped
        'unsupported\\file',    // backslash escape — skipped
        'safe-ignore',
        '',
      ].join('\n'));

      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      expect(isIgnoredDirName('keep-this', ignoredDirs)).toBe(false);
      expect(isIgnoredDirName('unsupported', ignoredDirs)).toBe(false);
      expect(isIgnoredDirName('safe-ignore', ignoredDirs)).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('.aifyignore overrides .gitignore (later layer wins on adds)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-gi-'));
    try {
      await writeFile(join(repoRoot, '.gitignore'), 'from-gitignore\n');
      await writeFile(join(repoRoot, '.aifyignore'), 'from-aifyignore\n');
      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      expect(isIgnoredDirName('from-gitignore', ignoredDirs)).toBe(true);
      expect(isIgnoredDirName('from-aifyignore', ignoredDirs)).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('.aifyinclude can opt-back-in a name that gitignore added', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'apg-gi-'));
    try {
      await writeFile(join(repoRoot, '.gitignore'), 'special-build\n');
      await writeFile(join(repoRoot, '.aifyinclude'), 'special-build\n');
      const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      expect(isIgnoredDirName('special-build', ignoredDirs)).toBe(false);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
