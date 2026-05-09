import path from 'node:path';

export function isRepoRelative(p) {
  if (typeof p !== 'string') return false;
  if (p === '') return true;
  if (p.includes('\\')) return false;
  if (p.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return true;
}

export function toRepoRelative(projectRoot, filePath) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new Error('toRepoRelative: projectRoot is required');
  }
  if (typeof filePath !== 'string') {
    throw new Error('toRepoRelative: filePath must be string');
  }

  const normalizedRoot = path.resolve(projectRoot);

  if (isRepoRelative(filePath)) {
    return filePath;
  }

  let candidate = filePath;
  if (!path.isAbsolute(candidate) && /\\/.test(candidate)) {
    return candidate.replace(/\\/g, '/');
  }
  if (!path.isAbsolute(candidate)) {
    return candidate;
  }

  const resolved = path.resolve(candidate);
  const rel = path.relative(normalizedRoot, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`toRepoRelative: path '${filePath}' is outside projectRoot '${projectRoot}'`);
  }

  return rel.split(path.sep).join('/');
}
