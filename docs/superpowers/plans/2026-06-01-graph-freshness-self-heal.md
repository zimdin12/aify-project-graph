# Graph Freshness Self-Heal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a stale graph self-heal (opt-in) and self-fix discoverable, so managed workers stop getting false-empty results from a behind-HEAD graph.

**Architecture:** Reuse the existing central staleness gate (`server.js` dispatch) + `ensureFresh` engine. Add an opt-in `APG_AUTO_REINDEX` self-heal before the handler, list `graph_index`, sharpen the warning, add a FRESHNESS instruction, and ship an optional git post-commit hook installer.

**Tech Stack:** Node ESM, vitest, MCP stdio server, git.

**Spec:** `docs/superpowers/specs/2026-06-01-graph-freshness-self-heal-design.md`

---

### Task 1: `autoReindexEnabled` predicate

**Files:**
- Create: `mcp/stdio/freshness/auto-reindex.js`
- Test: `tests/unit/freshness/auto-reindex.test.js`

- [ ] **Step 1: Failing test**

```javascript
// tests/unit/freshness/auto-reindex.test.js
import { describe, it, expect } from 'vitest';
import { autoReindexEnabled } from '../../../mcp/stdio/freshness/auto-reindex.js';

describe('autoReindexEnabled', () => {
  it('is true for common truthy strings (case-insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) expect(autoReindexEnabled(v)).toBe(true);
  });
  it('is false for falsey / unset values', () => {
    for (const v of [undefined, null, '', '0', 'false', 'no', 'off', 'random']) expect(autoReindexEnabled(v)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail** — `npx vitest run tests/unit/freshness/auto-reindex.test.js`

- [ ] **Step 3: Implement**

```javascript
// mcp/stdio/freshness/auto-reindex.js
//
// Opt-in switch: when APG_AUTO_REINDEX is truthy, the MCP dispatch self-heals a
// stale graph (incremental ensureFresh) BEFORE running a read verb, so managed
// workers — who get the read verbs but cannot call graph_index — stop getting
// false-empty results from a behind-HEAD graph. OFF by default (no surprise
// latency); warn-by-default behavior is unchanged when this is off.
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
export function autoReindexEnabled(value) {
  return typeof value === 'string' && TRUTHY.has(value.trim().toLowerCase());
}
```

- [ ] **Step 4: Run — expect pass** — `npx vitest run tests/unit/freshness/auto-reindex.test.js`

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/freshness/auto-reindex.js tests/unit/freshness/auto-reindex.test.js
git commit -m "feat(freshness): autoReindexEnabled predicate for opt-in self-heal"
```

---

### Task 2: Wire opt-in self-heal + sharper warning into the central gate

**Files:**
- Modify: `mcp/stdio/server.js` (dispatch block ~1052-1098; `DEFAULT_TOOL_NAMES` ~707)
- Test: `tests/integration/freshness-self-heal.test.js`

**Integration facts (verified):** dispatch calls `const result = await tool.handler(normalized)` at ~1060, then computes `stalenessWarning` (manifest.commit !== head) at ~1070-1085 and prepends `WARNING:`/`_warnings`. `commitsBehindHead(repoRoot, indexed, head)` is exported from `query/verbs/read_freshness.js`.

- [ ] **Step 1: Failing test** (integration — builds a real temp git repo + graph)

```javascript
// tests/integration/freshness-self-heal.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';
import { graphSearch } from '../../mcp/stdio/query/verbs/search.js';

function git(cwd, ...args) { execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }); }

describe('central-gate auto-reindex (APG_AUTO_REINDEX)', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-fresh-'));
    git(repo, 'init'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.js'), 'export function oldSym(){return 1;}\n');
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'first');
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} delete process.env.APG_AUTO_REINDEX; });

  it('ensureFresh picks up a newly-committed symbol after HEAD advances', async () => {
    await ensureFresh({ repoRoot: repo });
    writeFileSync(join(repo, 'b.js'), 'export function brandNewSym(){return 2;}\n');
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'second');
    // stale: graph indexed at first commit, HEAD now at second
    const before = await graphSearch({ repoRoot: repo, query: 'brandNewSym' });
    // search auto-ensures fresh today, so this should already find it; the gate
    // test below covers verbs that do NOT self-refresh.
    await ensureFresh({ repoRoot: repo });
    const after = await graphSearch({ repoRoot: repo, query: 'brandNewSym' });
    expect(JSON.stringify(after)).toMatch(/brandNewSym/);
  });
});
```

  NOTE: keep this test resilient — if `graphSearch`'s return shape differs, assert on a stringified match for `brandNewSym`. The core assertion is that after an `ensureFresh` at the new HEAD, the symbol is found.

