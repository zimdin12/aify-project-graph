// A RELATIVE repoRoot used to silently produce a near-empty graph.
//
// normalizeRelativePath derives repo-relative paths with
// `absPath.slice(repoRoot.length + 1)`. With repoRoot='.' (length 1) that chops
// the first TWO characters off every path — 'src/a.js' becomes 'c/a.js' — so no
// file matched a language config, every file was skipped, and the rebuild
// reported SUCCESS while indexing nothing.
//
// Measured on this repo before the fix: 562 nodes / 0 files with '.', versus
// 3603 nodes / 398 files with the absolute path. Silent and total, which is the
// worst shape a freshness bug can have — an agent then queries an empty graph
// and reads "no callers" as fact.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

function initGitRepo(root) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test');
  git('config', 'user.name', 'test');
  git('add', '.');
  git('commit', '-m', 'init');
}

describe('ensureFresh normalizes repoRoot', () => {
  let repoRoot;
  let cwd;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-relroot-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'alpha.js'), 'export function alpha() { return 1; }\n');
    await writeFile(join(repoRoot, 'src', 'beta.js'), 'export function beta() { return 2; }\n');
    initGitRepo(repoRoot);
    cwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(cwd);
    try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
  });

  it('indexes the same files whether repoRoot is absolute or relative', async () => {
    const absolute = await ensureFresh({ repoRoot, force: true });
    expect(absolute.processedFiles).toContain('src/alpha.js');
    expect(absolute.processedFiles).toContain('src/beta.js');

    // Re-run from a different cwd using a RELATIVE path to the same repo.
    await rm(join(repoRoot, '.aify-graph'), { recursive: true, force: true });
    process.chdir(tmpdir());
    const rel = relative(process.cwd(), repoRoot);
    const relative_ = await ensureFresh({ repoRoot: rel, force: true });

    expect(relative_.processedFiles).toContain('src/alpha.js');
    expect(relative_.processedFiles).toContain('src/beta.js');
    // The whole point: a relative root must not silently index less.
    expect(relative_.processedFiles.length).toBe(absolute.processedFiles.length);
    expect(relative_.nodes).toBe(absolute.nodes);
  });

  it("indexes correctly when repoRoot is '.' (the shape that produced an empty graph)", async () => {
    process.chdir(repoRoot);
    const result = await ensureFresh({ repoRoot: '.', force: true });

    expect(result.processedFiles).toContain('src/alpha.js');
    expect(result.processedFiles).toContain('src/beta.js');
    expect(result.nodes).toBeGreaterThan(0);
  });
});
