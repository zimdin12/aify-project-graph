import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  isIgnoredDirName,
  loadEffectiveIgnoredDirs,
  normalizeRepoRelativePath,
  pathContainsIgnoredDir,
} from '../ingest/ignored-dirs.js';

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

export async function getDirtyFileEntries(repoRoot) {
  return getDirtyFileEntriesSync(repoRoot);
}

export async function getDirtyFiles(repoRoot) {
  const entries = await getDirtyFileEntries(repoRoot);
  return entries.map((entry) => entry.path);
}

export function getDirtyFileEntriesSync(repoRoot) {
  const stdout = execGit(repoRoot, ['status', '--porcelain']);
  const ignoredDirs = loadEffectiveIgnoredDirs(repoRoot);

  return stdout
    .split(/\r?\n/u)
    .map(parseStatusLine)
    .filter(Boolean)
    .flatMap((entry) => expandEntry(repoRoot, entry, ignoredDirs))
    .map((entry) => ({
      ...entry,
      path: normalizeRepoRelativePath(entry.path),
    }))
    .filter((entry) => entry.path)
    .filter((entry) => !pathContainsIgnoredDir(entry.path, ignoredDirs));
}

export function getDirtyFilesSync(repoRoot) {
  return getDirtyFileEntriesSync(repoRoot).map((entry) => entry.path);
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

function parseStatusLine(line) {
  const trimmed = String(line || '').trimEnd();
  if (!trimmed) return null;
  const status = trimmed.slice(0, 2);
  let filePath = trimmed.slice(3).trim();
  if (!filePath) return null;
  if (filePath.includes(' -> ')) {
    filePath = filePath.split(' -> ').at(-1) ?? filePath;
  }
  return {
    status,
    path: filePath,
    untracked: status === '??',
  };
}

function expandEntry(repoRoot, entry, ignoredDirs) {
  const normalized = normalizeRepoRelativePath(entry.path);
  if (!entry.untracked || !normalized.endsWith('/')) return [{ ...entry, path: normalized }];
  return expandUntrackedDirectory(repoRoot, normalized, ignoredDirs).map((path) => ({ ...entry, path }));
}

function expandUntrackedDirectory(repoRoot, relDir, ignoredDirs) {
  const absDir = join(repoRoot, relDir);
  if (!existsSync(absDir)) return [relDir];
  const out = [];
  const walk = (absPath, relPath) => {
    const entries = readdirSync(absPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextAbs = join(absPath, entry.name);
      const nextRel = normalizeRepoRelativePath(join(relPath, entry.name));
      if (entry.isDirectory()) {
        if (isIgnoredDirName(entry.name, ignoredDirs)) continue;
        walk(nextAbs, nextRel);
      } else {
        out.push(nextRel);
      }
    }
  };
  walk(absDir, relDir);
  return out.length > 0 ? out : [relDir];
}
