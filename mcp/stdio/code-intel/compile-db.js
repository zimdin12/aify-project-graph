// compile_commands.json discovery + normalization (Code-Intel v2 L1).
//
// Problem this solves (verified on the real game repos):
//  - sand_castle / echoes generators emit WSL paths (`/mnt/c/Users/...`) in
//    `file`/`directory`/`-I` args, but the source lives on Windows
//    (`C:/Users/...`). A Windows clangd reading WSL-path entries can't match
//    Windows files → references/definitions silently come back empty. We must
//    translate the paths so clangd sees host-native paths.
//  - sand_castle uses CMake UNITY builds: the DB points at
//    `Unity/unity_0_cxx.cxx` aggregates, not the first-party TUs. We still emit
//    a usable DB (clangd can infer per-file flags) but FLAG it so an agent
//    knows precision is degraded and how to fix it.
//  - `_deps/`, `build*/`, `third_party/` … dominate entry counts and must be
//    excluded when counting "first-party" coverage.
//
// Output: a normalized compile_commands.json written under
// `<projectRoot>/.aify-graph/code-intel/` plus a structured summary the doctor
// and provider consume.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILD_DEP_PREFIXES } from './providers/cpp-clangd.js';

// Build dirs probed in priority-agnostic order; the richest (most in-repo
// first-party entries) wins, so order only matters for ties (first kept).
const PROBE_DIRS = [
  '',                 // <projectRoot>/compile_commands.json
  'build',
  'build-debug',
  'build-linux',
  'build-linux-techlead',
  'build-debug-win',
  'cmake-build-debug',
  'out'
];

const UNITY_RE = /Unity[\\/]unity_\d+_.*\.(cxx|cpp)$/i;

/**
 * Translate a WSL `/mnt/<drive>/...` path to a host path on win32
 * (`/mnt/c/Users/x` → `C:/Users/x`). On non-win32 platforms WSL paths ARE the
 * host paths, so they're returned unchanged. Already-host paths (`C:/...`) and
 * ordinary posix paths are left alone. Backslashes are normalized to `/`.
 *
 * Pure helper — unit-tested directly.
 * @param {string} p
 * @returns {string}
 */
export function wslToHost(p) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (process.platform !== 'win32') return p;
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (m) {
    const drive = m[1].toUpperCase();
    const rest = (m[2] || '').replace(/\\/g, '/');
    return `${drive}:${rest || '/'}`;
  }
  return p;
}

// Rewrite an `-I<path>` / `-isystem <path>` / `-isysroot <path>` style flag's
// path component. Handles both glued (`-I/mnt/c/x`) and separated forms — for
// separated forms the path is a standalone token handled by the caller, so
// here we only deal with the glued single-token case.
function rewriteFlagToken(tok) {
  if (typeof tok !== 'string') return tok;
  for (const flag of ['-I', '-isystem', '-isysroot', '-iquote', '-idirafter']) {
    if (tok.startsWith(flag) && tok.length > flag.length) {
      return flag + wslToHost(tok.slice(flag.length));
    }
  }
  // Bare path-looking token (WSL absolute) — translate it too.
  if (tok.startsWith('/mnt/')) return wslToHost(tok);
  return tok;
}

const SEPARATED_PATH_FLAGS = new Set(['-I', '-isystem', '-isysroot', '-iquote', '-idirafter', '-include']);

function rewriteArguments(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (SEPARATED_PATH_FLAGS.has(tok) && i + 1 < args.length) {
      out.push(tok);
      out.push(wslToHost(args[i + 1]));
      i += 1;
      continue;
    }
    out.push(rewriteFlagToken(tok));
  }
  return out;
}

function rewriteCommandString(cmd) {
  if (typeof cmd !== 'string') return cmd;
  // Token-aware rewrite of WSL absolute paths inside the command string.
  // Tokens may be glued to flags (`-I/mnt/c/x`) or standalone (`/mnt/c/x`).
  return cmd.replace(/(^|\s)(-I|-isystem|-isysroot|-iquote|-idirafter)?(\/mnt\/[a-zA-Z]\/\S*)/g,
    (full, lead, flag, p) => `${lead}${flag || ''}${wslToHost(p)}`);
}

