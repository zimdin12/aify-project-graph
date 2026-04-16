import { execFileSync } from 'node:child_process';

function normalizeLines(stdout) {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

export async function getHeadCommit(repoRoot) {
  return execGit(repoRoot, ['rev-parse', 'HEAD']).trim();
}

export async function getDirtyFiles(repoRoot) {
  const stdout = execGit(repoRoot, ['status', '--porcelain']);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

export async function getChangedFiles(repoRoot, fromRef, toRef = 'HEAD') {
  const stdout = execGit(repoRoot, ['diff', '--name-only', `${fromRef}..${toRef}`]);
  return normalizeLines(stdout);
}

function execGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}
