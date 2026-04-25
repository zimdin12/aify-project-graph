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

// Returns the effective Set<dirName> for this repoRoot, applying optional
// .aifyignore (add) and .aifyinclude (remove) overrides. Called once per
// ensureFresh; not cached — file-system reads are cheap vs. a full rebuild.
//
// Bare names match directory segments. Path/glob patterns such as
// `generated/**` or `*.tmp.cpp` match repo-relative paths. A few high-churn
// build roots also have built-in prefix rules (`build-*`, `build_*`,
// `cmake-build-*`, and the same for dist/out/target) so transient build
// trees do not pollute the graph by default. Exact opt-ins still work via
// `.aifyinclude`.
export function loadEffectiveIgnoredDirs(repoRoot) {
  const effective = new Set(IGNORED_DIRS);
  const pathPatterns = [];

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