function normalizeEntry(entry) {
  const out = { ...entry };
  // Stash the original `file` (pre-normalization) so unity expansion can swap
  // the unity path token in both its host and original-WSL forms. Stripped
  // before the DB is serialized.
  if (typeof out.file === 'string' && isUnityFile(out.file)) out.__rawFile = out.file;
  if (typeof out.file === 'string') out.file = wslToHost(out.file);
  if (typeof out.directory === 'string') out.directory = wslToHost(out.directory);
  if (Array.isArray(out.arguments)) out.arguments = rewriteArguments(out.arguments);
  if (typeof out.command === 'string') out.command = rewriteCommandString(out.command);
  return out;
}

// Repo-relative, forward-slash path for `file`, or null if outside the repo.
function repoRel(projectRoot, entry) {
  const file = entry.file;
  if (typeof file !== 'string' || file.length === 0) return null;
  const directory = entry.directory || projectRoot;
  const abs = path.isAbsolute(file) || /^[A-Za-z]:/.test(file)
    ? file
    : path.join(directory, file);
  // Use win32 semantics on win32 hosts so `C:/...` resolves correctly.
  const sep = process.platform === 'win32' ? path.win32 : path.posix;
  let rel;
  try {
    rel = sep.relative(sep.resolve(projectRoot), sep.resolve(abs));
  } catch {
    return null;
  }
  rel = rel.replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) return null;
  return rel;
}

// Dep/build/vendor classifier. Two layers:
//   1. The shared BUILD_DEP_PREFIXES (repo-root-relative, e.g. `build/`,
//      `_deps/`, `third_party/`) — preserves the established contract.
//   2. Segment-aware rules that also catch NESTED noise the real game DBs
//      emit: any `build*/` out-of-tree dir (echoes uses `build-linux/`) and
//      any dep/vendor dir at ANY depth (`build-linux/_deps/lua-src/...`).
const DEP_SEGMENTS = new Set([
  '_deps', 'deps', 'third_party', 'third-party', 'thirdparty',
  'vendor', 'external', 'extern', 'node_modules'
]);
function isDepRel(rel) {
  if (BUILD_DEP_PREFIXES.some(p => rel.startsWith(p))) return true;
  const segs = rel.split('/');
  // Any path segment that is a known vendor/dep dir (nested deps under build*).
  if (segs.some(s => DEP_SEGMENTS.has(s))) return true;
  // First segment is an out-of-tree build dir (build, build-linux, build-debug…).
  const first = segs[0] || '';
  if (/^build([-_].*)?$/.test(first) || /^cmake-build/.test(first) || first === 'out' || first === '_build') return true;
  return false;
}

function isUnityFile(file) {
  return typeof file === 'string' && UNITY_RE.test(file.replace(/\\/g, '/'));
}

// Quoted-include matcher for CMake unity aggregate files. A unity `.cxx` is a
// list of `#include "<member source>"` lines (one per first-party TU it
// absorbs). We deliberately ignore angle-bracket includes (`#include <...>`) —
// those are system/library headers, never member sources.
const UNITY_INCLUDE_RE = /^[ \t]*#[ \t]*include[ \t]*"([^"]+)"/gm;

/**
 * Parse the member-source include paths out of a CMake unity `.cxx` body.
 * Returns the raw quoted strings (NOT yet host-normalized or resolved).
 *
 * Pure helper — unit-tested directly.
 * @param {string} text the unity .cxx file contents
 * @returns {string[]} quoted include targets, in file order
 */
