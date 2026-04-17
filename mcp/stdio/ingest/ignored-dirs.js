// Shared list of directory names excluded from both file walking (orchestrator)
// and special-node sweeping (sweep). Kept here so they stay in sync.
//
// Rules of thumb:
// - VCS / tool metadata: .git, .claude, .vs, .vscode, .idea
// - Package / dep caches: node_modules, vendor, __pycache__, .venv, venv, env, .pytest_cache, .tox
// - Build output / generated: build, dist, out, target, .next, .nuxt, .svelte-kit
// - Our own graph dir: .aify-graph
// - Coverage artefacts: coverage, .nyc_output
//
// These are skipped regardless of depth — the directory name itself is
// sufficient to bail. Projects that genuinely need to include one of these
// should rename the directory or (future) opt in via an .aifyignore.
export const IGNORED_DIRS = new Set([
  '.git', '.aify-graph', '.claude',
  '.vs', '.vscode', '.idea',
  'node_modules', 'vendor',
  '__pycache__', '.pytest_cache', '.tox', '.venv', 'venv', 'env',
  'build', 'dist', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit',
  'coverage', '.nyc_output',
]);
