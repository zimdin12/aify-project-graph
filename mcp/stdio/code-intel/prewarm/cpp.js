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
// ★ WE OWN A CALL GRAPH AND WERE USING THE FILESYSTEM AS THE HEURISTIC.
//
// Measured in the field (ef-manager, 2026-07-31): the first references call after a
// restart spent ~22 SECONDS warming 15 files chosen by DIRECTORY ORDER — the
// alphabetical head of engine/voxel/ — and not one of them was a caller. The answer
// came back non-exhaustive anyway. His framing: "you own a call graph and you are
// using the filesystem as your prewarm heuristic."
//
// The graph already knows which files call into this one. Even a STALE spine beats
// alphabetical order, because a stale caller is still far more likely to be a real
// caller than a directory neighbour. So graph-known callers go FIRST, then compile-DB
// siblings, then the filesystem — each tier bounded by the same cap.
//
// Best-effort throughout: the graph may be absent, stale, or empty, and prewarm must
// never fail a query. A miss here costs latency, never correctness.
function callersFromGraph(openDb, projectRoot, queriedRel, cap) {
  try {
    const dbPath = path.join(projectRoot, '.aify-graph', 'graph.sqlite');
    if (!fs.existsSync(dbPath)) return [];
    const db = openDb(dbPath);
    try {
      const rows = db.all(
        'SELECT DISTINCT cn.file_path AS file'
        + '  FROM nodes tn'
        + '  JOIN edges e ON e.to_id = tn.id'
        + '  JOIN nodes cn ON cn.id = e.from_id'
        + ' WHERE tn.file_path = $file'
        + '   AND cn.file_path IS NOT NULL AND cn.file_path != $file'
        + ' LIMIT $lim',
        { file: queriedRel, lim: cap * 3 },
      );
      return rows
        .map((r) => r.file)
        .filter((f) => typeof f === 'string' && CPP_EXTENSIONS.has(path.posix.extname(f)));
    } finally { db.close(); }
  } catch {
    return [];
  }
}

export function selectCppPrewarmFiles({ projectRoot, queriedFile, cap = DEFAULT_PREWARM_CAP, env = process.env, openDb = null } = {}) {
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
  let hasGraphSrc = false;

  // Graph-known callers FIRST — the whole point of owning a call graph is not to
  // guess when you can look. Only consulted when the caller supplies a db opener,
  // so this module stays dependency-free for tests that exercise the fs/compile-DB
  // tiers in isolation.
  if (typeof openDb === 'function') {
    for (const rel of callersFromGraph(openDb, projectRoot, queriedRel, cap)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
      hasGraphSrc = true;
      if (out.length >= cap) break;
    }
  }

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

  // `source` is reported so a slow first call is DIAGNOSABLE: seeing
  // 'fs_siblings' is what told a field user his 22 seconds went on alphabetical
  // directory order rather than on callers. 'graph_callers' now names the good case.
  let source = 'none';
  const tiers = [hasGraphSrc && 'graph_callers', hasCompileDbSrc && 'compile_db', hasFsSrc && 'fs_siblings']
    .filter(Boolean);
  if (tiers.length > 1) source = `mixed(${tiers.join('+')})`;
  else if (tiers.length === 1) [source] = tiers;

  return { files: out, stats: { cap, skipped, source, graphCallers: hasGraphSrc } };
}
