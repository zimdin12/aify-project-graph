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
  // Native Windows / clangd-dedicated DBs first — these are the ones our own
  // foreign-DB guidance tells users to create (Ninja+clang-cl) so host clangd
  // matches the DB. They MUST be probed, and on win32 a native one wins over a
  // foreign (Linux/WSL) one regardless of entry count (see the selection below).
  'build-win-clangd',
  'build-clangd',
  'build-win',
  'build',
  'build-debug',
  'build-linux',
  'build-linux-techlead',
  'build-debug-win',
  'cmake-build-debug',
  'out'
];

// CMake emits unity aggregates per language: C++ TUs land in `unity_<n>_cxx.cxx`
// but a target that also compiles C sources gets a parallel `unity_<n>_c.c`
// (and rarely `.cc`). The original pattern only matched the C++ variant, so the
// C aggregate (a) never had its first-party `.c` members expanded and (b) leaked
// into the normalized DB as a bogus unity TU clangd would treat as a real
// source. Match every unity-source extension so both get expanded+dropped.
const UNITY_RE = /Unity[\\/]unity_\d+_.*\.(cxx|cpp|cc|c|c\+\+|cp)$/i;

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

/**
 * Inverse of {@link wslToHost}: translate a Windows host path
 * (`C:/Users/x` or `C:\\Users\\x`) to its WSL `/mnt/<drive>/...` form. This is
 * the direction needed for the opt-in WSL-clangd transport (APG_CLANGD_WSL):
 * file URIs we send to a clangd running UNDER WSL must name `/mnt/c/...` Linux
 * paths, even though the rest of APG works in Windows paths.
 *
 * Backslashes are normalized to `/`. Already-WSL paths (`/mnt/...`) and bare
 * POSIX paths (`/usr/...`) are returned unchanged. Non-win32 hosts: Windows
 * drive paths shouldn't occur, but if one does it's still translated (the
 * mapping is purely lexical and platform-independent), so this stays a pure,
 * directly unit-testable helper on every platform.
 *
 * @param {string} p
 * @returns {string}
 */
export function hostToWsl(p) {
  if (typeof p !== 'string' || p.length === 0) return p;
  const norm = p.replace(/\\/g, '/');
  const m = /^([a-zA-Z]):(\/.*)?$/.exec(norm);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2] || '/';
    return `/mnt/${drive}${rest}`;
  }
  return norm;
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

// ── P0-3: foreign (Linux/WSL) toolchain detection + normalization ──────────
//
// The game compile DBs are built under WSL/Linux: the compiler is a POSIX path
// (`/usr/bin/c++`), `directory` is a `/mnt/c/...` WSL path, and the flags carry
// Linux-only toolchain anchors (`-isysroot /…`, `--sysroot=/…`,
// `--gcc-toolchain=/…`, absolute `-isystem /usr/…` system-include dirs). On
// Windows none of those resolve, so clangd can't find the C++ stdlib and emits
// a cascade of bogus "'cstddef' file not found" diagnostics; hover then recovers
// garbage types. References/hierarchy still mostly work (they don't need the
// stdlib resolved), so the pragmatic Windows fix is: keep the project's real
// `-I/-D/-std` flags (already WSL→host-normalized) but STRIP the Linux-only
// toolchain anchors that can only mislead clangd, and let clangd infer the host
// compiler's includes via the `--query-driver=*` launch flag.
//
// This pass is win32-ONLY. On Linux the "foreign" Linux paths ARE the host
// paths, so detection returns false and nothing is stripped (pure no-op).

// A glued or separated arg whose VALUE is a Linux-only system path we must drop.
// `-isystem /usr/...` and absolute `/usr`/`/mnt` system dirs can't resolve on
// Windows; the project's own `-I.../engine` dirs are host-translated and kept.
function isForeignSystemIncludeValue(val) {
  if (typeof val !== 'string') return false;
  // After normalization `/mnt/...` becomes `C:/...`; a *remaining* POSIX-absolute
  // value (`/usr/...`, `/lib/...`, bare `/`) is a Linux system path with no host
  // equivalent. We only strip system-include style values, never `-I` project
  // dirs (handled separately — those are kept).
  return /^\/(usr|lib|lib64|opt|gnu|include)\b/.test(val) || val === '/';
}

/**
 * Detect whether a (raw, pre-normalization) compile DB was built on a foreign
 * (Linux/WSL) toolchain that won't resolve on the current Windows host.
 *
 * Signals (any one is sufficient):
 *  - compiler (first token / `arguments[0]`) is a POSIX-absolute path
 *    (`/usr/bin/c++`).
 *  - `directory` is a WSL/POSIX-absolute path (`/mnt/c/...` or `/...`).
 *  - flags contain `-isysroot /…`, `--sysroot=/…`, `--gcc-toolchain=/…`, or an
 *    absolute `-isystem /usr…` system-include flag.
 *
 * Pure helper — unit-tested directly. Returns false on non-win32 (the Linux
 * paths ARE host paths there), so callers don't need to platform-gate.
 *
 * @param {object[]} rawEntries parsed compile_commands.json entries (raw)
 * @returns {{ foreign: boolean, reasons: string[] }}
 */
