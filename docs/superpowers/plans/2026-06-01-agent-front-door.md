# Agent Front Door + Adaptive Sizing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `graph_packet` budget repo-size-aware (kill god-file truncation on big repos), sharpen the agent session-instructions front door, and standardize a trust+staleness envelope — so agents lean on the tool instead of re-Reading/grepping.

**Architecture:** Layer on existing machinery. `graph_explore`/`graph_trace` already use monotonic repo-size tiers (`source-bundle.js`); add a sibling TOKEN-budget tier helper for `graph_packet` (the one static-`800` gap), tightening `server-instructions.js` (content only), and standardize a staleness banner reusing `read_freshness.js`.

**Tech Stack:** Node ESM, vitest, better-sqlite3 (graph), MCP stdio server.

**Spec:** `docs/superpowers/specs/2026-06-01-agent-front-door-design.md`

---

### Task 1: Adaptive packet token-budget helper

**Files:**
- Create: `mcp/stdio/query/response-budget.js`
- Test: `tests/unit/query/response-budget.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/query/response-budget.test.js
import { describe, it, expect } from 'vitest';
import { getPacketTokenBudget, assertMonotonicPacketTiers, PACKET_TIERS } from '../../../mcp/stdio/query/response-budget.js';

describe('getPacketTokenBudget', () => {
  it('maps node counts to the expected tier', () => {
    expect(getPacketTokenBudget(0).name).toBe('tiny');
    expect(getPacketTokenBudget(799).name).toBe('tiny');
    expect(getPacketTokenBudget(800).name).toBe('small');
    expect(getPacketTokenBudget(4000).name).toBe('small');
    expect(getPacketTokenBudget(4001).name).toBe('medium');
    expect(getPacketTokenBudget(15000).name).toBe('medium');
    expect(getPacketTokenBudget(40001).name).toBe('huge');
    expect(getPacketTokenBudget(10_000_000).name).toBe('huge');
  });

  it('returns budgetTokens and a full caps object', () => {
    const b = getPacketTokenBudget(5000);
    expect(b.budgetTokens).toBe(4500);
    for (const k of ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol']) {
      expect(typeof b.caps[k]).toBe('number');
    }
  });

  it('is monotonic: no axis decreases as repos grow', () => {
    expect(assertMonotonicPacketTiers()).toBe(true);
    const axes = ['budgetTokens'];
    const capAxes = ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol'];
    for (let i = 1; i < PACKET_TIERS.length; i++) {
      for (const a of axes) expect(PACKET_TIERS[i][a]).toBeGreaterThanOrEqual(PACKET_TIERS[i - 1][a]);
      for (const a of capAxes) expect(PACKET_TIERS[i].caps[a]).toBeGreaterThanOrEqual(PACKET_TIERS[i - 1].caps[a]);
    }
  });

  it('assertMonotonicPacketTiers throws on a regressed table', () => {
    const bad = [
      { name: 'a', maxNodes: 10, budgetTokens: 2000, caps: { evidence_records: 10, affected_files: 10, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
      { name: 'b', maxNodes: Infinity, budgetTokens: 1000, caps: { evidence_records: 10, affected_files: 10, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
    ];
    expect(() => assertMonotonicPacketTiers(bad)).toThrow(/monoton/i);
  });

  it('defends against non-finite input (→ tiny, safest under-read)', () => {
    expect(getPacketTokenBudget(undefined).name).toBe('tiny');
    expect(getPacketTokenBudget(-5).name).toBe('tiny');
    expect(getPacketTokenBudget(NaN).name).toBe('tiny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/response-budget.test.js`
Expected: FAIL — "Cannot find module ... response-budget.js".

- [ ] **Step 3: Write the implementation**

