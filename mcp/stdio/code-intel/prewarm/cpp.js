// Plan #14 Step B: bounded cpp prewarm for cold-session navigation.
//
// Mirrors agent-code-intel 0.1.21's per-language prewarmFiles hook
// (commit 331c34c, "Fix cold navigation readiness") but adapted for
// clangd — which under `--background-index=false` would choke on
// the reference's "open up to 1000 files" PHP approach. Cpp instead
// picks a TIGHT bounded set (default 15 files per senior-dev review):
//
//   - queried file's same-directory siblings (.cpp/.h/.hpp etc.)
//   - direct compile_commands.json sibling entries from the SAME
//     directory as the queried file
//
// The wider compile-DB component sweep is NOT auto-fired — callers
// must opt in (or retry-after-degraded, plumbed via Step D).
//
// Opt-out: APG_DISABLE_PREWARM=1 in env returns []. Tests can also
// set a smaller cap via the param.

import fs from 'node:fs';
import path from 'node:path';

const CPP_EXTENSIONS = new Set(['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh', '.hxx']);
const BUILD_DEP_PREFIXES = [
  'build/', 'build_', 'cmake-build-', '_build/', 'out/',
  '_deps/', 'deps/', 'third_party/', 'third-party/', 'vendor/',
  'node_modules/', '.deps/', '.cache/', 'extern/', 'external/'
];

export const DEFAULT_PREWARM_CAP = 15;

function findCompileCommands(projectRoot) {
  for (const c of [
    path.join(projectRoot, 'compile_commands.json'),
    path.join(projectRoot, 'build', 'compile_commands.json'),
    path.join(projectRoot, 'build-linux', 'compile_commands.json'),
    path.join(projectRoot, 'cmake-build-debug', 'compile_commands.json')
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function toRepoRelative(projectRoot, abs) {
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  return rel;
}

function isInRepo(rel) {
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isBuildDepPrefix(rel) {
  return BUILD_DEP_PREFIXES.some(p => rel.startsWith(p));
}

function isCppFile(rel) {
  return CPP_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

function readCompileDbFiles(compileDbPath, projectRoot) {
  try {
    const json = JSON.parse(fs.readFileSync(compileDbPath, 'utf8'));
    if (!Array.isArray(json)) return [];
    const out = [];
    for (const entry of json) {
      const fileField = entry?.file;
      if (!fileField) continue;
      const abs = path.isAbsolute(fileField) ? fileField : path.resolve(entry.directory || projectRoot, fileField);
      const rel = toRepoRelative(projectRoot, abs);
      if (!isInRepo(rel) || !isCppFile(rel) || isBuildDepPrefix(rel)) continue;
      out.push(rel);
    }
    return out;
  } catch {
    return [];
  }
}

function listDirSiblings(projectRoot, queriedFileRel) {
  // On-disk siblings in the queried file's directory. Catches headers
  // that aren't in compile_commands.json (headers usually aren't TUs).
  try {
    const dir = path.dirname(path.join(projectRoot, queriedFileRel));
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!CPP_EXTENSIONS.has(ext)) continue;
      const rel = toRepoRelative(projectRoot, path.join(dir, e.name));
      if (isInRepo(rel) && !isBuildDepPrefix(rel)) out.push(rel);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Pick a bounded prewarm set for cpp navigation.
 *
 * Returns repo-relative file paths (forward-slash), capped, deduped,
 * with `queriedFile` excluded (caller opens it as part of the query
 * proper). Strategy: same-dir siblings first (on-disk + compile DB),
 * then immediate-parent-dir entries. Bounded by `cap`. Never opens
 * the whole repo or chases includes.
 *
 * Returns { files, stats: { cap, skipped, source } }.
 *   - files: the repo-relative path list, length <= cap.
 *   - stats.cap: the cap actually applied.
 *   - stats.skipped: true if the unbounded candidate set exceeded cap.
 *   - stats.source: 'compile_db' | 'fs_siblings' | 'mixed' | 'none'.
 *
 * Honors `APG_DISABLE_PREWARM=1` (returns empty with source:'none').
 */
export function selectCppPrewarmFiles({ projectRoot, queriedFile, cap = DEFAULT_PREWARM_CAP, env = process.env } = {}) {
  if (env.APG_DISABLE_PREWARM === '1') {
    return { files: [], stats: { cap, skipped: false, source: 'none' } };
  }
  if (!projectRoot || !queriedFile) {
    return { files: [], stats: { cap, skipped: false, source: 'none' } };
  }

  const queriedRel = queriedFile.split(path.sep).join('/');
  const queriedDir = path.posix.dirname(queriedRel);

  const fromCompileDb = [];
  const compileDbPath = findCompileCommands(projectRoot);
  if (compileDbPath) {
    const allEntries = readCompileDbFiles(compileDbPath, projectRoot);
    for (const rel of allEntries) {
      const dir = path.posix.dirname(rel);
      if (dir === queriedDir) fromCompileDb.push(rel);
    }
  }

  const fromFs = listDirSiblings(projectRoot, queriedRel);

  // Dedupe + exclude queried file, prefer ordering: compile DB siblings
  // first (they're real TUs clangd cares about), then on-disk siblings
  // (headers not in compile_commands.json).
  const seen = new Set([queriedRel]);
  const out = [];
  let hasCompileDbSrc = false;
  let hasFsSrc = false;
  for (const rel of fromCompileDb) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
    hasCompileDbSrc = true;
    if (out.length >= cap) break;
  }
  if (out.length < cap) {
    for (const rel of fromFs) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
      hasFsSrc = true;
      if (out.length >= cap) break;
    }
  }

  const unboundedCandidates = new Set([...fromCompileDb, ...fromFs]);
  unboundedCandidates.delete(queriedRel);
  const skipped = unboundedCandidates.size > cap;

  let source = 'none';
  if (hasCompileDbSrc && hasFsSrc) source = 'mixed';
  else if (hasCompileDbSrc) source = 'compile_db';
  else if (hasFsSrc) source = 'fs_siblings';

  return { files: out, stats: { cap, skipped, source } };
}
