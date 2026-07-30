import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── LSP URI → repo-relative path ────────────────────────────────────────────
//
// WINDOWS BUG, found the first time the real-clangd suite actually ran
// (2026-07-30). clangd canonicalizes paths to their LONG form; Node reports some
// roots in 8.3 SHORT form (`os.tmpdir()` → `C:\Users\ADMINI~1\...`). The two
// never compare equal, so `path.win32.relative` produced `..\..\..`,
// toRepoRelative threw "outside projectRoot", and the caller's bare `catch`
// returned the RAW `file:///C:/...` URI as if it were a repo-relative path —
// while `evidence.exhaustive: true` was still asserted alongside it.
//
// Impact beyond cosmetics: an agent cannot navigate to `file:///C:/Users/...`,
// absolute host paths leak into responses, and any downstream comparison against
// repo-relative graph paths matches NOTHING — a silent zero-overlap that reads as
// "no results" rather than "paths in two different formats".
//
// The same mismatch arises from junctions/symlinks and drive-letter case, so the
// fix normalizes through realpath on BOTH sides rather than special-casing 8.3.
// Result is reported as {path, ok} so a caller can warn instead of silently
// shipping an unusable location.

const _realpathCache = new Map();
function realpathOrSelf(p) {
  if (typeof p !== 'string' || !p) return p;
  const hit = _realpathCache.get(p);
  if (hit !== undefined) return hit;
  let out = p;
  try { out = fs.realpathSync.native(p); } catch {
    try { out = fs.realpathSync(p); } catch { out = p; }
  }
  _realpathCache.set(p, out);
  return out;
}

export function _resetRealpathCache() { _realpathCache.clear(); }

export function uriToRepoRelativeSafe(uri, projectRoot) {
  let abs;
  try { abs = fileURLToPath(uri); } catch { return { path: uri, ok: false, reason: 'not_a_file_uri' }; }

  // 1. Direct — the common case, no filesystem calls.
  try { return { path: toRepoRelative(projectRoot, abs), ok: true }; } catch { /* fall through */ }

  // 2. Canonicalize both sides. Catches 8.3 short names, junctions, symlinks.
  try {
    return { path: toRepoRelative(realpathOrSelf(projectRoot), realpathOrSelf(abs)), ok: true };
  } catch { /* fall through */ }

  // 3. Drive-letter / case-only difference on a case-insensitive filesystem.
  if (process.platform === 'win32') {
    try {
      const root = path.win32.resolve(realpathOrSelf(projectRoot)).toLowerCase();
      const cand = path.win32.resolve(realpathOrSelf(abs));
      if (cand.toLowerCase().startsWith(root.endsWith('\\') ? root : `${root}\\`)) {
        return { path: cand.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/'), ok: true };
      }
    } catch { /* fall through */ }
  }

  // Genuinely outside the repo (a system header, a dependency). Returning the
  // absolute path is correct here — it is not a repo file — but `ok:false` lets
  // the caller distinguish that from a path it failed to normalize.
  return { path: abs.replace(/\\/g, '/'), ok: false, reason: 'outside_project_root' };
}

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

  const windowsAbs = /^[A-Za-z]:[\\/]/;
  if (windowsAbs.test(projectRoot) || windowsAbs.test(filePath)) {
    const root = path.win32.resolve(projectRoot);
    const candidate = path.win32.resolve(filePath);
    const rel = path.win32.relative(root, candidate);
    if (rel.startsWith('..') || path.win32.isAbsolute(rel)) {
      throw new Error(`toRepoRelative: path '${filePath}' is outside projectRoot '${projectRoot}'`);
    }
    return rel.replace(/\\/g, '/');
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
