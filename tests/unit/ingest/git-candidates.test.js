// Plan #17 F tests: gitignore-respecting candidate file selection.
// Verifies the helper returns null on non-git repos, returns a Set on
// git repos, normalizes Windows paths to forward slashes, and respects
// .gitignore entries.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { getGitCandidateFiles, isGitCandidate } from '../../../mcp/stdio/ingest/git-candidates.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-gitcand-'));
}

function gitInit(dir) {
  // Minimal init that works on Windows + Linux. Quiet output.
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@apg.local'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'apg-test'], { stdio: 'ignore' });
}

describe('getGitCandidateFiles', () => {
  it('returns null when repoRoot is not provided', () => {
    expect(getGitCandidateFiles(null)).toBeNull();
    expect(getGitCandidateFiles(undefined)).toBeNull();
    expect(getGitCandidateFiles('')).toBeNull();
  });

  it('returns null for a non-git directory', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    expect(getGitCandidateFiles(dir)).toBeNull();
  });

  it('returns a Set with tracked + untracked-not-ignored files in a git repo', () => {
    const dir = tmpDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, 'tracked.js'), '// tracked');
    fs.writeFileSync(path.join(dir, 'untracked.js'), '// untracked');
    execFileSync('git', ['-C', dir, 'add', 'tracked.js'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });

    const set = getGitCandidateFiles(dir);
    expect(set).toBeInstanceOf(Set);
    expect(set.has('tracked.js')).toBe(true);
    expect(set.has('untracked.js')).toBe(true); // --others picks this up
  });

  it('respects .gitignore', () => {
    const dir = tmpDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\nbuild/\n');
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'k');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'build'));
    fs.writeFileSync(path.join(dir, 'build', 'output.txt'), 'o');

    const set = getGitCandidateFiles(dir);
    expect(set.has('keep.txt')).toBe(true);
    expect(set.has('.gitignore')).toBe(true);
    expect(set.has('ignored.txt')).toBe(false);
    expect(set.has('build/output.txt')).toBe(false);
  });

  it('normalizes path separators to forward slashes', () => {
    const dir = tmpDir();
    gitInit(dir);
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'a');
    execFileSync('git', ['-C', dir, 'add', '.'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'add'], { stdio: 'ignore' });

    const set = getGitCandidateFiles(dir);
    expect(set.has('sub/a.txt')).toBe(true);
    // No backslash-form entries even on Windows hosts
    for (const p of set) {
      expect(p.includes('\\')).toBe(false);
    }
  });

  it('honors negation rules in .gitignore', () => {
    const dir = tmpDir();
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n!keep.log\n');
    fs.writeFileSync(path.join(dir, 'drop.log'), 'd');
    fs.writeFileSync(path.join(dir, 'keep.log'), 'k');

    const set = getGitCandidateFiles(dir);
    expect(set.has('keep.log')).toBe(true);
    expect(set.has('drop.log')).toBe(false);
  });
});

describe('isGitCandidate', () => {
  it('returns true when candidates is null (no filter)', () => {
    expect(isGitCandidate('any/path.js', null)).toBe(true);
  });

  it('returns true for empty / root path regardless of set', () => {
    expect(isGitCandidate('', new Set())).toBe(true);
    expect(isGitCandidate('.', new Set())).toBe(true);
  });

  it('returns true only when path is in the set', () => {
    const s = new Set(['src/a.js', 'src/b.js']);
    expect(isGitCandidate('src/a.js', s)).toBe(true);
    expect(isGitCandidate('src/c.js', s)).toBe(false);
  });

  it('normalizes backslash paths to forward-slash for the lookup', () => {
    const s = new Set(['src/a.js']);
    expect(isGitCandidate('src\\a.js', s)).toBe(true);
  });
});
