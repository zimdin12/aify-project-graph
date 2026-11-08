// What in this checkout is not at HEAD: tracked changes AND untracked files. Reads git; returns null if it cannot.
//
// The suite gate asks this at the start of a run and again at the end, so both ends must ask the identical question.
// It used to ask about tracked files only. vitest collects every tests/**/*.test.js ON DISK, so on 2026-11-08 an
// untracked test file for the next issue joined a gate run for three committed fixes and turned it RED: a verdict
// about no commit at all. An untracked file is part of what the suite measures, so it is part of "dirty".
// .gitignore'd paths (node_modules, .aify-graph) stay out: git would never commit them and the suite expects them.
import { execFileSync } from 'node:child_process';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const lines = (text, sep) => text.split(sep).filter(Boolean);

/** @returns {{tracked: string[], untracked: string[]}|null} */
export function readTreeChanges(repo) {
  try {
    return {
      tracked: [...lines(git(repo, ['diff', '--name-only']), '\n'), ...lines(git(repo, ['diff', '--cached', '--name-only']), '\n')],
      untracked: lines(git(repo, ['ls-files', '--others', '--exclude-standard', '-z']), '\0'),
    };
  } catch { return null; }
}