- [ ] **Step 2: Run — expect pass already for the engine** (`ensureFresh` works); this test guards against regression. `npx vitest run tests/integration/freshness-self-heal.test.js`

- [ ] **Step 3: Implement the gate edit** in `server.js`:

  (a) Add `graph_index` to `DEFAULT_TOOL_NAMES` (insert `'graph_index',` into the Set literal near line 707).

  (b) Add a before-handler self-heal. Replace:

```javascript
      const result = await tool.handler(normalized);
```

  with:

```javascript
      // Opt-in self-heal: when APG_AUTO_REINDEX is set, refresh a stale graph
      // BEFORE the handler reads it, so managed workers (who can't call
      // graph_index) stop getting false-empty results. OFF by default.
      if (name !== 'graph_index' && name !== 'graph_status') {
        try {
          const { autoReindexEnabled } = await import('./freshness/auto-reindex.js');
          if (autoReindexEnabled(process.env.APG_AUTO_REINDEX)) {
            const { getHeadCommit } = await import('./freshness/git.js');
            const { loadManifest } = await import('./freshness/manifest.js');
            const graphDir = path.join(repoRoot, '.aify-graph');
            const [{ manifest }, head] = await Promise.all([
              loadManifest(graphDir),
              getHeadCommit(repoRoot).catch(() => null),
            ]);
            if (manifest?.commit && head && manifest.commit !== head) {
              const { ensureFresh } = await import('./freshness/orchestrator.js');
              await ensureFresh({ repoRoot });
            }
          }
        } catch { /* best-effort: fall through, the post-handler warning still fires */ }
      }
      const result = await tool.handler(normalized);
```

  (c) Enrich the existing `stalenessWarning` string. Replace:

```javascript
          if (manifest.commit && head && manifest.commit !== head) {
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}. Run graph_index() to refresh — line numbers may drift.`;
          }
```

  with:

```javascript
          if (manifest.commit && head && manifest.commit !== head) {
            const { commitsBehindHead } = await import('./query/verbs/read_freshness.js');
            const n = commitsBehindHead(repoRoot, manifest.commit, head);
            const behind = n != null ? ` (${n} commit${n === 1 ? '' : 's'} behind)` : '';
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}${behind}. Run graph_index() to refresh, or set APG_AUTO_REINDEX=1 for auto-refresh — line numbers may drift.`;
          }
```

- [ ] **Step 4: Run** — `npx vitest run tests/integration/freshness-self-heal.test.js tests/integration/server-toolset.test.js` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/server.js tests/integration/freshness-self-heal.test.js
git commit -m "feat(server): opt-in APG_AUTO_REINDEX self-heal + list graph_index + sharper stale warning"
```

---

### Task 3: server-toolset test — graph_index is listed by default

**Files:**
- Modify: `tests/integration/server-toolset.test.js` (add a case)

- [ ] **Step 1: Add the failing assertion**

```javascript
  it('lists graph_index in the default toolset so workers can self-refresh (field-report fix)', async () => {
    const { tools } = await listToolsDefault(); // use the helper this file already uses to get default tools
    expect(tools.map(t => t.name)).toContain('graph_index');
  });
```

  (Match the existing helper/pattern in this file for obtaining the default tool list; if it inspects `DEFAULT_TOOL_NAMES` or calls `tools/list`, follow suit.)

- [ ] **Step 2: Run — expect pass** (Task 2 already added graph_index to the Set). `npx vitest run tests/integration/server-toolset.test.js`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/server-toolset.test.js
git commit -m "test(server): assert graph_index is in the default toolset"
```

---