export function parseUnityIncludes(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = [];
  UNITY_INCLUDE_RE.lastIndex = 0;
  let m;
  while ((m = UNITY_INCLUDE_RE.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

// C++ source extensions a unity member may carry (members are TUs, not headers).
const UNITY_MEMBER_EXTS = new Set(['.cpp', '.cc', '.cxx', '.c', '.c++', '.cp']);

/**
 * Resolve one raw unity include target to an absolute host path on disk.
 * Handles WSL→host translation for absolute targets and dir-relative targets.
 * Returns null when the target isn't a C++ source or doesn't exist on disk.
 *
 * Pure-ish helper (touches fs via the injected `exists` probe) — unit-tested.
 * @param {string} raw the quoted include string from the unity file
 * @param {string} unityDirHost host-normalized dir of the unity .cxx file
 * @param {(p:string)=>boolean} [exists] fs existence probe (injectable for tests)
 * @returns {string|null} absolute host path, forward-slashed, or null
 */
export function resolveUnityMember(raw, unityDirHost, exists = fs.existsSync) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const ext = raw.includes('.') ? raw.slice(raw.lastIndexOf('.')).toLowerCase() : '';
  if (!UNITY_MEMBER_EXTS.has(ext)) return null;
  // Candidate 1: treat as absolute (WSL or already-host).
  const host = wslToHost(raw).replace(/\\/g, '/');
  const candidates = [];
  if (path.isAbsolute(host) || /^[A-Za-z]:/.test(host)) {
    candidates.push(host);
  } else {
    // Candidate 2: relative to the unity file's directory.
    candidates.push(path.join(unityDirHost, host).replace(/\\/g, '/'));
  }
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

// Replace the unity `.cxx` path token inside a command string / argument array
// with the member source path, so the synthesized entry compiles the real TU
// with the unity entry's exact flags. Matches the unity path in either its
// host or original WSL form.
function replacePathInCommand(cmd, unityFileHost, unityFileRaw, memberHost) {
  if (typeof cmd !== 'string') return cmd;
  let out = cmd;
  for (const needle of [unityFileHost, unityFileRaw]) {
    if (needle && out.includes(needle)) out = out.split(needle).join(memberHost);
  }
  return out;
}

function replacePathInArguments(args, unityFileHost, unityFileRaw, memberHost) {
  if (!Array.isArray(args)) return args;
  return args.map(tok => {
    if (tok === unityFileHost || tok === unityFileRaw) return memberHost;
    return tok;
  });
}

/**
 * Expand CMake unity-build aggregate entries into per-member-source entries.
 * For each unity TU, reads its `.cxx`, parses the member `#include "..."`
 * sources, resolves them to host paths, and synthesizes a compile entry per
 * first-party member reusing the unity entry's flags (with the unity path token
 * swapped for the member source path; `output` dropped).
 *
 * Pure-ish (fs read/exists injectable) — unit-tested.
 * @param {object[]} normalized normalized DB entries (host-pathed)
 * @param {string} projectRoot
 * @param {object} [io] injectable fs probes for tests
 * @param {(p:string)=>boolean} [io.exists]
 * @param {(p:string)=>string} [io.read]
 * @returns {{ expanded: object[], unityTuCount: number, expandedSources: number }}
 */
export function expandUnityEntries(normalized, projectRoot, io = {}) {
  const exists = io.exists || fs.existsSync;
  const read = io.read || ((p) => fs.readFileSync(p, 'utf8'));
  const expanded = [];
  const seen = new Set();
  let unityTuCount = 0;
  let expandedSources = 0;
  for (const entry of normalized) {
    if (!entry || typeof entry.file !== 'string' || !isUnityFile(entry.file)) continue;
    unityTuCount += 1;
    const unityFileHost = entry.file.replace(/\\/g, '/');
    // The original (pre-normalization) WSL form, reconstructed for token swap.
    const unityFileRaw = entry.__rawFile || unityFileHost;
    const unityDirHost = path.dirname(unityFileHost);
    if (!exists(unityFileHost)) continue;
    let body;
    try { body = read(unityFileHost); } catch { continue; }
    const includes = parseUnityIncludes(body);
    for (const raw of includes) {
      const memberHost = resolveUnityMember(raw, unityDirHost, exists);
      if (!memberHost) continue;
      // First-party gate: member must live in-repo and not under a dep/build dir.
      const rel = repoRel(projectRoot, { file: memberHost, directory: entry.directory });
      if (!rel || isDepRel(rel)) continue;
      const dedupKey = process.platform === 'win32' ? memberHost.toLowerCase() : memberHost;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const synth = {
        file: memberHost,
        directory: entry.directory,
        __unityExpanded: true
      };
      if (typeof entry.command === 'string') {
        synth.command = replacePathInCommand(entry.command, unityFileHost, unityFileRaw, memberHost);
      }
      if (Array.isArray(entry.arguments)) {
        synth.arguments = replacePathInArguments(entry.arguments, unityFileHost, unityFileRaw, memberHost);
      }
      expanded.push(synth);
      expandedSources += 1;
    }
  }
  return { expanded, unityTuCount, expandedSources };
}

// Count in-repo, non-dep, non-unity first-party entries for a parsed DB.
function countFirstParty(entries, projectRoot) {
  let firstParty = 0;
  let unity = false;
  for (const entry of entries) {
    if (!entry || typeof entry.file !== 'string') continue;
    if (isUnityFile(entry.file)) { unity = true; continue; }
    const rel = repoRel(projectRoot, entry);
    if (!rel) continue;
    if (isDepRel(rel)) continue;
    firstParty += 1;
  }
  return { firstParty, unity };
}

function parseDb(filepath) {
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Discover, normalize, and persist the richest compile_commands.json.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @returns {object} summary — see inline shape.
 */
export function prepareCompileDb({ projectRoot }) {
  if (!projectRoot) throw new Error('prepareCompileDb: projectRoot required');

  // 1. Probe every candidate, parse, and pick the one with the most in-repo
  //    first-party entries (after WSL-normalization for accurate matching).
  let best = null;
  for (const dir of PROBE_DIRS) {
    const candidate = path.join(projectRoot, dir, 'compile_commands.json');
    if (!fs.existsSync(candidate)) continue;
    const raw = parseDb(candidate);
    if (!raw) continue;
    const normalized = raw.map(normalizeEntry);
    const { firstParty, unity } = countFirstParty(normalized, projectRoot);
    if (!best || firstParty > best.firstParty) {
      best = { sourcePath: candidate, raw, normalized, firstParty, unity, entryCount: raw.length };
    }
  }

  if (!best) {
    return {
      found: false,
      diagnostics: [{
        code: 'compile_db_missing',
        message: `no compile_commands.json found in ${projectRoot} or known build dirs (build/, build-linux/, build-debug/, out/, cmake-build-debug/, …)`,
        fix: 'configure with cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON, or set APG_CLANGD and point a build at this repo'
      }]
    };
  }

  // 2. Unity expansion. For unity DBs, expand each `Unity/unity_*.cxx` aggregate
  //    into per-member-source entries so clangd analyzes real first-party TUs.
  const diagnostics = [];
  let unityExpanded = false;
  let expandedFrom = 0;
  let expandedSources = 0;
  let outEntries = best.normalized;
  let firstPartyCount = best.firstParty;

  if (best.unity) {
    const { expanded, unityTuCount, expandedSources: synthCount } =
      expandUnityEntries(best.normalized, projectRoot);
    expandedFrom = unityTuCount;
    expandedSources = synthCount;

    if (synthCount > 0) {
      unityExpanded = true;
      // Rebuild the DB: keep every non-unity entry (first-party + deps clangd
      // may need for headers), drop the unity aggregates, add expanded members.
      // De-dupe by file so a member already present as a standalone entry isn't
      // duplicated.
      const result = [];
      const seen = new Set();
      const keyOf = (f) => (process.platform === 'win32' ? String(f).toLowerCase() : String(f));
      for (const e of best.normalized) {
        if (!e || typeof e.file !== 'string') continue;
        if (isUnityFile(e.file)) continue; // drop raw aggregates
        const k = keyOf(e.file);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(e);
      }
      for (const e of expanded) {
        const k = keyOf(e.file);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(e);
      }
      outEntries = result;
      // Recount first-party against the expanded set (real member sources now
      // present; unity aggregates gone).
      firstPartyCount = countFirstParty(result, projectRoot).firstParty;

      diagnostics.push({
        code: 'unity_expanded',
        message: `expanded ${unityTuCount} unity TUs into ${synthCount} per-source entries — clangd now analyzes real first-party sources (cross-TU precision restored for expanded members).`,
        fix: 'none required; for a fully native DB reconfigure with unity OFF (-DCMAKE_UNITY_BUILD=OFF)'
      });
    } else {
      // Expansion found 0 members (unity .cxx files unreadable — e.g. the build
      // tree isn't present on this host). Keep the not-usable diagnostic.
      diagnostics.push({
        code: 'unity_build',
        message: 'compile DB is a CMake UNITY build — entries point at Unity/unity_*.cxx aggregates, not first-party TUs, and expansion found no readable member sources (build tree absent on this host?). clangd will fall back to inferred per-file flags; precision (cross-TU refs, diagnostics) is degraded.',
        fix: 'reconfigure with unity OFF (-DCMAKE_UNITY_BUILD=OFF) or pass explicit files[] to the collect call'
      });
    }
  }

  // 3. Strip internal bookkeeping and write the normalized DB.
  const cleaned = outEntries.map(stripInternal);
  const normalizedDir = path.join(projectRoot, '.aify-graph', 'code-intel');
  const normalizedPath = path.join(normalizedDir, 'compile_commands.json');
  fs.mkdirSync(normalizedDir, { recursive: true });
  const serialized = JSON.stringify(cleaned, null, 2);
  fs.writeFileSync(normalizedPath, serialized);
  const dbHash = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);

  return {
    found: true,
    sourcePath: best.sourcePath,
    normalizedDir,
    normalizedPath,
    entryCount: best.entryCount,
    firstPartyCount,
    unity: best.unity,
    unityExpanded,
    expandedFrom,
    expandedSources,
    diagnostics,
    dbHash
  };
}

// Drop internal bookkeeping keys (prefixed `__`) before serialization.
function stripInternal(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const out = {};
  for (const k of Object.keys(entry)) {
    if (k.startsWith('__')) continue;
    out[k] = entry[k];
  }
  return out;
}

const CPP_EXTENSIONS = new Set(['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hh', '.hxx']);

/**
 * Enumerate first-party, in-repo, forward-slash relative source files from a
 * (normalized) compile DB. Out-of-repo, non-C++, dep/build/vendor, and unity
 * aggregate entries are excluded. Replaces the provider's old
 * enumerateFromCompileDb; keeps its stats shape (incl. skipped_build_dep_filter)
 * and the build-filter escape hatch so existing collect tests stay green.
 *
 * @param {string} dbPath path to a (normalized) compile_commands.json
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {number} [opts.maxFiles=200]
 * @param {boolean} [opts.skipBuildDepFilter=false] disable the dep/build prefix
 *   filter (unity-build rescue) — out-of-repo and non-C++ filters still apply.
 * @returns {{ files: string[], stats: object }}
 */
export function enumerateFirstParty(dbPath, projectRoot, { maxFiles = 200, skipBuildDepFilter = false } = {}) {
  const raw = parseDb(dbPath) || [];
  const seen = new Set();
  const out = [];
  let total = 0;
  let filteredBuild = 0;
  let unity = 0;
  for (const entry of raw) {
    if (!entry || typeof entry.file !== 'string') continue;
    total += 1;
    const rel = repoRel(projectRoot, entry);
    if (!rel) continue;
    const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.')).toLowerCase() : '';
    if (ext && !CPP_EXTENSIONS.has(ext)) continue;
    // Dep/build prefix filter runs before unity classification so build-tree
    // unity aggregates (build/unity/…) count as build-dep, matching the
    // established overfilter contract. The escape hatch disables this branch.
    if (!skipBuildDepFilter && isDepRel(rel)) { filteredBuild += 1; continue; }
    // Unity aggregates are excluded from the first-party set (clangd can't
    // give per-symbol precision on them), but the escape hatch deliberately
    // keeps everything that survives the dep filter, including unity TUs.
    if (!skipBuildDepFilter && isUnityFile(rel)) { unity += 1; continue; }
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  out.sort();
  const truncated = out.length > maxFiles;
  return {
    files: truncated ? out.slice(0, maxFiles) : out,
    stats: { total, after_filter: out.length, filtered_build_dep: filteredBuild, unity, truncated, max_files: maxFiles, skipped_build_dep_filter: !!skipBuildDepFilter }
  };
}
