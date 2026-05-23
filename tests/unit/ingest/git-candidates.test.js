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

describe('sweep + gitignore negation regression (dev P1#1)', () => {
  // Before the fix: sweep.js called pathContainsIgnoredDir(ignoredDirs)
  // FIRST and ignoredDirs included the manually-parsed .gitignore
  // patterns. The manual parser drops `!pattern` re-includes (it can't
  // express full gitignore semantics), so `keep.log` would be pruned
  // by the `*.log` parser pattern BEFORE isGitCandidate() could rescue
  // it. The fix: when gitCandidates is non-null, sweep re-resolves the
  // ignored set with skipGitignore:true so git's authoritative answer
  // alone decides gitignore membership.
  it('sweep walks a file git ls-files re-includes (.gitignore: *.md + !keep.md inside docs/)', async () => {
    const { sweepFilesystem } = await import('../../../mcp/stdio/ingest/sweep.js');
    const dir = tmpDir();
    gitInit(dir);
    // Files must live under docs/ for sweep's isDocument() to emit
    // Document nodes (random .md in root doesn't qualify). The
    // gitignore-negation semantic still applies — `!keep.md` re-includes
    // a file the parser would drop.
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', '.gitignore'), '*.md\n!keep.md\n');
    fs.writeFileSync(path.join(dir, 'docs', 'drop.md'), '# drop');
    fs.writeFileSync(path.join(dir, 'docs', 'keep.md'), '# keep');
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'add'], { stdio: 'ignore' });

    const result = await sweepFilesystem({ repoRoot: dir });
    const filePaths = result.nodes
      .filter(n => n.type === 'Document')
      .map(n => n.file_path);
    // Pre-fix: keep.md was pruned by the manually-parsed `*.md` line
    // before isGitCandidate() could rescue it. Post-fix: gitignore
    // parsing is skipped when gitCandidates is non-null and git's
    // `!keep.md` re-include wins.
    expect(filePaths).toContain('docs/keep.md');
    expect(filePaths).not.toContain('docs/drop.md');
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