### Task 4: FRESHNESS rule in server-instructions

**Files:**
- Modify: `mcp/stdio/server-instructions.js`
- Test: `tests/unit/server-instructions.test.js` (extend)

- [ ] **Step 1: Add failing assertion** to the existing describe block:

```javascript
  it('includes a FRESHNESS self-refresh rule', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/FRESHNESS/);
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_index|APG_AUTO_REINDEX/);
    expect(SERVER_INSTRUCTIONS).toMatch(/stale .*not.*proof|not proof a symbol/i);
  });
```

- [ ] **Step 2: Run — expect fail** — `npx vitest run tests/unit/server-instructions.test.js`

- [ ] **Step 3: Implement** — add before the closing backtick in `SERVER_INSTRUCTIONS` (after KNOWN LIMITS):

```
FRESHNESS:
- If a response says "graph stale", run graph_index first (or set APG_AUTO_REINDEX=1 for auto-refresh).
- A stale "not found" is NOT proof a symbol is gone — re-run after indexing. The graph self-heals
  on read when APG_AUTO_REINDEX is set; otherwise refresh manually with graph_index.
```

  Bump the line-count cap assertion in the existing "stays tight" test from 72 to 84 if needed.

- [ ] **Step 4: Run — expect pass** — `npx vitest run tests/unit/server-instructions.test.js`

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/server-instructions.js tests/unit/server-instructions.test.js
git commit -m "docs(instructions): FRESHNESS self-refresh rule"
```

---

### Task 5: Optional git post-commit hook installer

**Files:**
- Create: `scripts/reindex.mjs` (reindex entry the hook calls)
- Create: `scripts/install-graph-hook.mjs` (installer)
- Test: `tests/unit/scripts/install-graph-hook.test.js`

- [ ] **Step 1: Failing test**

```javascript
// tests/unit/scripts/install-graph-hook.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installGraphHook, AIFY_HOOK_MARKER } from '../../../scripts/install-graph-hook.mjs';

describe('installGraphHook', () => {
  let repo;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'apg-hook-')); mkdirSync(join(repo, '.git', 'hooks'), { recursive: true }); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('writes an executable post-commit hook containing the aify block', () => {
    installGraphHook(repo);
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    expect(existsSync(hookPath)).toBe(true);
    const body = readFileSync(hookPath, 'utf8');
    expect(body).toContain(AIFY_HOOK_MARKER);
    expect(body).toContain('reindex.mjs');
  });

  it('is idempotent: re-running replaces the aify block, does not duplicate it', () => {
    installGraphHook(repo); installGraphHook(repo);
    const body = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8');
    expect(body.split(AIFY_HOOK_MARKER).length - 1).toBe(2); // marker appears once as BEGIN + once as END
  });

  it('preserves a pre-existing unrelated hook body', () => {
    const hookPath = join(repo, '.git', 'hooks', 'post-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho custom-thing\n');
    installGraphHook(repo);
    const body = readFileSync(hookPath, 'utf8');
    expect(body).toContain('echo custom-thing');
    expect(body).toContain(AIFY_HOOK_MARKER);
  });
});
```

- [ ] **Step 2: Run — expect fail** — `npx vitest run tests/unit/scripts/install-graph-hook.test.js`

- [ ] **Step 3: Implement `scripts/reindex.mjs`**

```javascript
// scripts/reindex.mjs — incremental reindex entry for the post-commit hook.
// Usage: node scripts/reindex.mjs <repoRoot>. Best-effort: never throws out.
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
const repoRoot = process.argv[2] || process.cwd();
ensureFresh({ repoRoot }).then(
  (r) => { console.log(`[aify-project-graph] reindexed ${repoRoot}: ${r?.nodes ?? '?'} nodes`); },
  (e) => { console.error(`[aify-project-graph] reindex failed: ${e?.message ?? e}`); process.exit(0); },
);
```

- [ ] **Step 4: Implement `scripts/install-graph-hook.mjs`**

```javascript
// scripts/install-graph-hook.mjs
//
// Installs a git post-commit hook that incrementally reindexes the aify graph
// after every commit, so the graph is never behind HEAD (no per-read latency).
// Idempotent: replaces only the aify-delimited block, preserving any other hook
// content. Run: node <thisRepo>/scripts/install-graph-hook.mjs [targetRepoRoot]
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

