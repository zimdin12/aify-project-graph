import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Default directory names excluded from both file walking (orchestrator) and
// special-node sweeping (sweep). Kept here so they stay in sync.
//
// Rules of thumb:
// - VCS / tool metadata: .git, .claude, .codex, .opencode, .vs, .vscode, .idea
// - Package / dep caches: node_modules, vendor, __pycache__, .venv, venv, env, .pytest_cache, .tox
// - Build output / generated: build, dist, out, target, .next, .nuxt, .svelte-kit
// - Runtime scratch: .tmp, tmp
// - Our own graph dir: .aify-graph
// - Coverage artefacts: coverage, .nyc_output
//
// Projects that legitimately keep code under one of these names can opt back
// in via `.aifyinclude` at the repo root (one dirname per line). Projects
// that want additional exclusions on top of the defaults can list them in
// `.aifyignore` (bare dir names plus a gitignore-style glob/path subset).
// Both files are optional.
export const IGNORED_DIRS = new Set([
  '.git', '.aify-graph', '.claude', '.codex', '.opencode',
  '.vs', '.vscode', '.idea',
  'node_modules', 'vendor',
  '__pycache__', '.pytest_cache', '.tox', '.venv', 'venv', 'env',
  'build', 'dist', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit',
  '.tmp', 'tmp', '.codex_tmp', 'worktrees',
  'coverage', '.nyc_output',
]);

const PREFIX_IGNORED_DIR_RULES = [
  { base: 'build', prefixes: ['build-', 'build_', 'cmake-build-'] },
  { base: 'dist', prefixes: ['dist-', 'dist_'] },
  { base: 'out', prefixes: ['out-', 'out_'] },
  { base: 'target', prefixes: ['target-', 'target_'] },
];

function parseDirList(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function normalizePattern(value) {
  return normalizeRepoRelativePath(value)
    .replace(/\/+$/u, '')
    .trim();
}

function isPathPattern(value) {
  return /[/*?[\]]/u.test(value);
}

function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out, 'u');
}

function getPathPatterns(ignoredDirs) {
  return Array.isArray(ignoredDirs?.pathPatterns) ? ignoredDirs.pathPatterns : [];
}

function pathMatchesPattern(path, pattern) {
  const normalizedPath = normalizeRepoRelativePath(path);
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedPath || !normalizedPattern) return false;

  if (!normalizedPattern.includes('/')) {
    return normalizedPath
      .split('/')
      .some((segment) => globToRegExp(normalizedPattern).test(segment));
  }

  if (normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`)) {
    return true;
  }
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

// Plan #17 F: parse a `.gitignore` for the same dir/path patterns we use
// for `.aifyignore`. Skips negation lines (`!pattern`) — we don't yet
// support gitignore's full re-include semantics, and dropping them is
// safer than misinterpreting. Skips lines that contain characters our
// glob translator does not support (`{`, `\\`).
function parseGitignoreFile(contents) {
  const lines = parseDirList(contents);
  const safe = [];
  for (const raw of lines) {
    if (raw.startsWith('!')) continue;        // gitignore re-include; not supported
    if (/[{\\]/.test(raw)) continue;          // glob alternations / escapes; not supported
    if (raw.startsWith('/')) safe.push(raw.replace(/^\/+/, '')); // anchored to repo root
    else safe.push(raw);
  }
  return safe;
}

// Returns the effective Set<dirName> for this repoRoot, applying optional
// .gitignore (Plan #17 F default), .aifyignore (add) and .aifyinclude
// (remove) overrides. Called once per ensureFresh; not cached — file-system
// reads are cheap vs. a full rebuild.
//
// Order of precedence: built-in IGNORED_DIRS < .gitignore < .aifyignore <
// .aifyinclude. Later layers override earlier ones. .gitignore is read by
// default; set `APG_IGNORE_GITIGNORE=1` to disable (zero-config-with-opt-out
// per codegraph's pattern). Negation lines and unsupported glob constructs
// in .gitignore are skipped, not failed.
export function loadEffectiveIgnoredDirs(repoRoot, { env = process.env, skipGitignore = false } = {}) {
  const effective = new Set(IGNORED_DIRS);
  const pathPatterns = [];

  // Review-fix (dev P1#1): when the caller already has `git ls-files
  // --exclude-standard` as the authoritative source (sweep.js with non-
  // null gitCandidates), skipping the manual .gitignore parser is
  // mandatory. The manual parser drops `!pattern` re-includes (it can't
  // express gitignore's full semantics) — so when it's mixed in as a
  // pre-filter, files git would explicitly include get pruned by the
  // parser before git's answer can rescue them. `skipGitignore: true`
  // turns the parser path off entirely. .aifyignore/.aifyinclude still
  // layer on top in both cases.
  if (env.APG_IGNORE_GITIGNORE !== '1' && !skipGitignore) {
    const gitignoreFile = safeRead(join(repoRoot, '.gitignore'));
    if (gitignoreFile) {
      for (const name of parseGitignoreFile(gitignoreFile)) {
        if (isPathPattern(name)) {
          pathPatterns.push(normalizePattern(name));
        } else {
          effective.add(name);
        }
      }
    }
  }

  const ignoreFile = safeRead(join(repoRoot, '.aifyignore'));
  if (ignoreFile) {
    for (const name of parseDirList(ignoreFile)) {
      if (isPathPattern(name)) {
        pathPatterns.push(normalizePattern(name));
      } else {
        effective.add(name);
      }
    }
  }

  const includeFile = safeRead(join(repoRoot, '.aifyinclude'));
  if (includeFile) {
    for (const name of parseDirList(includeFile)) {
      effective.delete(name);
      effective.add(`!${name}`);
    }
  }

  Object.defineProperty(effective, 'pathPatterns', {
    value: pathPatterns,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return effective;
}

// Returns true if either override file exists — used by the freshness layer
// to decide whether to bust the TTL cache so config edits apply immediately.
export function hasAifyOverrides(repoRoot) {
  return existsSync(join(repoRoot, '.aifyignore'))
    || existsSync(join(repoRoot, '.aifyinclude'));
}

export function normalizeRepoRelativePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '');
}

export function isIgnoredDirName(name, ignoredDirs = IGNORED_DIRS) {
  const normalized = String(name || '').trim();
  if (!normalized) return false;
  if (ignoredDirs.has(`!${normalized}`)) return false;
  if (ignoredDirs.has(normalized)) return true;

  if (getPathPatterns(ignoredDirs).some((pattern) => !pattern.includes('/') && pathMatchesPattern(normalized, pattern))) {
    return true;
  }

  return PREFIX_IGNORED_DIR_RULES.some(({ base, prefixes }) => (
    ignoredDirs.has(base) && prefixes.some((prefix) => normalized.startsWith(prefix))
  ));
}

export function pathContainsIgnoredDir(path, ignoredDirs = IGNORED_DIRS) {
  const normalized = normalizeRepoRelativePath(path);
  if (!normalized) return false;
  if (getPathPatterns(ignoredDirs).some((pattern) => pathMatchesPattern(normalized, pattern))) {
    return true;
  }
  const segments = normalized.split('/').filter(Boolean);
  // Built-in ignored-dir rules are for directory segments only. Applying them
  // to the final filename wrongly drops real sources like `target_rollup.js`
  // because the basename starts with an ignored build prefix.
  const dirSegments = normalized.endsWith('/')
    ? segments
    : normalized.includes('/')
      ? segments.slice(0, -1)
    : segments;
  return dirSegments.some((segment) => isIgnoredDirName(segment, ignoredDirs));
}