```javascript
// mcp/stdio/query/response-budget.js
//
// Repo-size-aware TOKEN budget for graph_packet (sibling to source-bundle.js's
// LINE budget for graph_explore/graph_trace). A fixed budget starves big repos:
// a god-file gets truncated and the agent re-Reads it — the exact fallback we
// want to kill. codegraph's load-bearing invariant: caps NEVER shrink as the
// repo grows. assertMonotonicPacketTiers() enforces it at load + in a unit test.

export const PACKET_TIERS = [
  { name: 'tiny',   maxNodes: 800,      budgetTokens: 1500,  caps: { evidence_records: 12, affected_files: 12, read_first: 10, diagnostics: 10, refs_per_symbol: 8 } },
  { name: 'small',  maxNodes: 4000,     budgetTokens: 2800,  caps: { evidence_records: 16, affected_files: 16, read_first: 12, diagnostics: 12, refs_per_symbol: 8 } },
  { name: 'medium', maxNodes: 15000,    budgetTokens: 4500,  caps: { evidence_records: 20, affected_files: 20, read_first: 14, diagnostics: 14, refs_per_symbol: 10 } },
  { name: 'large',  maxNodes: 40000,    budgetTokens: 7000,  caps: { evidence_records: 26, affected_files: 26, read_first: 18, diagnostics: 16, refs_per_symbol: 12 } },
  { name: 'huge',   maxNodes: Infinity, budgetTokens: 10000, caps: { evidence_records: 32, affected_files: 32, read_first: 22, diagnostics: 18, refs_per_symbol: 14 } },
];

const CAP_AXES = ['evidence_records', 'affected_files', 'read_first', 'diagnostics', 'refs_per_symbol'];

// Throw at load (and in a test) if any larger tier has a SMALLER cap than a
// smaller tier on any axis — fail loud, never silently starve a big repo.
export function assertMonotonicPacketTiers(tiers = PACKET_TIERS) {
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    if (cur.budgetTokens < prev.budgetTokens) {
      throw new Error(`packet tier monotonicity violated: ${cur.name}.budgetTokens=${cur.budgetTokens} < ${prev.name}.budgetTokens=${prev.budgetTokens}`);
    }
    for (const axis of CAP_AXES) {
      if (cur.caps[axis] < prev.caps[axis]) {
        throw new Error(`packet tier monotonicity violated: ${cur.name}.caps.${axis}=${cur.caps[axis]} < ${prev.name}.caps.${axis}=${prev.caps[axis]}`);
      }
    }
  }
  return true;
}
assertMonotonicPacketTiers();

// Pick the token budget + caps for a node count. Non-finite/negative → tiny
// (the safest under-read). Returns a fresh object (callers may mutate caps).
export function getPacketTokenBudget(nodeCount = 0) {
  const n = Number.isFinite(nodeCount) && nodeCount > 0 ? nodeCount : 0;
  for (const tier of PACKET_TIERS) {
    if (n <= tier.maxNodes) return { name: tier.name, budgetTokens: tier.budgetTokens, caps: { ...tier.caps } };
  }
  const last = PACKET_TIERS[PACKET_TIERS.length - 1];
  return { name: last.name, budgetTokens: last.budgetTokens, caps: { ...last.caps } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/query/response-budget.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/response-budget.js tests/unit/query/response-budget.test.js
git commit -m "feat(packet): adaptive token-budget tier helper (monotonic)"
```

---

### Task 2: Wire adaptive budget + caps into graph_packet

**Files:**
- Modify: `mcp/stdio/query/verbs/packet.js` (signature default `budget`, `DEFAULTS.budget_tokens` usage, `DEFAULT_CAPS` usage)
- Test: `tests/unit/query/packet-adaptive-budget.test.js`

**Integration facts (verified):** `graphPacket({ repoRoot, target, mode='orient', budget = DEFAULTS.budget_tokens, ... })` reads `const manifest = readManifest(repoRoot)` and renders via `clampToBudget(text, budgetTokens, ...)`. `manifest.json` carries `nodes`. `packet-budget.js` exports `DEFAULT_CAPS` used for list ranking.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/query/packet-adaptive-budget.test.js
import { describe, it, expect } from 'vitest';
import { resolvePacketBudget } from '../../../mcp/stdio/query/verbs/packet.js';

