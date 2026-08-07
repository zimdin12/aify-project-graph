# Graph Freshness (v0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make graph freshness happen without anyone choosing it — driven by the git events that cause staleness, with a fail-closed report when the mechanism breaks.

**Architecture:** Git already knows when HEAD moves, which is what makes the graph stale. So four git hooks (`post-commit`, `post-merge`, `post-checkout`, `post-rewrite`) run the same backgrounded incremental reindex, off the critical path of any query, once per repo regardless of how many agent processes exist. Each run writes an outcome breadcrumb; `graph_health` reads it and reports **degraded** when the last attempt failed. No daemon, no leader election, no change to the MCP process model.

**Tech Stack:** Node ESM (`.mjs` scripts, `.js` modules), vitest, POSIX `sh` hook bodies, `node:fs`.

## Global Constraints

- Hook bodies must be pure-LF POSIX `sh`. `sh` rejects CRLF. The existing `stripAifyBlock` already normalises CRLF→LF; preserve that.
- A reindex failure must NEVER fail a git operation. `scripts/reindex.mjs` already exits 0 on error; keep that guarantee for every new hook.
- All four hooks share ONE marker constant, `AIFY_HOOK_MARKER` (value: `aify-project-graph post-commit reindex`). Do not introduce a second marker string — `stripAifyBlock` keys on it for idempotency, and a mismatched marker silently duplicates blocks.
- Every new test must be verified to FAIL with the change reverted. The v0.4.0 record contains two tests that asserted the buggy invariant they were meant to catch; step "run it and watch it fail" is not optional.
- `graph_health` distinguishes three states: hooks absent = **unconfigured** (advisory), hooks present + last refresh failed = **degraded**, hooks present + no breadcrumb = **degraded**. Never report an un-hooked repo as degraded.
- Windows: `chmodSync` is a no-op and must stay wrapped in try/catch. Tests run on win32.

---

### Task 1: Extend the hook installer to all four HEAD-moving events

**Files:**
- Modify: `scripts/install-graph-hook.mjs` (whole file — `aifyBlock`, `installGraphHook`, CLI entry)
- Test: `tests/unit/scripts/install-graph-hook.test.js` (existing file, add cases)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `installGraphHook(targetRepoRoot?: string, reindexPath?: string) => string[]` — **note the return type changes from `string` to `string[]`** (one path per installed hook). `AIFY_HOOK_MARKER` and `AIFY_HOOKS` (a `string[]` of the four hook names) are exported.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/scripts/install-graph-hook.test.js`:

```js
import { installGraphHook, AIFY_HOOK_MARKER, AIFY_HOOKS } from '../../../scripts/install-graph-hook.mjs';

it('installs all four HEAD-moving hooks', () => {
  const paths = installGraphHook(repo);
  expect(AIFY_HOOKS).toEqual(['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']);
  expect(paths).toHaveLength(4);
  for (const hook of AIFY_HOOKS) {
    const p = join(repo, '.git', 'hooks', hook);
    expect(existsSync(p), `${hook} exists`).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain(AIFY_HOOK_MARKER);
  }
});

it('post-checkout only reindexes on BRANCH checkout, not file checkout', () => {
  // git passes $3 = 1 for a branch checkout, 0 for a file checkout. Without
  // this guard, `git checkout -- somefile` triggers a full reindex.
  installGraphHook(repo);
  const body = readFileSync(join(repo, '.git', 'hooks', 'post-checkout'), 'utf8');
  expect(body).toContain('[ "$3" = "1" ]');
});

it('the other three hooks do NOT carry the branch-checkout guard', () => {
  installGraphHook(repo);
  for (const hook of ['post-commit', 'post-merge', 'post-rewrite']) {
    const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
    expect(body, `${hook} unguarded`).not.toContain('[ "$3" = "1" ]');
  }
});

it('is idempotent across all four hooks', () => {
  installGraphHook(repo); installGraphHook(repo);
  for (const hook of AIFY_HOOKS) {
    const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
    expect(body.split(AIFY_HOOK_MARKER).length - 1, `${hook} single block`).toBe(2);
  }
});

it('preserves pre-existing unrelated content in every hook', () => {
  for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']) {
    writeFileSync(join(repo, '.git', 'hooks', hook), `#!/bin/sh\necho keep-${hook}\n`);
  }
  installGraphHook(repo);
  for (const hook of AIFY_HOOKS) {
    const body = readFileSync(join(repo, '.git', 'hooks', hook), 'utf8');
    expect(body).toContain(`echo keep-${hook}`);
    expect(body).toContain(AIFY_HOOK_MARKER);
  }
});