export function detectForeignToolchain(rawEntries) {
  if (process.platform !== 'win32') return { foreign: false, reasons: [] };
  if (!Array.isArray(rawEntries)) return { foreign: false, reasons: [] };
  const reasons = new Set();
  const isPosixAbs = (s) => typeof s === 'string' && /^\/(?!\/)/.test(s); // leading single '/'
  for (const e of rawEntries) {
    if (!e || typeof e !== 'object') continue;
    if (isPosixAbs(e.directory)) reasons.add('posix_directory');
    let toks = [];
    if (Array.isArray(e.arguments)) toks = e.arguments;
    else if (typeof e.command === 'string') toks = e.command.split(/\s+/).filter(Boolean);
    if (toks.length && isPosixAbs(toks[0])) reasons.add('posix_compiler');
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (typeof t !== 'string') continue;
      if (t.startsWith('--sysroot=') && isPosixAbs(t.slice('--sysroot='.length))) reasons.add('sysroot');
      else if (t.startsWith('--gcc-toolchain=') && isPosixAbs(t.slice('--gcc-toolchain='.length))) reasons.add('gcc_toolchain');
      else if (t === '--sysroot' && isPosixAbs(toks[i + 1])) reasons.add('sysroot');
      else if (t === '-isysroot' && isPosixAbs(toks[i + 1])) reasons.add('isysroot');
      else if (t === '-isystem' && isForeignSystemIncludeValue(toks[i + 1])) reasons.add('isystem_system');
      else if (t.startsWith('-isysroot') && t.length > '-isysroot'.length && isPosixAbs(t.slice('-isysroot'.length))) reasons.add('isysroot');
      else if (t.startsWith('-isystem') && t.length > '-isystem'.length && isForeignSystemIncludeValue(t.slice('-isystem'.length))) reasons.add('isystem_system');
    }
    if (reasons.size >= 3) break; // enough signal; stop scanning huge DBs
  }
  return { foreign: reasons.size > 0, reasons: [...reasons] };
}

// Linux-only toolchain anchor flags to strip from a NORMALIZED entry on win32.
// Each is either a separated `<flag> <value>` pair or a glued `<flag><value>` /
// `<flag>=<value>` form. We strip only when the value is a Linux-only path that
// can't resolve on Windows; project `-I`/`-D`/`-std`/`-isystem <project _deps>`
// flags are deliberately preserved.
function stripForeignFlagsFromArgs(args) {
  if (!Array.isArray(args)) return { args, stripped: 0 };
  const out = [];
  let stripped = 0;
  const posixAbs = (s) => typeof s === 'string' && /^\/(?!\/)/.test(s);
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    // Separated forms: drop the flag AND its value token.
    if ((t === '-isysroot' || t === '--sysroot') && posixAbs(args[i + 1])) { stripped++; i++; continue; }
    if (t === '-isystem' && isForeignSystemIncludeValue(args[i + 1])) { stripped++; i++; continue; }
    // Glued / `=` forms.
    if (typeof t === 'string') {
      if (t.startsWith('--sysroot=') && posixAbs(t.slice(10))) { stripped++; continue; }
      if (t.startsWith('--gcc-toolchain=') && posixAbs(t.slice(16))) { stripped++; continue; }
      if (t.startsWith('-isysroot') && t.length > 9 && posixAbs(t.slice(9))) { stripped++; continue; }
      if (t.startsWith('-isystem') && t.length > 8 && isForeignSystemIncludeValue(t.slice(8))) { stripped++; continue; }
    }
    out.push(t);
  }
  return { args: out, stripped };
}

// Same strip over a command STRING. Token-walk so a separated `-isysroot /x`
// pair drops both tokens. Returns the rewritten string + strip count.
function stripForeignFlagsFromCommand(cmd) {
  if (typeof cmd !== 'string') return { command: cmd, stripped: 0 };
  const toks = cmd.split(/\s+/);
  const { args, stripped } = stripForeignFlagsFromArgs(toks);
  return { command: args.join(' '), stripped };
}

