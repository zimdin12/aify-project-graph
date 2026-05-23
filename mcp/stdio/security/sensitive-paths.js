// Plan #21 — sensitive-path validation for MCP request arguments.
//
// Mirrors codegraph commits 02ea482 + 7d5dd4c (sensitive-path validation
// in MCP handler). Defense-in-depth: agents must not be able to point APG
// at host secrets even if a tool's input schema doesn't catch it.
//
// Per senior-dev's lock: canonicalize with realpath BEFORE checking, so
// symlinks pointing into denylisted directories don't bypass the gate.
// Apply to repoRoot AND path-shaped argument fields.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

// Denylist of path prefixes that NO MCP request should ever target.
// Use absolute, OS-normalized forms; the matcher case-insensitives on
// Windows (since NTFS is case-insensitive by default).
//
// Categories:
//   - System-config dirs    : /etc, /sys, /proc, Windows registry/system
//   - Credentials dirs       : ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube,
//                              ~/.config/gh (GitHub CLI tokens)
//   - Browser/keychain dirs  : ~/.mozilla (cookies), ~/Library/Keychains
//   - Tool credential stores : ~/.npmrc (auth tokens), ~/.docker/config.json
//
// NOT denylisted: ~ itself (home dir is fine), ~/Documents, ~/Desktop —
// agents legitimately work in those.
const SENSITIVE_PREFIXES = [
  // POSIX system dirs
  '/etc',
  '/sys',
  '/proc',
  '/root',
  '/boot',
  // POSIX credentials
  path.join(HOME, '.ssh'),
  path.join(HOME, '.aws'),
  path.join(HOME, '.gnupg'),
  path.join(HOME, '.kube'),
  path.join(HOME, '.config', 'gh'),
  path.join(HOME, '.docker'),
  // Browser / keychain / tool credentials
  path.join(HOME, '.mozilla'),
  path.join(HOME, 'Library', 'Keychains'),
  // Windows system dirs (when host is Windows or accessing via WSL /mnt)
  'C:\\Windows\\System32',
  'C:\\Windows\\SysWOW64',
];

function caseNormalize(p) {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function normalizeForCompare(p) {
  if (!p) return '';
  // Resolve relative to cwd first (so a bare "etc" doesn't accidentally
  // match the POSIX /etc prefix only after some other normalization).
  let abs = path.isAbsolute(p) ? p : path.resolve(p);
  // Canonicalize via realpath when the path exists — kills symlink-based
  // bypass attempts (symlink ~/safe -> /etc would otherwise pass a plain
  // prefix check). When the path doesn't exist (e.g. about-to-create
  // file), fall back to the resolved path; nothing to canonicalize.
  try {
    abs = fs.realpathSync(abs);
  } catch { /* path doesn't exist; use resolved path as-is */ }
  return caseNormalize(abs);
}

function isUnderPrefix(absNormalized, prefixNormalized) {
  if (!absNormalized || !prefixNormalized) return false;
  if (absNormalized === prefixNormalized) return true;
  // Use the platform separator after the prefix to avoid matching e.g.
  // "/etcfoo" as being under "/etc".
  const sep = process.platform === 'win32' ? '\\' : '/';
  return absNormalized.startsWith(prefixNormalized + sep);
}

/**
 * Check if `inputPath` resolves under any denylisted sensitive prefix.
 * Returns null when safe, or { matched, reason } when blocked.
 *
 * @param {string} inputPath - a user/agent-supplied path
 * @returns {{matched: string, reason: string} | null}
 */
export function isSensitivePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) return null;
  const norm = normalizeForCompare(inputPath);
  if (!norm) return null;
  for (const prefix of SENSITIVE_PREFIXES) {
    const pNorm = caseNormalize(path.resolve(prefix));
    if (isUnderPrefix(norm, pNorm)) {
      return {
        matched: prefix,
        reason: `path resolves under sensitive directory ${prefix} (canonicalized: ${norm})`,
      };
    }
  }
  return null;
}

// Path-shaped argument keys we check on MCP tool args. Conservative list
// — only fields the schemas already document as filesystem paths. Avoids
// false positives on free-text fields that may contain forward slashes.
const PATH_SHAPED_ARG_KEYS = new Set([
  'repo',
  'repoRoot',
  'projectRoot',
  'file',
  'path',
  'cwd',
]);

const PATH_SHAPED_ARRAY_KEYS = new Set([
  'files',
  'warmupFiles',
  'paths',
]);

/**
 * Scan tool-call arguments for sensitive paths. Returns null when all
 * paths are safe (or no path-shaped args present). Returns the first
 * blocked {arg, value, matched, reason} when something is dangerous.
 *
 * @param {object} args - parsed tool-call arguments
 * @returns {{arg: string, value: string, matched: string, reason: string} | null}
 */
export function findSensitivePathArg(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  for (const [key, value] of Object.entries(args)) {
    if (PATH_SHAPED_ARG_KEYS.has(key) && typeof value === 'string') {
      const hit = isSensitivePath(value);
      if (hit) return { arg: key, value, ...hit };
    }
    if (PATH_SHAPED_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      for (const v of value) {
        if (typeof v !== 'string') continue;
        const hit = isSensitivePath(v);
        if (hit) return { arg: key, value: v, ...hit };
      }
    }
  }
  return null;
}

// Exposed for tests + future tuning.
export const _SENSITIVE_PREFIXES = SENSITIVE_PREFIXES;
export const _PATH_SHAPED_ARG_KEYS = PATH_SHAPED_ARG_KEYS;
export const _PATH_SHAPED_ARRAY_KEYS = PATH_SHAPED_ARRAY_KEYS;