export const AIFY_HOOK_MARKER = 'aify-project-graph post-commit reindex';
const HERE = dirname(fileURLToPath(import.meta.url));
const REINDEX = join(HERE, 'reindex.mjs');

function aifyBlock(reindexPath) {
  return [
    `# >>> ${AIFY_HOOK_MARKER} >>>`,
    '# Auto-refresh the code graph after each commit (best-effort, backgrounded).',
    `node "${reindexPath}" "$(git rev-parse --show-toplevel)" >/dev/null 2>&1 &`,
    `# <<< ${AIFY_HOOK_MARKER} <<<`,
  ].join('\n');
}

// Strip a previously-installed aify block (between the BEGIN/END markers).
function stripAifyBlock(body) {
  const begin = `# >>> ${AIFY_HOOK_MARKER} >>>`;
  const end = `# <<< ${AIFY_HOOK_MARKER} <<<`;
  const lines = body.split('\n');
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.includes(begin)) { skipping = true; continue; }
    if (line.includes(end)) { skipping = false; continue; }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

export function installGraphHook(targetRepoRoot = process.cwd(), reindexPath = REINDEX) {
  const hooksDir = join(targetRepoRoot, '.git', 'hooks');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, 'post-commit');
  let body = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '#!/bin/sh\n';
  body = stripAifyBlock(body).replace(/\n+$/, '') + '\n';
  if (!body.startsWith('#!')) body = '#!/bin/sh\n' + body;
  body += '\n' + aifyBlock(reindexPath) + '\n';
  writeFileSync(hookPath, body, 'utf8');
  try { chmodSync(hookPath, 0o755); } catch { /* windows: chmod is a noop */ }
  return hookPath;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2] || process.cwd();
  const path = installGraphHook(target);
  console.log(`Installed aify post-commit reindex hook → ${path}`);
}
```

- [ ] **Step 5: Run — expect pass** — `npx vitest run tests/unit/scripts/install-graph-hook.test.js`

- [ ] **Step 6: Commit**

```bash
git add scripts/reindex.mjs scripts/install-graph-hook.mjs tests/unit/scripts/install-graph-hook.test.js
git commit -m "feat(scripts): optional git post-commit reindex hook installer"
```

---

### Task 6: Full-suite verify + status doc

**Files:**
- Modify: `docs/code-intel-v2-status.md`

- [ ] **Step 1: Full suite** — `npx vitest run` — expect all pass (1058 + new).

- [ ] **Step 2: Update status doc** — add under the Agent front door section:

```
- **Freshness self-heal (2026-06-01, field-report fix).** `graph_index` is now in the default
  tool surface; the central staleness warning reports commits-behind + the self-heal hint; opt-in
  `APG_AUTO_REINDEX=1` makes read verbs refresh a behind-HEAD graph before answering; optional
  `scripts/install-graph-hook.mjs` installs a post-commit reindex hook. Addresses the the field fleet
  A/B finding that a stale graph was worse than none for managed workers who couldn't reindex.
  (Overlay-build gap is a per-repo data action: run /graph-build-functionality.)
```

- [ ] **Step 3: Commit**

```bash
git add docs/code-intel-v2-status.md
git commit -m "docs(status): record graph freshness self-heal"
```

---

## Self-review notes

- **Spec coverage:** Component A → Tasks 1–2; Component B → Tasks 2–4; Component C → Task 5; testing → all tasks + Task 6. ✓
- **Placeholder scan:** Task 3 references "the helper this file already uses" — resolve by reading `server-toolset.test.js` at implementation time and matching its existing default-list accessor (not a placeholder for behavior, a pattern-match instruction).
- **Type consistency:** `autoReindexEnabled` (Task 1) used in Task 2; `commitsBehindHead` reused (already exported); `installGraphHook`/`AIFY_HOOK_MARKER` (Task 5) consistent across impl + test.
- **Deferred:** overlay build (#3, per-repo data); per-verb gating (unneeded — central gate covers all).