// Apply the foreign-toolchain strip to one (already host-normalized) entry,
// in place on a copy. Returns the count of flags stripped.
function stripForeignEntry(entry) {
  let stripped = 0;
  if (Array.isArray(entry.arguments)) {
    const r = stripForeignFlagsFromArgs(entry.arguments);
    entry.arguments = r.args;
    stripped += r.stripped;
  }
  if (typeof entry.command === 'string') {
    const r = stripForeignFlagsFromCommand(entry.command);
    entry.command = r.command;
    stripped += r.stripped;
  }
  return stripped;
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

// First-party gate for unity MEMBER sources (repo-relative). A member is
// first-party when it is in-repo and not a dep/build/vendor source. Test
// sources (`tests/**`, `test/**`) ARE first-party — they're the callers whose
// edges into the engine we specifically want — so they must pass even though
// they aren't engine/game/sim code. (`isDepRel` already lets `tests/` through,
// but state the contract explicitly so a future dep-rule can never silently
// strip the test→engine caller edges P0-2 is about.)
function isFirstPartyMemberRel(rel) {
  if (!rel) return false;
  const first = (rel.split('/')[0] || '').toLowerCase();
  if (first === 'tests' || first === 'test') return true;
  return !isDepRel(rel);
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
      // First-party gate: member must live in-repo and not under a dep/build
      // dir. Test sources (`tests/**`) are first-party and pass — they carry the
      // test→engine caller edges P0-2 restores.
      const rel = repoRel(projectRoot, { file: memberHost, directory: entry.directory });
      if (!isFirstPartyMemberRel(rel)) continue;
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
// Memo: prepareCompileDb re-parses every candidate DB, may unity-expand member
// .cxx files, and unconditionally rewrites the normalized DB to disk. It runs on
// the interactive hot path (every code_intel_references / code_intel_hierarchy
// call routes through computeCompileDbCoverage → prepareCompileDb). Cache the
// full result per projectRoot, keyed by a cheap fingerprint of every candidate
// compile_commands.json (mtime+size). Any DB change busts the cache and re-runs
// the full prepare (including the write); a cache hit skips parse+expand+write.
const _prepareCache = new Map();

function compileDbProbeFingerprint(projectRoot) {
  const parts = [];
  for (const dir of PROBE_DIRS) {
    const candidate = path.join(projectRoot, dir, 'compile_commands.json');
    try {
      const st = fs.statSync(candidate);
      parts.push(`${candidate}:${st.mtimeMs}:${st.size}`);
    } catch { /* candidate absent — contributes nothing, like before */ }
  }
  return parts.join('|');
}

export function prepareCompileDb({ projectRoot }) {
  if (!projectRoot) throw new Error('prepareCompileDb: projectRoot required');

  const fingerprint = compileDbProbeFingerprint(projectRoot);
  const cached = _prepareCache.get(projectRoot);
  if (cached && cached.fingerprint === fingerprint) return cached.result;

  const mkCandidate = (candidate) => {
    if (!fs.existsSync(candidate)) return null;
    const raw = parseDb(candidate);
    if (!raw) return null;
    const normalized = raw.map(normalizeEntry);
    const { firstParty, unity } = countFirstParty(normalized, projectRoot);
    // On win32 a NATIVE (non-foreign) DB is strictly preferred over a foreign
    // (Linux/WSL) one — host clangd can only compile the native one, so a foreign
    // DB with MORE entries still truncates caller sets. detectForeignToolchain is
    // a no-op off win32. (Sand Castle probe bug: WSL build/ was winning by count.)
    const foreign = detectForeignToolchain(raw).foreign;
    return { sourcePath: candidate, raw, normalized, firstParty, unity, entryCount: raw.length, foreign };
  };

  // 0. APG_COMPILE_DB pins a specific compile DB (a compile_commands.json file or
  //    its directory), overriding the probe entirely — a deterministic escape
  //    hatch when auto-selection picks the wrong DB. Falls through to the probe
  //    if the pinned path is missing/unparseable.
  let best = null;
  const pinRaw = String(process.env.APG_COMPILE_DB ?? '').trim();
  if (pinRaw) {
    const asFile = pinRaw.toLowerCase().endsWith('.json') ? pinRaw : path.join(pinRaw, 'compile_commands.json');
    best = mkCandidate(path.resolve(asFile));
  }

  // 1. Probe every candidate, parse, and pick the best: a non-foreign DB beats a
  //    foreign one (win32); within the same foreign status, most first-party wins.
  if (!best) {
    for (const dir of PROBE_DIRS) {
      const cand = mkCandidate(path.join(projectRoot, dir, 'compile_commands.json'));
      if (!cand) continue;
      if (!best) { best = cand; continue; }
      if (best.foreign && !cand.foreign) { best = cand; continue; } // native beats foreign
      if (!best.foreign && cand.foreign) continue;                  // keep the native one
      if (cand.firstParty > best.firstParty) best = cand;           // tie-break by coverage
    }
  }

  if (!best) {
    const result = {
      found: false,
      diagnostics: [{
        code: 'compile_db_missing',
        message: `no compile_commands.json found in ${projectRoot} or known build dirs (build/, build-linux/, build-debug/, out/, cmake-build-debug/, …)`,
        fix: 'configure with cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON, or set APG_CLANGD and point a build at this repo'
      }]
    };
    _prepareCache.set(projectRoot, { fingerprint, result });
    return result;
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

  // 2b. P0-3 foreign-toolchain pass (win32-only). The DB was built on Linux/WSL
  //     so the compiler + sysroot + system-include flags point at Linux paths
  //     that don't resolve on Windows → clangd's bogus stdlib-not-found cascade.
  //     Detect on the RAW entries (pre-normalization, while `/mnt/` + the POSIX
  //     compiler are still visible) and strip the Linux-only toolchain anchors
  //     from the normalized output. References/hierarchy stay usable; full
  //     diagnostics/hover need clangd run under WSL against the Linux DB.
  let foreignToolchain = false;
  let foreignReasons = [];
  let strippedFlags = 0;
  const detected = detectForeignToolchain(best.raw);
  if (detected.foreign) {
    foreignToolchain = true;
    foreignReasons = detected.reasons;
    for (const e of outEntries) strippedFlags += stripForeignEntry(e);
  }

  // 3. Strip internal bookkeeping and write the normalized DB.
  const cleaned = outEntries.map(stripInternal);
  const normalizedDir = path.join(projectRoot, '.aify-graph', 'code-intel');
  const normalizedPath = path.join(normalizedDir, 'compile_commands.json');
  fs.mkdirSync(normalizedDir, { recursive: true });
  const serialized = JSON.stringify(cleaned, null, 2);
  // Only rewrite the normalized DB when its content actually changed — avoids
  // thrashing the file's mtime (anything watching it) on repeat prepares.
  let existing = null;
  try { existing = fs.readFileSync(normalizedPath, 'utf8'); } catch { /* absent */ }
  if (existing !== serialized) fs.writeFileSync(normalizedPath, serialized);
  const dbHash = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16);

  if (foreignToolchain) {
    diagnostics.push({
      code: 'foreign_toolchain',
      // HONESTY FIX (Sand Castle live finding 1): the old message claimed
      // "references and call/type hierarchy stay usable" — they are NOT. When a
      // foreign (Linux/WSL) DB's TUs fail to compile against the host clangd, the
      // index falls back to PARTIAL and caller sets are silently truncated —
      // even SAME-FILE references (observed: 2 of 5 in-file callsites returned).
      // So this host can't use code_intel_references as a completeness oracle
      // until the index is fixed. Stripping Linux-only flags is not enough.
      message: `compile DB built on Linux/WSL (signals: ${foreignReasons.join(', ')}); stripped ${strippedFlags} Linux-only toolchain flag(s). On this Windows host clangd cannot compile these TUs, so the index is silently PARTIAL: code_intel_references / code_intel_hierarchy caller sets are TRUNCATED — even SAME-FILE references can be missed — and diagnostics/hover are degraded. Do NOT trust any "no callers / dead code / safe to delete" result here; verify with rg. FIX (preferred — host clangd matches a native Windows DB): generate one with a Ninja+clang-cl configure (MSBuild's generator does NOT emit compile_commands.json): cmake -S . -B build-win-clangd -G Ninja -DCMAKE_C_COMPILER=clang-cl -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON — APG auto-discovers build-win-clangd/. FALLBACK (if you keep a Linux/WSL build): set APG_CLANGD_WSL=1 to run clangd under WSL against that DB.`,
      fix: 'preferred: generate a native Windows compile DB via a Ninja+clang-cl configure (cmake -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON), which APG auto-discovers; fallback: set APG_CLANGD_WSL=1 to run clangd under WSL against the Linux DB'
    });
  }

  const result = {
    found: true,
    sourcePath: best.sourcePath,
    // Directory of the ORIGINAL (un-normalized) compile DB. The opt-in
    // WSL-clangd transport points `--compile-commands-dir` here (e.g.
    // `…/build-linux`) so clangd-under-WSL consumes the raw Linux DB with its
    // `/mnt/c/...` paths + Linux toolchain intact, instead of the Windows-
    // normalized copy under .aify-graph.
    sourceDir: path.dirname(best.sourcePath),
    normalizedDir,
    normalizedPath,
    entryCount: best.entryCount,
    firstPartyCount,
    unity: best.unity,
    unityExpanded,
    expandedFrom,
    expandedSources,
    foreignToolchain,
    foreignReasons,
    strippedFlags,
    diagnostics,
    dbHash
  };
  _prepareCache.set(projectRoot, { fingerprint, result });
  return result;
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

// ── Compile-DB COVERAGE (false-exhaustive guard) ─────────────────────────────
// clangd's textDocument/references is best-effort over its index, and that index
// covers ONLY the translation units in compile_commands.json (+ their headers).
// A first-party .cpp that is NOT a compile-DB entry — e.g. a CMake unity-built
// test source that only lives as `#include "test_foo.cpp"` inside a unity .cxx —
// is never indexed as a standalone TU, so callers living in it are INVISIBLE to
// references, and clangd never signals the gap. Therefore an "exhaustive /
// safe-to-delete" claim is UNSOUND whenever the compile DB does not cover every
// first-party source file. This helper measures that coverage cheaply (a bounded
// filesystem walk diffed against the prepared/expanded DB's entry set) so the
// evidence contract can refuse to claim exhaustive when coverage is incomplete.
// (Confirmed root cause of the 2026-06-02 false-exhaustive bug: sand_castle
// builds tests as unity, so the test TUs were absent from the DB yet
// code_intel_references still reported exhaustive=true while missing real callers.)
const _coverageCache = new Map(); // projectRoot → { dbHash, coverage }

// True when clangd is configured to run UNDER WSL against the native Linux DB
// (APG_CLANGD_WSL=1|true|auto). In that mode a Linux/WSL compile DB is NOT
// foreign to the clangd process, so foreign-toolchain incompleteness doesn't
// apply. Pure env read so the coverage verdict matches the actual transport.
function wslClangdActive(env = process.env) {
  const v = String(env.APG_CLANGD_WSL || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'auto';
}

/**
 * Decide whether clangd's index over this repo's compile DB is TRUSTWORTHY FOR
 * COMPLETENESS — i.e. whether a non-empty references/caller set may be claimed
 * `exhaustive` ("safe to delete"). This is gated on the RELIABLE compile-DB
 * signals from prepareCompileDb, NOT a fragile source-vs-DB path diff:
 *
 *   - FOREIGN TOOLCHAIN (Linux/WSL DB compiled by a Windows-host clangd, and not
 *     running in WSL-clangd mode): TUs silently fail to compile under the host
 *     clangd → the background index is partial → references can miss real callers
 *     while still reporting indexReady. This was the confirmed 2026-06-02
 *     false-exhaustive cause on sand_castle. → NOT trustworthy.
 *   - UNEXPANDED UNITY (CMake unity DB whose aggregates couldn't be expanded into
 *     per-source TUs on this host): the real .cpp are absent from the index. →
 *     NOT trustworthy.
 *   - otherwise (native DB, or WSL-clangd over the native Linux DB, unity
 *     expanded): coverage is trustworthy → `exhaustive` is allowed.
 *
 * Returns { complete, reason, foreignToolchain, unityUnexpanded, unity }. Cached
 * per projectRoot+dbHash. Defensive: never throws; complete:false on any failure
 * (the safe under-claim — codegraph's "partial coverage is worse than none").
 */
// P0-1 (2026-07-26): the set of first-party, repo-relative source files the DB
// actually has a compile command for. Cached per normalized-DB hash because a
// coverage check runs on every live reference/hierarchy query.
const _dbFileSetCache = new Map();
function firstPartyFileSet(projectRoot, prep) {
  const cached = _dbFileSetCache.get(projectRoot);
  if (cached && cached.dbHash === prep.dbHash) return cached.set;
  const set = new Set();
  try {
    for (const entry of parseDb(prep.normalizedPath) || []) {
      if (!entry || typeof entry.file !== 'string') continue;
      if (isUnityFile(entry.file)) continue;
      const rel = repoRel(projectRoot, entry);
      if (!rel || isDepRel(rel)) continue;
      set.add(rel.toLowerCase());
    }
    // L2: only cache a set we actually built. Caching an EMPTY set after a parse
    // failure would pin "every file uncovered" for the whole process lifetime
    // against a otherwise-valid dbHash.
    _dbFileSetCache.set(projectRoot, { dbHash: prep.dbHash, set });
  } catch { /* unreadable DB → uncached empty set; callers treat as "cannot prove" */ }
  return set;
}

// Count first-party translation units ON DISK, so DB coverage can be expressed
// as a RATIO rather than a "> 0" boolean. A DB exporting 1 of 500 sources is not
// meaningfully different from one exporting none: clangd still has no compile
// command for ~everything, and caller sets still truncate silently.
// Bounded (dirs + files) so this can run on a query path; cached per prepared DB.
const SOURCE_EXT_RE = /\.(c|cc|cpp|cxx|c\+\+|ixx)$/i;
// Generous enough that real repos FINISH. An unfinished walk has to fail closed
// (an under-counted denominator inflates the ratio), but clamping too early made
// `exhaustive` unreachable on any repo past ~4000 directories — a mid-size C++
// project. These bounds exist only to stop a pathological tree (or a symlink
// explosion) from hanging a query; the walk is cached per compile-DB hash, and
// measured ~50ms per 9k files.
const DISK_WALK_FILE_CAP = 200_000;
const DISK_WALK_DIR_CAP = 50_000;

// Returns { count, capped }. `capped` matters for SAFETY, not just accuracy: if
// the walk stops early the count is UNDER-reported, which INFLATES
// firstPartyCount/diskSources and pushes the ratio toward granting exhaustive —
// the unsafe direction. A capped walk therefore means "coverage unknown", never
// "coverage fine".
// Returns { set, capped } — the SET of first-party source files on disk, keyed
// the same way firstPartyFileSet keys DB entries so the two can be intersected.
// Counting them separately was the H1 defect: `countFirstParty` counts one per DB
// ENTRY, so a source compiled into 3 targets (object library, static+shared pair,
// lib+test) counted 3 times and the "ratio" exceeded 1.0 while 60% of the repo
// was unindexed.
function walkFirstPartySourcesOnDisk(projectRoot) {
  const set = new Set();
  let dirs = 0;
  let capped = false;
  const seenDirs = new Set();          // realpath guard: symlink cycles
  const stack = [projectRoot];
  while (stack.length) {
    if (set.size >= DISK_WALK_FILE_CAP || dirs >= DISK_WALK_DIR_CAP) { capped = true; break; }
    const dir = stack.pop();
    // Symlinked/junctioned source trees are common in monorepos; skipping them
    // shrank the denominator and inflated coverage (H2). Follow them, but only
    // once per real path.
    let real;
    try { real = fs.realpathSync(dir); } catch { real = dir; }
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);
    dirs += 1;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      if (!rel || isDepRel(rel)) continue;
      // A Dirent for a symlink reports isSymbolicLink(), NOT isDirectory().
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try { isDir = fs.statSync(full).isDirectory(); } catch { isDir = false; }
      }
      if (isDir) {
        if (entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (SOURCE_EXT_RE.test(entry.name)) {
        set.add(rel.toLowerCase());
      }
    }
  }
  return { set, capped };
}

// Cached per (projectRoot, dbHash). NOTE the deliberate limitation: sources added
// or deleted on disk WITHOUT a compile-DB change reuse the cached count. That is
// acceptable because the DB is what determines coverage — adding sources that no
// build compiles is exactly the drift this gate is meant to catch, and it will be
// caught on the next DB change. It is cached at all because the walk runs on a
// query path.
// Cached per (projectRoot, dbHash) because the walk runs on a query path. The
// TTL bounds the known limitation: sources added WITHOUT a compile-DB change
// (mid-edit, not yet built) are exactly the highest-risk hidden callers, so the
// denominator must not be frozen for the whole process lifetime (M7).
const DISK_WALK_TTL_MS = 60_000;
const _diskCountCache = new Map();
// ⛔ THE CACHE IS FINE; AUTHORISING A DELETION FROM IT IS NOT. graph-senior-dev executed the
// consequence: add a caller-bearing source in-session, and within the TTL the denominator still
// describes the repo as it was — so `exhaustive:true` was re-issued over a population that had
// already changed. A recalled census may not license an irreversible claim, so freshness now
// TRAVELS WITH the census instead of being knowable only here.
function firstPartySourcesOnDisk(projectRoot, dbHash, { force = false } = {}) {
  const cached = _diskCountCache.get(projectRoot);
  if (!force && cached && cached.dbHash === dbHash && (Date.now() - cached.at) < DISK_WALK_TTL_MS) {
    return { ...cached, censusFresh: false };
  }
  const result = { dbHash, at: Date.now(), ...walkFirstPartySourcesOnDisk(projectRoot) };
  _diskCountCache.set(projectRoot, result);
  return { ...result, censusFresh: true };
}

// Threshold for licensing an EXHAUSTIVE caller set.
//
// Reasoning it through: "X has no callers" is a claim about the WHOLE repo, and
// clangd can only see callers in translation units its index covers. A TU absent
// from the compile DB is a TU whose calls are invisible — so every uncovered
// first-party source is a place a caller could be hiding. The queried file being
// present proves only that the QUERIED TU compiles; it says nothing about where
// the callers live.
//
// That argues for requiring 100%. In practice a healthy repo legitimately
// excludes some sources from a given build (platform-specific files, tools,
// alternate backends), so a hard 1.0 would make `exhaustive` unreachable and the
// contract useless. 0.9 is the compromise: it rejects the pathological cases this
// was built for (0%, 1-of-500, half a repo) while staying reachable.
//
// The residual risk is REAL and is not hidden: the shortfall is named in the
// reason with exact counts, so an agent can see that N sources are unindexed and
// weigh an absence claim accordingly. A threshold does not make the remainder
// safe — it only bounds it.
const MIN_FIRST_PARTY_COVERAGE = 0.9;

// A header has no translation unit of its own — it is compiled as part of every
// TU that includes it — so its absence from the DB is expected and must NOT be
// read as missing coverage. NOTE: exempting a header only makes sense when the
// DB covers the repo well; with poor coverage the header's including TUs are
// exactly what is missing, so the exemption is withdrawn (H1).
// M7: `.ixx` is a C++20 module interface — a REAL translation unit with its own
// compile command — so it must NOT be exempt. Template/inline-only extensions
// that never appear in a compile DB must be.
const HEADER_RE = /\.(h|hh|hpp|hxx|inl|ipp|tpp|tcc|txx|inc|def)$/i;

const NO_FIRST_PARTY_REASON =
  'the compile DB contains ZERO first-party entries — every command belongs to third-party/_deps code, '
  + 'so clangd has no compile command for any of your own sources and falls back to inferred commands. '
  + 'The index is silently PARTIAL: caller sets are TRUNCATED (even same-file references) and are NOT a '
  + 'completeness oracle. Verify with rg before any "no callers / dead code / safe to delete" claim. '
  + 'FIX: configure CMake to export compile commands for your OWN targets, not only dependencies — '
  + 'cmake -S . -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON '
  + '(APG auto-discovers build-win-clangd/), then confirm your sources appear in its compile_commands.json.';

export function computeCompileDbCoverage({ projectRoot, prepared, file = null, env = process.env } = {}) {
  const fail = (reason) => ({ complete: false, reason, foreignToolchain: false, unityUnexpanded: false, unity: false, firstPartyCount: 0 });
  if (!projectRoot) return fail('no projectRoot');
  let prep;
  try { prep = prepared || prepareCompileDb({ projectRoot }); }
  catch { return fail('compile DB preparation failed'); }
  if (!prep || !prep.found) return fail('no compile_commands.json — clangd has no index, so a caller set is never exhaustive');

  // Cache only the expensive prep-derived flags; the WSL-mode verdict is env-
  // dependent and cheap, so derive it fresh each call.
  let flags = _coverageCache.get(projectRoot);
  if (!flags || flags.dbHash !== prep.dbHash) {
    flags = {
      dbHash: prep.dbHash,
      foreignToolchain: Boolean(prep.foreignToolchain),
      unity: Boolean(prep.unity),
      unityUnexpanded: Boolean(prep.unity && !prep.unityExpanded),
    };
    _coverageCache.set(projectRoot, flags);
  }

  const foreignBlocking = flags.foreignToolchain && !wslClangdActive(env);
  const unityUnexpanded = flags.unityUnexpanded;

  // P0-1: a native, non-unity DB proves NOTHING if it does not actually cover
  // your code. Measured on sand_castle: 5 DBs, 441-512 entries each, ZERO
  // first-party — and we reported exhaustive:true while clangd returned 3 of 8
  // in-file call sites. `firstPartyCount` was already computed by
  // prepareCompileDb and simply never consulted here.
  const firstPartyCount = Number(prep.firstPartyCount ?? 0);
  // H1: a bare `> 0` check let a DB exporting 1 of 500 sources claim full
  // coverage — the same silent-truncation shape as exporting none. Compare
  // against the sources actually on disk and require a real share.
  // ⛔ THE CACHE IS NOT THE DEFECT; AUTHORISING FROM IT IS. graph-senior-dev added a
  // caller-bearing source in-session and, inside the 60s TTL, the denominator still described
  // the old repo — so the grant was re-issued over a population that had already changed.
  //
  // ⚠ REFUSING ON ANY CACHED CENSUS WAS MY FIRST FIX AND IT WAS WRONG: every second query
  // within the TTL would have withheld the flag, which does not make the tool honest, it makes
  // the field unreachable — and an unreachable field gets loosened back by the next person.
  //
  // ⇒ Pay for the walk only where it can license something. Read the cache first; if the answer
  // would be a GRANT, re-walk uncached and decide on that. The cost lands on the granting path
  // alone, and a census that authorized a deletion was always measured, never recalled.
  let disk = firstPartySourcesOnDisk(projectRoot, prep.dbHash);
  if (disk.censusFresh === false && !disk.capped && disk.set.size > 0) {
    const wouldGrant = firstPartyFileSet(projectRoot, prep).size >= disk.set.size;
    if (wouldGrant) disk = firstPartySourcesOnDisk(projectRoot, prep.dbHash, { force: true });
  }
  const diskSources = disk.set.size;
  // The ratio is |DB sources ∩ disk sources| / |disk sources| — an intersection
  // of the SAME kind of thing on both sides. Comparing a DB ENTRY count against a
  // distinct-file count (H1) let duplicates across targets, non-C++ entries
  // (.cu/.m/.S/.rc), and entries for deleted files all inflate the numerator past
  // 1.0 while most of the repo was unindexed.
  let coveredOnDisk = 0;
  if (diskSources > 0) {
    for (const rel of firstPartyFileSet(projectRoot, prep)) {
      if (disk.set.has(rel)) coveredOnDisk += 1;
    }
  }
  // A capped walk under-counts the denominator, which would INFLATE the ratio
  // toward granting exhaustive — treat as unknown, never as passing.
  const coverageRatio = (!disk.capped && diskSources > 0) ? coveredOnDisk / diskSources : null;
  const poorlyCovered = disk.capped
    ? true
    : (coverageRatio !== null && coverageRatio < MIN_FIRST_PARTY_COVERAGE);
  // ⛔⛔ P0, 2026-08-19: A THRESHOLD MAY NOT GRANT A BOOLEAN NAMED "EXHAUSTIVE".
  // graph-senior-dev executed it against real clangd: ten valid TUs, nine in the compile DB,
  // ratio exactly 0.9 — so `poorlyCovered` was false, `complete` was true, and the verb
  // returned exhaustive:true while omitting a caller that exists in the source. On a 1000-TU
  // repo that is 100 caller-bearing TUs excluded with the flag still granted.
  //
  // ★ The comment above MIN_FIRST_PARTY_COVERAGE already conceded this — "A threshold does not
  // make the remainder safe — it only bounds it" — and the code then converted the admitted
  // residual risk into an unqualified boolean. Absence of a limit is not permission.
  //
  // ⚠ Yes, this makes the flag harder to reach, and the old comment's objection stands: a
  // healthy repo legitimately excludes some sources from a build. That does not change the
  // answer. The ONLY thing this field does is license an irreversible action, so an
  // unreachable-but-true contract beats a reachable-but-false one. The route back to
  // reachability is a DECLARED population, not a tolerance.
  // ⚠ `poorlyCovered` is KEPT as the separate SEVERITY signal, so the harsher existing prose
  // still fires only on genuinely bad coverage. It no longer decides the grant.
  const fullyCovered = !disk.capped && coverageRatio === 1;
  const censusRecalled = disk.censusFresh === false;
  const noFirstParty = firstPartyCount === 0;

  // File-aware gate (mirrors the 2026-06-12 tsCoverage hardening, which C++
  // never received): a SOURCE file with no compile command is not covered.
  // Headers are exempt — they have no TU of their own.
  let fileUncovered = false;
  // The header exemption only holds when the DB covers the repo well (H1): with
  // poor coverage, the TUs that include the header are precisely what is absent.
  const headerExempt = HEADER_RE.test(String(file ?? '')) && !poorlyCovered;
  if (file && !noFirstParty && !headerExempt) {
    // M2: agents legitimately pass ABSOLUTE paths (openIfNeeded accepts them),
    // but the DB set is keyed repo-relative. Without this, an absolute path never
    // matched and produced a permanent `fileUncovered` with a factually WRONG
    // reason ("no compile command") for a file that is in the DB.
    let rel = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
    const rootFwd = String(projectRoot).replace(/\\/g, '/').replace(/\/$/, '');
    if (rel.toLowerCase().startsWith(`${rootFwd.toLowerCase()}/`)) {
      rel = rel.slice(rootFwd.length + 1);
    }
    fileUncovered = !firstPartyFileSet(projectRoot, prep).has(rel.toLowerCase());
  }

  let reason = null;
  if (noFirstParty) {
    reason = NO_FIRST_PARTY_REASON;
  } else if (poorlyCovered && disk.capped) {
    reason = `this repo is too large to enumerate within the coverage-check budget (stopped at ~${diskSources} sources), `
      + `so the share of your code the compile DB actually covers could not be established. The caller set is therefore a `
      + `FLOOR, not a completeness oracle — verify with rg before any "no callers / dead code / safe to delete" claim.`;
  } else if (poorlyCovered) {
    const missing = Math.max(0, diskSources - coveredOnDisk);
    reason = `the compile DB covers ${coveredOnDisk} of ~${diskSources} first-party sources `
      + `(${Math.round(coverageRatio * 100)}%), leaving ~${missing} translation unit(s) unindexed. A caller in any of `
      + `those is INVISIBLE to clangd, so the caller set is a FLOOR, not a completeness oracle — verify with rg before `
      + `any "no callers / dead code / safe to delete" claim. FIX: export compile commands for all your targets `
      + `(-DCMAKE_EXPORT_COMPILE_COMMANDS=ON on a build that compiles them) and confirm your sources appear in compile_commands.json.`;
  } else if (fileUncovered) {
    reason = `the queried file has no compile command in the compile DB (it is not in compile_commands.json), `
      + `so clangd compiles it with an inferred command and its index for this file is PARTIAL — caller sets `
      + `may miss real callers. Verify with rg before any delete/rename, and ensure this source is part of a `
      + `target exported with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON.`;
  } else if (foreignBlocking) {
    reason = 'compile DB was built by a different (Linux/WSL) toolchain than the host clangd, so some TUs fail to compile and the index is silently PARTIAL — caller sets may miss real callers. Set APG_CLANGD_WSL=1 (run clangd under WSL against the native DB) for a trustworthy index, and verify with rg before any delete/rename';
  } else if (unityUnexpanded) {
    reason = 'compile DB is a CMake UNITY build whose per-source TUs are absent (aggregates not expanded on this host), so callers in unity-only sources are invisible to clangd — verify with rg before any delete/rename';
  } else if (!fullyCovered && coverageRatio !== null) {
    // Above the severity threshold but not complete: the shortfall is small, so the prose is
    // proportionate — but the population is NAMED, because a withheld grant with no cause
    // misdirects the remedy exactly as a false grant misdirects the decision.
    const missing = Math.max(0, diskSources - coveredOnDisk);
    reason = `the compile DB covers ${coveredOnDisk} of ~${diskSources} first-party sources `
      + `(${Math.round(coverageRatio * 100)}%), leaving ~${missing} translation unit(s) unindexed. `
      + `That is good coverage, but a caller in any excluded TU is INVISIBLE to clangd, so this `
      + `caller set cannot be attested exhaustive — it is a FLOOR. Verify with rg before any `
      + `"no callers / dead code / safe to delete" claim.`;
  } else if (censusRecalled) {
    reason = 'the first-party source census was recalled from cache rather than measured during '
      + 'this call, so a source added since then would not appear in the denominator. Coverage '
      + 'may be reported against a population the repository no longer has.';
  }
  return {
    // `complete` is the AUTHORITY both code_intel_references and code_intel_hierarchy read to
    // grant exhaustive. Tightened here rather than at each consumer so a third consumer cannot
    // be added without it — the enumeration failure this codebase keeps reproducing.
    complete: !foreignBlocking && !unityUnexpanded && !noFirstParty && !poorlyCovered
      && !fileUncovered && fullyCovered && !censusRecalled,
    fullyCovered,
    censusFresh: disk.censusFresh !== false,
    reason,
    foreignToolchain: flags.foreignToolchain,
    unityUnexpanded,
    unity: flags.unity,
    firstPartyCount,
    firstPartySourcesOnDisk: diskSources,
    firstPartySourcesCovered: coveredOnDisk,
    firstPartyWalkCapped: disk.capped,
    coverageRatio,
    poorlyCovered,
    noFirstParty,
    fileUncovered,
  };
}

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
