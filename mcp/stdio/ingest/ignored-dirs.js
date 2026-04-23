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
// `.aifyignore` (same format). Both files are optional.
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
// Path patterns are NOT supported in v1 — each line is a bare directory
// name matched against `entry.name`. A few high-churn build roots also
// have built-in prefix rules (`build-*`, `build_*`, `cmake-build-*`,
// and the same for dist/out/target) so transient build trees do not
// pollute the graph by default. Exact opt-ins still work via `.aifyinclude`.
export function loadEffectiveIgnoredDirs(repoRoot) {
  const effective = new Set(IGNORED_DIRS);

  const ignoreFile = safeRead(join(repoRoot, '.aifyignore'));
  if (ignoreFile) {
    for (const name of parseDirList(ignoreFile)) effective.add(name);
  }

  const includeFile = safeRead(join(repoRoot, '.aifyinclude'));
  if (includeFile) {
    for (const name of parseDirList(includeFile)) {
      effective.delete(name);
      effective.add(`!${name}`);
    }
  }

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

  return PREFIX_IGNORED_DIR_RULES.some(({ base, prefixes }) => (
    ignoredDirs.has(base) && prefixes.some((prefix) => normalized.startsWith(prefix))
  ));
}

export function pathContainsIgnoredDir(path, ignoredDirs = IGNORED_DIRS) {
  const normalized = normalizeRepoRelativePath(path);
  if (!normalized) return false;
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment) => isIgnoredDirName(segment, ignoredDirs));
}