it('hook bodies are pure LF — sh rejects CRLF', () => {
  installGraphHook(repo);
  for (const hook of AIFY_HOOKS) {
    expect(readFileSync(join(repo, '.git', 'hooks', hook), 'utf8')).not.toContain('\r');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scripts/install-graph-hook.test.js`
Expected: FAIL — `AIFY_HOOKS` is not exported (`undefined`), and only `post-commit` is written.

- [ ] **Step 3: Write minimal implementation**

Replace `aifyBlock`, `installGraphHook`, and the CLI entry in `scripts/install-graph-hook.mjs`:

```js
// Every git event that can move HEAD. post-commit alone misses the ways HEAD
// moves that are not a local commit — which is how a repo reaches 20 commits
// stale while the hook is installed and working exactly as designed.
export const AIFY_HOOKS = ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite'];

function aifyBlock(reindexPath, hook) {
  const invoke = `node "${reindexPath}" "$(git rev-parse --show-toplevel)" "${hook}" >/dev/null 2>&1 &`;
  const lines = [
    `# >>> ${AIFY_HOOK_MARKER} >>>`,
    '# Auto-refresh the code graph when HEAD moves (best-effort, backgrounded).',
  ];
  if (hook === 'post-checkout') {
    // git passes $3=1 for a branch checkout, $3=0 for a file checkout.
    // Without this, `git checkout -- file` triggers a full reindex.
    lines.push('if [ "$3" = "1" ]; then');
    lines.push(`  ${invoke}`);
    lines.push('fi');
  } else {
    lines.push(invoke);
  }
  lines.push(`# <<< ${AIFY_HOOK_MARKER} <<<`);
  return lines.join('\n');
}

export function installGraphHook(targetRepoRoot = process.cwd(), reindexPath = REINDEX) {
  const hooksDir = join(targetRepoRoot, '.git', 'hooks');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const written = [];
  for (const hook of AIFY_HOOKS) {
    const hookPath = join(hooksDir, hook);
    let body = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '#!/bin/sh\n';
    body = stripAifyBlock(body).replace(/\n+$/, '') + '\n';
    if (!body.startsWith('#!')) body = '#!/bin/sh\n' + body;
    body += '\n' + aifyBlock(reindexPath, hook) + '\n';
    writeFileSync(hookPath, body, 'utf8');
    try { chmodSync(hookPath, 0o755); } catch { /* windows: chmod is a noop */ }
    written.push(hookPath);
  }
  return written;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2] || process.cwd();
  const paths = installGraphHook(target);
  console.log(`Installed ${paths.length} aify reindex hooks:`);
  for (const p of paths) console.log(`  ${p}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scripts/install-graph-hook.test.js`
Expected: PASS (all cases, including the three pre-existing ones).

- [ ] **Step 5: Check the other caller of installGraphHook still works**

The return type changed from `string` to `string[]`.

Run: `npx vitest run tests/integration/install-hooks.test.js`
Expected: PASS. If it fails on the return type, update that call site to handle an array — do not revert the signature.

- [ ] **Step 6: Commit**

```bash
git add scripts/install-graph-hook.mjs tests/unit/scripts/install-graph-hook.test.js
git commit -m "feat(hooks): reindex on every git event that moves HEAD, not just commit"
```

---

### Task 2: Write a refresh breadcrumb instead of discarding the outcome

**Files:**
- Create: `mcp/stdio/freshness/refresh-breadcrumb.js`
- Modify: `scripts/reindex.mjs` (whole file, 10 lines)
- Test: `tests/unit/freshness/refresh-breadcrumb.test.js`

**Interfaces:**
- Consumes: `AIFY_HOOKS` from Task 1 (only as the set of valid `trigger` values).
- Produces:
  - `writeRefreshBreadcrumb(repoRoot: string, entry: { trigger: string, from: string|null, to: string|null, status: 'ok'|'failed', error?: string }) => void`
  - `readRefreshBreadcrumb(repoRoot: string) => object|null` — returns `null` when absent or unparseable.
  - `BREADCRUMB_FILE = 'last-refresh.json'` (inside `.aify-graph/`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/freshness/refresh-breadcrumb.test.js`:

```js
// The hook body ends `>/dev/null 2>&1 &` — it discards every error. A reindex
// that fails leaves the graph stale with nobody informed, which is the silent-
// failure class v0.4.0 spent 137 commits eliminating. A refresh mechanism that
// can quietly stop working is worse than none, because its presence becomes the
// reason not to check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRefreshBreadcrumb, readRefreshBreadcrumb, BREADCRUMB_FILE } from '../../../mcp/stdio/freshness/refresh-breadcrumb.js';

describe('refresh breadcrumb', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-crumb-'));
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('records a successful refresh with its trigger and commit transition', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-merge', from: '88085d5', to: '0b090ea', status: 'ok' });
    const got = readRefreshBreadcrumb(repo);
    expect(got.trigger).toBe('post-merge');
    expect(got.from).toBe('88085d5');
    expect(got.to).toBe('0b090ea');
    expect(got.status).toBe('ok');
    expect(typeof got.at).toBe('string');
    expect(Number.isNaN(Date.parse(got.at))).toBe(false);
  });

  it('records a FAILED refresh with the error text', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'failed', error: 'ENOSPC: no space left' });
    const got = readRefreshBreadcrumb(repo);
    expect(got.status).toBe('failed');
    expect(got.error).toContain('ENOSPC');
  });

  it('returns null when no breadcrumb exists', () => {
    expect(readRefreshBreadcrumb(repo)).toBeNull();
  });

  it('returns null on a corrupt breadcrumb rather than throwing', () => {
    // A half-written file must not take down every graph_health call.
    writeFileSync(join(repo, '.aify-graph', BREADCRUMB_FILE), '{not json');
    expect(readRefreshBreadcrumb(repo)).toBeNull();
  });

  it('writing never throws, even when .aify-graph is missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'apg-bare-'));
    expect(() => writeRefreshBreadcrumb(bare, { trigger: 'post-commit', from: null, to: null, status: 'ok' })).not.toThrow();
    try { rmSync(bare, { recursive: true, force: true }); } catch {}
  });

  it('truncates a huge error so the breadcrumb stays small', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'failed', error: 'x'.repeat(5000) });
    expect(readRefreshBreadcrumb(repo).error.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/freshness/refresh-breadcrumb.test.js`
Expected: FAIL — cannot resolve `mcp/stdio/freshness/refresh-breadcrumb.js`.

- [ ] **Step 3: Write minimal implementation**

Create `mcp/stdio/freshness/refresh-breadcrumb.js`:

```js
// WHAT HAPPENED THE LAST TIME SOMETHING TRIED TO REFRESH THIS GRAPH.
//
// The git hooks run backgrounded with `>/dev/null 2>&1` — they must never fail
// a git operation, so they cannot report through the exit code, and their output
// goes nowhere. Without a breadcrumb, a refresh mechanism that has silently
// stopped working is indistinguishable from one that is working, and its mere
// presence becomes the reason nobody checks.
//
// Deliberately a plain file, not a table in graph.sqlite: it must be writable by
// a hook that runs while an MCP server holds the DB, and readable when the DB is
// mid-rebuild.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const BREADCRUMB_FILE = 'last-refresh.json';
const MAX_ERROR_CHARS = 500;

function breadcrumbPath(repoRoot) {
  return join(repoRoot, '.aify-graph', BREADCRUMB_FILE);
}

/** Best-effort: a breadcrumb failure must never be louder than the thing it records. */
export function writeRefreshBreadcrumb(repoRoot, entry) {
  try {
    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
    const body = {
      at: new Date().toISOString(),
      trigger: entry.trigger ?? null,
      from: entry.from ?? null,
      to: entry.to ?? null,
      status: entry.status === 'failed' ? 'failed' : 'ok',
      ...(entry.error ? { error: String(entry.error).slice(0, MAX_ERROR_CHARS) } : {}),
    };
    writeFileSync(breadcrumbPath(repoRoot), JSON.stringify(body, null, 2) + '\n', 'utf8');
  } catch { /* a hook must never fail a git operation */ }
}

/** null when absent OR unparseable — a corrupt breadcrumb is treated as no breadcrumb. */
export function readRefreshBreadcrumb(repoRoot) {
  try {
    const parsed = JSON.parse(readFileSync(breadcrumbPath(repoRoot), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/freshness/refresh-breadcrumb.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire reindex.mjs to write the breadcrumb**

Replace `scripts/reindex.mjs` entirely:

```js
// scripts/reindex.mjs — incremental reindex entry for the aify git hooks.
// Usage: node scripts/reindex.mjs <repoRoot> [trigger]
// Best-effort: never throws out and always exits 0 — a reindex failure must
// never fail a git operation. The outcome goes to the breadcrumb instead, which
// is the only channel a backgrounded `>/dev/null 2>&1` hook has left.
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
import { writeRefreshBreadcrumb } from '../mcp/stdio/freshness/refresh-breadcrumb.js';
import { readRefreshBreadcrumb } from '../mcp/stdio/freshness/refresh-breadcrumb.js';

const repoRoot = process.argv[2] || process.cwd();
const trigger = process.argv[3] || 'manual';

function head() {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { return null; }
}

// `from` is where the graph was BEFORE this refresh, which is the previous
// breadcrumb's `to` when we have one — not the current HEAD, which has already moved.
const from = readRefreshBreadcrumb(repoRoot)?.to ?? null;

ensureFresh({ repoRoot }).then(
  (r) => {
    writeRefreshBreadcrumb(repoRoot, { trigger, from, to: head(), status: 'ok' });
    console.log(`[aify-project-graph] reindexed ${repoRoot}: ${r?.nodes ?? '?'} nodes`);
  },
  (e) => {
    writeRefreshBreadcrumb(repoRoot, { trigger, from, to: head(), status: 'failed', error: e?.message ?? String(e) });
    console.error(`[aify-project-graph] reindex failed: ${e?.message ?? e}`);
    process.exit(0);
  },
);
```

- [ ] **Step 6: Run the whole freshness suite**

Run: `npx vitest run tests/unit/freshness/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mcp/stdio/freshness/refresh-breadcrumb.js scripts/reindex.mjs tests/unit/freshness/refresh-breadcrumb.test.js
git commit -m "feat(freshness): record refresh outcomes instead of discarding them"
```

---

### Task 3: graph_health reports a dead refresh mechanism as degraded

**Files:**
- Create: `mcp/stdio/freshness/refresh-verdict.js`
- Modify: `mcp/stdio/query/verbs/health.js` (import at top; verdict near line 487 where `stale`/`fresh` is pushed; add `refreshMechanism` to the returned object next to `artifactAges`)
- Test: `tests/unit/query/refresh-mechanism-verdict.test.js`

**Interfaces:**
- Consumes: `readRefreshBreadcrumb` from Task 2; `AIFY_HOOKS`, `AIFY_HOOK_MARKER` from Task 1.
- Produces: `refreshMechanismVerdict(repoRoot: string) => { state: 'ok'|'degraded'|'unconfigured'|'not_a_git_repo', hooks_installed: number, hooks_expected: number, last_refresh: object|null, consequence: string, remedy: string|null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/query/refresh-mechanism-verdict.test.js`:

```js
// An un-hooked repo is UNCONFIGURED, not degraded. Fail-closed applies to a
// mechanism that is supposed to be running, because silence from it cannot be
// told apart from success. A mechanism never enabled is a known state — and
// marking every un-hooked repo degraded would make the signal worthless in the
// repos that later install hooks and need it to mean something.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshMechanismVerdict } from '../../../mcp/stdio/freshness/refresh-verdict.js';
import { installGraphHook } from '../../../scripts/install-graph-hook.mjs';
import { writeRefreshBreadcrumb } from '../../../mcp/stdio/freshness/refresh-breadcrumb.js';

describe('refresh mechanism verdict', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-refresh-'));
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('no hooks installed → unconfigured, with the install command', () => {
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('unconfigured');
    expect(v.hooks_installed).toBe(0);
    expect(v.remedy).toContain('install-graph-hook');
  });

  it('hooks installed + last refresh ok → ok', () => {
    installGraphHook(repo);
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'ok' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('ok');
    expect(v.hooks_installed).toBe(4);
    expect(v.remedy).toBeNull();
  });

  it('★ hooks installed + last refresh FAILED → degraded, naming the error', () => {
    installGraphHook(repo);
    writeRefreshBreadcrumb(repo, { trigger: 'post-merge', from: 'a', to: 'b', status: 'failed', error: 'ENOSPC: no space left' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.consequence).toMatch(/ENOSPC/);
    expect(v.remedy).toBeTruthy();
  });

  it('★ hooks installed + NO breadcrumb → degraded (fail-closed)', () => {
    // The silently-dead-hook case: installed, never observed to run. Unknown is
    // not healthy.
    installGraphHook(repo);
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.consequence).toMatch(/never observed|no refresh has been recorded/i);
  });

  it('partial install (some hooks missing) → degraded', () => {
    installGraphHook(repo);
    rmSync(join(repo, '.git', 'hooks', 'post-merge'));
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'ok' });
    const v = refreshMechanismVerdict(repo);
    expect(v.state).toBe('degraded');
    expect(v.hooks_installed).toBe(3);
    expect(v.hooks_expected).toBe(4);
  });

  it('not a git repo → not_a_git_repo, not degraded', () => {
    const bare = mkdtempSync(join(tmpdir(), 'apg-nogit-'));
    mkdirSync(join(bare, '.aify-graph'), { recursive: true });
    expect(refreshMechanismVerdict(bare).state).toBe('not_a_git_repo');
    try { rmSync(bare, { recursive: true, force: true }); } catch {}
  });

  it('a foreign post-commit hook does not count as installed', () => {
    // Someone else's hook in the right place is not our mechanism.
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho unrelated\n');
    expect(refreshMechanismVerdict(repo).hooks_installed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/refresh-mechanism-verdict.test.js`
Expected: FAIL — cannot resolve `mcp/stdio/freshness/refresh-verdict.js`.

- [ ] **Step 3: Write minimal implementation**

Create `mcp/stdio/freshness/refresh-verdict.js`:

```js
// IS ANYTHING ACTUALLY KEEPING THIS GRAPH CURRENT?
//
// Measured 2026-08-07: sand_castle 20 commits stale, aify-project-graph 130.
// Neither was an indexing bug — the refresh hooks were simply never installed,
// and nothing reported that. The mechanism's own absence was invisible.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIFY_HOOKS, AIFY_HOOK_MARKER } from '../../../scripts/install-graph-hook.mjs';
import { readRefreshBreadcrumb } from './refresh-breadcrumb.js';

const INSTALL_CMD = 'node <apg>/scripts/install-graph-hook.mjs <repoRoot>';

function installedHookCount(repoRoot) {
  let n = 0;
  for (const hook of AIFY_HOOKS) {
    const p = join(repoRoot, '.git', 'hooks', hook);
    if (!existsSync(p)) continue;
    try {
      // A foreign hook at the same path is not our mechanism.
      if (readFileSync(p, 'utf8').includes(AIFY_HOOK_MARKER)) n += 1;
    } catch { /* unreadable == not installed */ }
  }
  return n;
}

export function refreshMechanismVerdict(repoRoot) {
  if (!existsSync(join(repoRoot, '.git'))) {
    return {
      state: 'not_a_git_repo',
      hooks_installed: 0,
      hooks_expected: AIFY_HOOKS.length,
      last_refresh: null,
      consequence: 'No git repository here, so no HEAD to track. Freshness is whatever graph_index last produced.',
      remedy: null,
    };
  }

  const installed = installedHookCount(repoRoot);
  const last = readRefreshBreadcrumb(repoRoot);
  const base = { hooks_installed: installed, hooks_expected: AIFY_HOOKS.length, last_refresh: last };

  if (installed === 0) {
    return {
      ...base,
      state: 'unconfigured',
      consequence:
        'Nothing refreshes this graph when HEAD moves. It will drift behind the repo silently, '
        + 'and a "not found" will increasingly mean "not indexed yet" rather than "absent". '
        + 'This is not a failure — it was never enabled.',
      remedy: `install the refresh hooks: ${INSTALL_CMD}`,
    };
  }

  if (installed < AIFY_HOOKS.length) {
    return {
      ...base,
      state: 'degraded',
      consequence:
        `Only ${installed} of ${AIFY_HOOKS.length} refresh hooks are installed, so some ways HEAD moves `
        + '(pull, branch switch, rebase) do NOT trigger a refresh. Staleness will appear intermittently '
        + 'and look like a different bug each time.',
      remedy: `re-run the installer to restore all four: ${INSTALL_CMD}`,
    };
  }

  if (!last) {
    return {
      ...base,
      state: 'degraded',
      consequence:
        'The refresh hooks are installed but no refresh has been recorded — the mechanism has never been '
        + 'observed to run. Unknown is not healthy: a hook that silently fails to execute looks exactly '
        + 'like one that has simply not been needed yet.',
      remedy: 'make a commit, then re-run graph_health; if still absent, run the hook body manually to see its error.',
    };
  }

  if (last.status === 'failed') {
    return {
      ...base,
      state: 'degraded',
      consequence:
        `The last refresh FAILED (${last.trigger ?? 'unknown trigger'} at ${last.at}): ${last.error ?? 'no error recorded'}. `
        + 'The graph has been drifting since then, and the hooks will keep failing the same way.',
      remedy: 'fix the underlying error, then run graph_index() to catch up.',
    };
  }

  return {
    ...base,
    state: 'ok',
    consequence: `Last refresh ${last.status} via ${last.trigger ?? 'unknown'} at ${last.at}.`,
    remedy: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/query/refresh-mechanism-verdict.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Surface it in graph_health**

In `mcp/stdio/query/verbs/health.js`, add near the other imports at the top:

```js
import { refreshMechanismVerdict } from '../../freshness/refresh-verdict.js';
```

Immediately after the existing stale/fresh verdict push (around line 487–488, the lines reading `if (stale) verdicts.push(...)` / `else verdicts.push('fresh')`), add:

```js
  // A stale snapshot is a fact; a dead refresh mechanism is why it will STAY
  // stale. Report the second next to the first, because the first is what a
  // reader notices and the second is what they can act on.
  const refreshMechanism = refreshMechanismVerdict(repoRoot);
  if (refreshMechanism.state === 'degraded') {
    verdicts.push(`⛔ refresh mechanism DEGRADED: ${refreshMechanism.consequence}`);
  } else if (refreshMechanism.state === 'unconfigured') {
    verdicts.push(`⚠ no auto-refresh: ${refreshMechanism.remedy}`);
  }
```

Then add `refreshMechanism` to the returned object, immediately after the existing `artifactAges` property:

```js
    refreshMechanism,
```

- [ ] **Step 6: Verify it appears in a real graph_health call**

Run:
```bash
node -e "
const {execFileSync}=require('child_process');
const m=[JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'t',version:'1'}}}),
JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'graph_health',arguments:{repo:process.cwd()}}})];
const out=execFileSync('node',['mcp/stdio/server.js'],{input:m.join('\n')+'\n',encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
for(const l of out.split('\n')){if(!l.startsWith('{'))continue;const j=JSON.parse(l);if(j.id!==2)continue;
const o=JSON.parse(j.result.content[0].text);
console.log('state:', o.refreshMechanism.state, '| hooks:', o.refreshMechanism.hooks_installed+'/'+o.refreshMechanism.hooks_expected);}"
```
Expected: `state: unconfigured | hooks: 0/4` — this repo has no hooks installed yet, which is the whole point.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS. If `tests/unit/query/tool-listing-contract.test.js` or `server-instructions.test.js` fail, they are asserting a contract you changed — read them before editing; they encode prior defects.

- [ ] **Step 8: Commit**

```bash
git add mcp/stdio/freshness/refresh-verdict.js mcp/stdio/query/verbs/health.js tests/unit/query/refresh-mechanism-verdict.test.js
git commit -m "feat(health): a dead refresh mechanism now reports degraded, not silence"
```

---

### Task 4: Make hook installation part of documented setup

**Files:**
- Modify: `README.md` (the numbered install procedure, currently steps 1–5 around line 325)
- Modify: `install.hermes.md`, `install.codex.md`, `install.cursor.md`, `install.opencode.md`
- Modify: `mcp/stdio/server-instructions.js` (FRESHNESS section, around line 86)
- Test: `tests/unit/integrations/refresh-docs-parity.test.js`

**Interfaces:**
- Consumes: `AIFY_HOOKS` from Task 1 (to assert the docs name the right count).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/integrations/refresh-docs-parity.test.js`:

```js
// The installer existed since before v0.3.0 and nothing told anyone to run it.
// Two repos reached 20 and 130 commits stale with the fix sitting unused in the
// same tree. A mechanism nobody is told about is equivalent to one that does not
// exist, so the docs naming it are part of the mechanism.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIFY_HOOKS } from '../../../scripts/install-graph-hook.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const DOCS = ['README.md', 'install.hermes.md', 'install.codex.md', 'install.cursor.md', 'install.opencode.md'];

describe('refresh hooks are documented as setup', () => {
  for (const doc of DOCS) {
    it(`${doc} tells the reader to install the refresh hooks`, () => {
      const text = readFileSync(join(REPO, doc), 'utf8');
      expect(text, `${doc} names the installer`).toMatch(/install-graph-hook\.mjs/);
    });
  }

  it('the docs state hooks are per-clone and not carried by git clone', () => {
    // The single most likely wrong assumption: that cloning brings the hooks.
    const text = readFileSync(join(REPO, 'README.md'), 'utf8');
    expect(text).toMatch(/not (carried|copied) by .?git clone|per-clone|per-machine/i);
  });

  it('server-instructions names the refresh mechanism in its FRESHNESS section', () => {
    const text = readFileSync(join(REPO, 'mcp', 'stdio', 'server-instructions.js'), 'utf8');
    expect(text).toMatch(/refreshMechanism/);
  });

  it('no doc claims a hook count that disagrees with AIFY_HOOKS', () => {
    // Same drift class as the verb counts: a hand-written number restated in
    // five files, wrong in three of them.
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      const m = text.match(/(\d+) (?:git )?refresh hooks/);
      if (m) expect(Number(m[1]), `${doc} hook count`).toBe(AIFY_HOOKS.length);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/integrations/refresh-docs-parity.test.js`
Expected: FAIL — no doc mentions `install-graph-hook.mjs`.

- [ ] **Step 3: Add the install step to README.md**

In the numbered install procedure, insert as a new step after the skills-copy step:

```markdown
5. **Installs the refresh hooks** (per clone — `git clone` does NOT carry hooks, so this is per-machine setup):

   ```bash
   node <CLONE_PATH>/scripts/install-graph-hook.mjs <targetRepoRoot>
   ```

   Installs 4 refresh hooks — `post-commit`, `post-merge`, `post-checkout`, `post-rewrite` — each running a backgrounded incremental reindex when HEAD moves. Without this, keeping the graph current is nobody's job: two repos measured 2026-08-07 had drifted 20 and 130 commits behind with nobody aware. `graph_health` reports `refreshMechanism.state` so you can tell whether it is actually running.
```

Renumber the following step ("User restarts the runtime") accordingly.

- [ ] **Step 4: Add the same step to each install.*.md**

Append to `install.hermes.md`, `install.codex.md`, `install.cursor.md`, `install.opencode.md` after their skills step:

```markdown
### Install the refresh hooks

Hooks are per-clone and are NOT carried by `git clone` — install them in each repo you work in, on each machine:

```bash
node "$CLONE_PATH/scripts/install-graph-hook.mjs" /path/to/your/repo
```

Verify with `graph_health` → `refreshMechanism.state` should read `ok` after your next commit. `unconfigured` means the hooks are absent; `degraded` means they are installed but the last refresh failed or has never run.
```

- [ ] **Step 5: Update the FRESHNESS section of server-instructions.js**

Replace the first line of the `FRESHNESS:` block (around line 87) with:

```
- If a response says "graph stale", run graph_index first. Check graph_health.refreshMechanism: `unconfigured` means no hook refreshes this repo (install-graph-hook.mjs); `degraded` means the mechanism is installed but failing, so staleness will RECUR until fixed.
```

Keep the remaining FRESHNESS lines unchanged.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/integrations/refresh-docs-parity.test.js tests/unit/server-instructions.test.js`
Expected: PASS. The second guards an ≤84-line budget on `SERVER_INSTRUCTIONS`; if it fails, shorten the line you added rather than raising the budget — that surface is billed to every session.

- [ ] **Step 7: Commit**

```bash
git add README.md install.*.md mcp/stdio/server-instructions.js tests/unit/integrations/refresh-docs-parity.test.js
git commit -m "docs(freshness): hook installation is setup, not an undocumented script"
```

---

### Task 5: Demote auto-reindex to a documented fallback

**Files:**
- Modify: `mcp/stdio/server.js` (the `FRESH_PARAM` description block, around line 744)
- Modify: `docs/known-limitations.md`
- Test: `tests/unit/query/fresh-per-call.test.js` (existing file, add one case)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/query/fresh-per-call.test.js`:

```js
it('names the hook mechanism as the primary path, not this one', () => {
  // APG_AUTO_REINDEX and fresh:true both fix staleness ON THE READ PATH, which
  // means blocking. The hooks fix it BEFORE the read. A reader choosing between
  // them needs to know one of them is the fallback.
  expect(src, 'points at the hooks').toMatch(/install-graph-hook|refresh hook/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/fresh-per-call.test.js`
Expected: FAIL — `FRESH_PARAM` does not mention the hooks.

- [ ] **Step 3: Extend the FRESH_PARAM description**

In `mcp/stdio/server.js`, append one sentence to the `FRESH_PARAM` description string (keep it short — this object is inlined into 10 verbs' schemas and every sentence is billed ten times per session):

```js
    + 'COST: seconds to minutes on a large repo. Prefer the refresh hooks (install-graph-hook.mjs), '
    + 'which refresh when HEAD moves instead of when you ask.',
```

replacing the existing trailing `'COST: seconds to minutes on a large repo.',` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/query/fresh-per-call.test.js`
Expected: PASS.

- [ ] **Step 5: Record the fallback status in known-limitations.md**

Append a section:

```markdown
## Auto-reindex is a fallback, not the primary freshness mechanism

`APG_AUTO_REINDEX=1` and per-call `fresh:true` both refresh **on the read path**:
a stale read blocks until the index finishes, and behind any in-flight index too.
The cross-process retry budget is ~3 minutes, which a first index on a large C++
repo can exceed.

The primary mechanism is the git refresh hooks (`scripts/install-graph-hook.mjs`),
which refresh when HEAD moves — off the critical path of any query, once per repo
regardless of how many agent processes are running.

Auto-reindex remains correct and coordinated (one process indexes, the rest
no-op), and is the right tool for two cases the hooks cannot cover:
uncommitted working-tree changes, and repos where hooks are not installed.
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 1587+ tests.

- [ ] **Step 7: Commit**

```bash
git add mcp/stdio/server.js docs/known-limitations.md tests/unit/query/fresh-per-call.test.js
git commit -m "docs(freshness): auto-reindex is the fallback; hooks are the primary path"
```

---

### Task 6: End-to-end verification against a real git repo

**Files:**
- Test: `tests/integration/refresh-hooks-e2e.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/refresh-hooks-e2e.test.js`:

```js
// The unit tests assert the hook FILES contain the right text. This asserts git
// actually RUNS them and the breadcrumb actually lands — the gap between "the
// installer wrote a file" and "the mechanism works" is where this whole class of
// bug lives.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGraphHook } from '../../scripts/install-graph-hook.mjs';
import { readRefreshBreadcrumb } from '../../mcp/stdio/freshness/refresh-breadcrumb.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });

async function waitForBreadcrumb(repo, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = readRefreshBreadcrumb(repo);
    if (c) return c;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

describe('refresh hooks end-to-end', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-e2e-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.js'), 'export function a() { return 1; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('★ a real commit triggers a real reindex and records the breadcrumb', async () => {
    installGraphHook(repo);
    writeFileSync(join(repo, 'b.js'), 'export function b() { return 2; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'second');

    const crumb = await waitForBreadcrumb(repo);
    expect(crumb, 'breadcrumb written by the backgrounded hook').toBeTruthy();
    expect(crumb.status).toBe('ok');
    expect(crumb.trigger).toBe('post-commit');
    expect(crumb.to).toBeTruthy();
  }, 90000);

  it('a reindex failure never fails the git operation', async () => {
    installGraphHook(repo);
    writeFileSync(join(repo, 'c.js'), 'export function c() { return 3; }\n');
    git(repo, 'add', '-A');
    // Must not throw: the hook is backgrounded and reindex.mjs exits 0 on error.
    expect(() => git(repo, 'commit', '-q', '-m', 'third')).not.toThrow();
  }, 90000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/refresh-hooks-e2e.test.js`
Expected: FAIL if Tasks 1–2 are incomplete. If Tasks 1–2 are done, it should PASS — in which case verify it is real by temporarily renaming `scripts/reindex.mjs`, re-running (expect FAIL: no breadcrumb), then restoring.

- [ ] **Step 3: Record the verification in the test file**

If the test passed immediately in Step 2, add this comment above the first `it`:

```js
// Verified 2026-08-XX: renaming scripts/reindex.mjs makes this fail with no
// breadcrumb, confirming the assertion is bound to the mechanism and not to
// something incidentally true.
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Install the hooks on this repo — it is 130 commits stale**

Run:
```bash
node scripts/install-graph-hook.mjs .
node -e "
const {refreshMechanismVerdict}=require('./mcp/stdio/freshness/refresh-verdict.js');
" 2>/dev/null || npx vitest run tests/unit/query/refresh-mechanism-verdict.test.js
git status --short
```
Expected: 4 hooks installed under `.git/hooks/`. `.git/` is not tracked, so `git status` stays clean.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/refresh-hooks-e2e.test.js
git commit -m "test(freshness): git actually runs the hooks and the breadcrumb lands"
```

---

### Task 7: Release v0.5.0

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md` (new `[0.5.0]` section under `[Unreleased]`)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: tag `v0.5.0`.

- [ ] **Step 1: Confirm the whole suite is green**

Run: `npx vitest run`
Expected: PASS, no failures, no skips beyond the existing 2.

- [ ] **Step 2: Bump the version**

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='0.5.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version);"
```
Expected output: `0.5.0`

- [ ] **Step 3: Write the CHANGELOG section**

Insert directly below `## [Unreleased]`:

```markdown
## [0.5.0] — 2026-08-XX

**Freshness becomes somebody's job.** Two repos measured at v0.4.0: `sand_castle`
20 commits stale (its manager made zero graph calls in a full session, then
concluded the tool did not help), `aify-project-graph` itself 130 commits stale.
Neither was an indexing bug. The refresh mechanism existed and had never been
installed, and nothing reported its absence.

- Refresh now runs on **every git event that moves HEAD** — `post-commit`,
  `post-merge`, `post-checkout`, `post-rewrite` — not just local commits. The
  `post-checkout` hook checks git's third argument so file checkouts do not
  trigger a full reindex.
- **Hook outcomes are recorded**, not discarded. The hooks run backgrounded with
  `>/dev/null 2>&1` and cannot report through an exit code, so each writes
  `.aify-graph/last-refresh.json`.
- **`graph_health` reports a dead refresh mechanism as `degraded`** — including
  when hooks are installed but no refresh has ever been recorded. An un-hooked
  repo reads `unconfigured`, not degraded: fail-closed applies to a mechanism
  that is supposed to be running, not one that was never enabled.
- **Installation is documented setup**, in the README and every `install.*.md`,
  stated as per-clone because `git clone` does not carry hooks.
- **Auto-reindex is documented as the fallback** it always was. It refreshes on
  the read path, which means blocking; the hooks refresh before the read.

Rejected during design, recorded so they are not re-proposed: a shared language
server (clangd instances already share the on-disk background index), a
cross-process watcher election (an owner that dies reintroduces silent staleness
as a distributed-systems problem), and one service per directory (its benefit
addresses a measured non-problem — 429 MB across 6 processes, 0.45% of RAM —
while making a long-lived stale-code-serving process the default architecture).
```

- [ ] **Step 4: Commit and tag**

```bash
git add package.json CHANGELOG.md
git commit -m "release: v0.5.0 — freshness becomes somebody's job"
git tag -a v0.5.0 -m "v0.5.0 — refresh on every HEAD-moving git event, fail-closed when it breaks"
git push origin main --follow-tags
```

- [ ] **Step 5: Verify the tag landed**

Run: `git describe --tags`
Expected: `v0.5.0`

---

## Self-Review

**Spec coverage:**

| spec requirement | task |
|---|---|
| Extend hooks to post-merge/post-checkout/post-rewrite | Task 1 |
| `post-checkout` third-argument guard | Task 1, step 1 + 3 |
| Breadcrumb `.aify-graph/last-refresh.json` with the specified shape | Task 2 |
| `graph_health` reports degraded on failure | Task 3 |
| Absent breadcrumb + installed hooks = degraded (fail-closed) | Task 3, test 4 |
| Un-hooked repo = unconfigured, NOT degraded | Task 3, test 1 |
| Installation in README + every install.*.md | Task 4 |
| Stated as per-clone / per-machine | Task 4, test 2 |
| Auto-reindex demoted to documented fallback | Task 5 |
| Test: each hook fires its event | Task 6 (post-commit e2e) + Task 1 (file content for the other three) |
| Test: post-checkout ignores file checkouts | Task 1, test 2 |
| Test: failing reindex reported not swallowed | Task 2 test 2 + Task 3 test 3 |
| Test: idempotent install | Task 1, test 4 |
| Test: concurrent hook invocations serialize | **GAP — see below** |
| Every test verified to fail with the change reverted | Steps 2 in every task; Task 6 step 2 explicitly |

**Known gap, stated rather than hidden:** the spec asks for a test that concurrent
hook invocations serialize. No task implements it. Two rapid commits both invoke
`reindex.mjs`, which calls `ensureFresh`, which is already guarded by
`withWriteLock` (in-process queue + cross-process `proper-lockfile`) — that lock
has its own coverage. Writing a race test that reliably reproduces the interleave
is slow and flaky, and would be testing the existing lock rather than anything
this plan adds. If the implementer wants it, it belongs as a test of
`withWriteLock`, not of the hooks. **Decide before starting Task 6.**

**Placeholder scan:** one intentional `2026-08-XX` in Task 6 step 3 and Task 7
step 3 — the implementer fills the actual date. No TBD/TODO/"handle edge cases".

**Type consistency:** `installGraphHook` returns `string[]` in Task 1 and is
consumed as an array in Tasks 3 and 6. `AIFY_HOOKS` is exported in Task 1 and
imported in Tasks 3 and 4. `readRefreshBreadcrumb`/`writeRefreshBreadcrumb` are
defined in Task 2 and consumed in Tasks 3 and 6 with matching signatures.
`refreshMechanismVerdict` returns the same six fields asserted in Task 3's tests
and read in Task 3 step 5. Checked.
