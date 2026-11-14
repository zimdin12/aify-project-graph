import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Strict repository-relative spelling. No traversal, drive/URI/stream prefix, or alternate separator. */
export function repoRelativeProblem(file) {
  if (typeof file !== 'string' || file === '') return 'args.file must be a non-empty repository-relative path';
  if (file.includes('\u0000') || file.includes('\\') || file.includes(':') || file.startsWith('/')) {
    return `args.file ${JSON.stringify(file)} is not a repository-relative path`;
  }
  if (file.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return `args.file ${JSON.stringify(file)} is not a repository-relative path`;
  }
  return null;
}

/** Resolve both sides with filesystem authority, failing closed before a language server opens the file. */
export function guardRepositoryFile({ repoRoot, file }) {
  if (repoRelativeProblem(file) !== null) return { ok: false, reasonCode: 'path_outside_repository', problem: 'the file must be repository-relative' };
  try {
    const root = realpathSync(repoRoot);
    const resolved = realpathSync(join(root, file));
    const rel = relative(root, resolved);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
      return { ok: false, reasonCode: 'path_outside_repository', problem: `${file} resolves outside the repository` };
    }
    if (!statSync(resolved).isFile()) return { ok: false, reasonCode: 'file_unavailable', problem: `${file} is not a file` };
    return { ok: true };
  } catch {
    return { ok: false, reasonCode: 'file_unavailable', problem: `${file} could not be read inside the repository` };
  }
}