describe('resolvePacketBudget (packet budget precedence)', () => {
  it('uses the adaptive tier when no explicit budget/env', () => {
    const r = resolvePacketBudget({ explicit: null, env: undefined, nodeCount: 5000 });
    expect(r.budgetTokens).toBe(4500); // medium
    expect(r.caps.evidence_records).toBe(20);
  });
  it('explicit budget arg wins over tier + env', () => {
    const r = resolvePacketBudget({ explicit: 999, env: '5000', nodeCount: 50000 });
    expect(r.budgetTokens).toBe(999);
  });
  it('env override wins over tier when no explicit arg', () => {
    const r = resolvePacketBudget({ explicit: null, env: '3333', nodeCount: 100 });
    expect(r.budgetTokens).toBe(3333);
  });
  it('a huge repo gets the huge tier budget by default', () => {
    const r = resolvePacketBudget({ explicit: null, env: undefined, nodeCount: 60000 });
    expect(r.budgetTokens).toBe(10000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/packet-adaptive-budget.test.js`
Expected: FAIL — `resolvePacketBudget` not exported.

- [ ] **Step 3: Implement** — in `packet.js`:

  1. Add import near the top:

```javascript
import { getPacketTokenBudget } from '../response-budget.js';
```

  2. Add an exported pure resolver (place near `clampToBudget`):

```javascript
// Budget precedence: explicit arg > APG_PACKET_BUDGET env > adaptive tier.
// Returns { budgetTokens, caps } where caps scales the list ranking limits.
export function resolvePacketBudget({ explicit, env, nodeCount }) {
  const tier = getPacketTokenBudget(nodeCount);
  const envNum = env != null && env !== '' && Number.isFinite(Number(env)) ? Number(env) : null;
  const budgetTokens = Number.isFinite(Number(explicit)) && explicit != null
    ? Number(explicit)
    : (envNum ?? tier.budgetTokens);
  return { budgetTokens, caps: tier.caps };
}
```

  3. Change the handler default from `budget = DEFAULTS.budget_tokens` to `budget = null`, then inside `graphPacket(...)` after `manifest` is read, resolve the budget:

```javascript
const { budgetTokens, caps } = resolvePacketBudget({
  explicit: budget,
  env: process.env.APG_PACKET_BUDGET,
  nodeCount: manifest?.nodes ?? 0,
});
```

  4. Replace downstream uses of the old fixed budget with `budgetTokens` (the value passed to `clampToBudget`), and where the packet ranks/caps lists with `DEFAULT_CAPS`, prefer `caps` (e.g. `rankAndCap(items, caps.evidence_records)`). Keep `DEFAULT_CAPS` as the fallback for any path not threaded with `caps`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/query/packet-adaptive-budget.test.js tests/unit/query/response-budget.test.js`
Expected: PASS. Then run the existing packet tests to confirm no regression:
Run: `npx vitest run tests/unit -t packet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/packet.js tests/unit/query/packet-adaptive-budget.test.js
git commit -m "feat(packet): repo-size-aware budget + caps (manifest.nodes), arg>env>tier"
```

---

### Task 3: Front-door tightening — server-instructions.js

**Files:**
- Modify: `mcp/stdio/server-instructions.js` (the `SERVER_INSTRUCTIONS` string)
- Test: `tests/unit/server-instructions.test.js` (create if absent)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/server-instructions.test.js
import { describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../mcp/stdio/server-instructions.js';

describe('SERVER_INSTRUCTIONS front door', () => {
  it('names graph_packet as the first move for understand-X questions', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/graph_packet/);
    expect(SERVER_INSTRUCTIONS).toMatch(/ONE graph_packet|first move|prefer it over chaining/i);
  });
  it('includes an honest KNOWN LIMITS section', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/KNOWN LIMITS/);
    expect(SERVER_INSTRUCTIONS).toMatch(/dynamic dispatch|function-pointer|script callback|std::function/i);
  });
  it('stays tight (<= ~70 lines) so it fits the system prompt budget', () => {
    expect(SERVER_INSTRUCTIONS.split('\n').length).toBeLessThanOrEqual(72);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/server-instructions.test.js`
Expected: FAIL — no KNOWN LIMITS / first-move text yet.

- [ ] **Step 3: Implement** — in `server-instructions.js`, edit the `ORIENT FIRST` bullet for `graph_packet` to assert primacy, and append a `KNOWN LIMITS` block before the closing backtick. Exact additions:

Replace the `graph_packet {target, mode}` line under ORIENT FIRST with:

```
- graph_packet {target, mode} — the FIRST move. Most "what is X / how does Y work / understand area Z"
  questions resolve in ONE graph_packet call; prefer it over chaining graph_search + a node verb.
```

Add before the final closing backtick (after OUTPUT CONTRACTS):

```
KNOWN LIMITS (don't burn calls on these — read the code instead):
- C++-first; JS/TS resolution is best-effort, other languages structural-only.
- The static graph does NOT synthesize dynamic dispatch: function-pointer / std::function /
  script (Lua) callbacks, and registry/DI indirection. Verify those by reading.
- Cross-language links beyond the C++↔GLSL shader bridge (graph_shader) are not resolved.
- An absence claim ("no callers / dead code") is only trustworthy when the evidence banner says
  exhaustive (see TRUST RULES). Otherwise verify before deleting.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/server-instructions.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/server-instructions.js tests/unit/server-instructions.test.js
git commit -m "docs(instructions): graph_packet as first move + honest KNOWN LIMITS"
```

---

### Task 4: Standard staleness banner + evidence-envelope presence

**Files:**
- Create: `mcp/stdio/query/staleness-banner.js`
- Test: `tests/unit/query/staleness-banner.test.js`

**Rationale:** A single, consistent `⚠ stale:` line agents learn once. The evidence/exhaustiveness contract already exists (`lsp-evidence.js`); this task adds the freshness-banner primitive and locks its wording. Wiring it into more verbs is incremental and safe (additive prefix).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/query/staleness-banner.test.js
import { describe, it, expect } from 'vitest';
import { stalenessBanner } from '../../../mcp/stdio/query/staleness-banner.js';

describe('stalenessBanner', () => {
  it('returns empty string when nothing is stale', () => {
    expect(stalenessBanner([])).toBe('');
    expect(stalenessBanner(null)).toBe('');
  });
  it('renders one consistent line naming the stale files', () => {
    const b = stalenessBanner(['a/x.cpp', 'b/y.h']);
    expect(b).toMatch(/^⚠ stale:/);
    expect(b).toContain('a/x.cpp');
    expect(b).toContain('b/y.h');
    expect(b).toMatch(/Read these directly/i);
  });
  it('caps the file list and notes the overflow count', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.cpp`);
    const b = stalenessBanner(files, { max: 5 });
    expect(b).toContain('f0.cpp');
    expect(b).toMatch(/\+15 more/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/query/staleness-banner.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```javascript
// mcp/stdio/query/staleness-banner.js
//
// ONE consistent staleness line that agents learn once: when a response includes
// files that have been edited since the graph was indexed (per read_freshness),
// prepend this so the agent Reads those files instead of trusting stale truth.
export function stalenessBanner(staleFiles, { max = 8 } = {}) {
  const files = Array.isArray(staleFiles) ? staleFiles.filter(Boolean) : [];
  if (!files.length) return '';
  const shown = files.slice(0, max);
  const overflow = files.length - shown.length;
  const list = shown.join(', ') + (overflow > 0 ? ` (+${overflow} more)` : '');
  return `⚠ stale: ${list} — Read these directly; the rest is fresh.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/query/staleness-banner.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/staleness-banner.js tests/unit/query/staleness-banner.test.js
git commit -m "feat(query): standard staleness banner primitive"
```

---

### Task 5: Full-suite verification + status doc update

**Files:**
- Modify: `docs/code-intel-v2-status.md` (one line under capability notes)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (was 1043; now +~15 new tests, 0 failures).

- [ ] **Step 2: Manual smoke — packet budget scales**

Run:
```bash
node -e "import('./mcp/stdio/query/response-budget.js').then(m=>{for(const n of [100,3000,9000,60000]) console.log(n, m.getPacketTokenBudget(n).name, m.getPacketTokenBudget(n).budgetTokens)})"
```
Expected: `100 tiny 1500`, `3000 small 2800`, `9000 medium 4500`, `60000 huge 10000`.

- [ ] **Step 3: Update status doc** — add under the capability section of `docs/code-intel-v2-status.md`:

```
- **Agent front door (2026-06-01):** graph_packet budget + list caps are now repo-size-adaptive
  (manifest.nodes → monotonic tiers, arg>env>tier); server-instructions names graph_packet the
  first move + an honest KNOWN LIMITS block; standard `⚠ stale:` banner primitive. explore/trace
  were already adaptive (source-bundle tiers).
```

- [ ] **Step 4: Commit**

```bash
git add docs/code-intel-v2-status.md
git commit -m "docs(status): record agent front door + adaptive packet sizing"
```

---

## Self-review notes

- **Spec coverage:** C1 adaptive sizing → Tasks 1–2 (scoped to packet per the amended spec; explore/trace already done). C2 front-door tightening → Task 3. C3 trust+staleness envelope → Task 4 (banner primitive + the existing evidence contract). Testing section → Tasks 1–5. ✓
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `getPacketTokenBudget`/`assertMonotonicPacketTiers`/`PACKET_TIERS` (Task 1) used verbatim in Tasks 2 & 5; `resolvePacketBudget` shape `{budgetTokens, caps}` consistent across Task 2; `stalenessBanner(files, {max})` consistent in Task 4.
- **Deferred (explicit):** graph_pull adaptive budget; wiring the staleness banner into every verb (Task 4 ships the primitive; broad wiring is incremental); eval harness.
