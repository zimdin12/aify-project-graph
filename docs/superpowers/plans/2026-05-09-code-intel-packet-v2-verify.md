# Plan #4: Packet v2 + verify mode + fact budget (M4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `graph_packet` the user-visible LSP-for-agents surface from the superplan thesis. Add a new `verify` mode (post-edit decision packet) and fold code-intel evidence into existing modes through a shared `EVIDENCE:` block with provenance tags. Enforce fact-budget caps with the locked ranking order (changed_files → task_anchors → code_intel_confidence → recency). Render the three-state result distinction in packet output. Cover the W1.4 verify fixtures (5 cases including partial state).

**Architecture:**
- Single new helper module `mcp/stdio/query/verbs/packet-evidence.js` builds the EVIDENCE block from the current snapshot: pulls `getLatestCollection()`, `getCodeIntelEvidenceForSymbol()`, and `getCodeIntelDiagnosticsForFiles()`. Returns a structured payload that is then rendered via the helpers from Plan #3 (`render.js`).
- New verify-mode handler `mcp/stdio/query/verbs/packet-verify.js` computes the post-edit payload: changed files (from `since` ref or explicit `files[]`), diagnostics on changed files, affected symbols (from code-intel refs into changed files), likely tests (from overlay), freshness verdict, `SOURCE_REQUIRED` warning when audited code is touched.
- `packet.js` is modified minimally: register `verify` mode, dispatch to new handlers, accept new `since`/`files` params, render EVIDENCE block uniformly across modes when code-intel is available.
- Fact-budget ranker `mcp/stdio/query/verbs/packet-budget.js` enforces caps and the locked ranking order.

**Tech Stack:** Node.js 20+, ajv, better-sqlite3, vitest. No new runtime deps.

**Plan series:** #4 of 6. Depends on Plans #1, #2, #3.

---

## File Structure

**Create:**
- `mcp/stdio/query/verbs/packet-evidence.js` — builds EVIDENCE block payload.
- `mcp/stdio/query/verbs/packet-verify.js` — verify-mode handler.
- `mcp/stdio/query/verbs/packet-budget.js` — fact-budget caps + ranker.
- `tests/unit/query/packet-evidence.test.js`
- `tests/unit/query/packet-verify.test.js`
- `tests/unit/query/packet-budget.test.js`
- `tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json` — fixture with diagnostics on `src/bar.cpp` for verify tests.

**Modify:**
- `mcp/stdio/query/verbs/packet.js` — register `verify` mode; integrate EVIDENCE block.
- (No change to existing test files; the fact-budget caps are additive.)

---

## Task 1: Fact-budget caps + ranker

**Files:**
- Create: `mcp/stdio/query/verbs/packet-budget.js`
- Create: `tests/unit/query/packet-budget.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import { rankAndCap, RANKING_ORDER, DEFAULT_CAPS } from '../../../mcp/stdio/query/verbs/packet-budget.js';

describe('packet fact budget', () => {
  it('exposes the locked ranking order', () => {
    expect(RANKING_ORDER).toEqual(['changed_files', 'task_anchors', 'code_intel_confidence', 'recency']);
  });

  it('exposes default caps for known sections', () => {
    expect(typeof DEFAULT_CAPS).toBe('object');
    expect(DEFAULT_CAPS.evidence_records).toBeGreaterThan(0);
    expect(DEFAULT_CAPS.diagnostics).toBeGreaterThan(0);
    expect(DEFAULT_CAPS.affected_files).toBeGreaterThan(0);
  });

  it('ranks changed-files items before task anchors before code_intel_confidence before recency', () => {
    const items = [
      { file: 'a.cpp', score: { recency: 1 } },
      { file: 'b.cpp', score: { code_intel_confidence: 'high' } },
      { file: 'c.cpp', score: { task_anchors: 1 } },
      { file: 'd.cpp', score: { changed_files: 1 } }
    ];
    const ranked = rankAndCap(items, 4);
    expect(ranked.map(i => i.file)).toEqual(['d.cpp', 'c.cpp', 'b.cpp', 'a.cpp']);
  });

  it('caps by limit', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.cpp`, score: { recency: i } }));
    const ranked = rankAndCap(items, 5);
    expect(ranked.length).toBe(5);
  });

  it('breaks ties by code_intel_confidence (high > medium > low)', () => {
    const items = [
      { file: 'a.cpp', score: { changed_files: 1, code_intel_confidence: 'low' } },
      { file: 'b.cpp', score: { changed_files: 1, code_intel_confidence: 'high' } },
      { file: 'c.cpp', score: { changed_files: 1, code_intel_confidence: 'medium' } }
    ];
    const ranked = rankAndCap(items, 3);
    expect(ranked.map(i => i.file)).toEqual(['b.cpp', 'c.cpp', 'a.cpp']);
  });
});
```

- [ ] **Step 2: Run, verify fail, then implement**

`mcp/stdio/query/verbs/packet-budget.js`:

```js
export const RANKING_ORDER = ['changed_files', 'task_anchors', 'code_intel_confidence', 'recency'];

export const DEFAULT_CAPS = {
  evidence_records: 12,
  diagnostics: 10,
  affected_files: 12,
  read_first: 10,
  refs_per_symbol: 8
};

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function score(item, key) {
  const v = item?.score?.[key];
  if (v === undefined || v === null) return 0;
  if (key === 'code_intel_confidence') return CONFIDENCE_RANK[v] || 0;
  return typeof v === 'number' ? v : (v ? 1 : 0);
}

export function rankAndCap(items, limit) {
  const arr = Array.isArray(items) ? [...items] : [];
  arr.sort((a, b) => {
    for (const key of RANKING_ORDER) {
      const sa = score(a, key);
      const sb = score(b, key);
      if (sa !== sb) return sb - sa;
    }
    return 0;
  });
  return Number.isFinite(limit) ? arr.slice(0, limit) : arr;
}
```

Run tests, confirm pass, commit:

```bash
git add mcp/stdio/query/verbs/packet-budget.js tests/unit/query/packet-budget.test.js
git commit -m "feat(packet): add fact-budget ranker with locked ranking order"
```

---

## Task 2: Packet evidence block builder

**Files:**
- Create: `mcp/stdio/query/verbs/packet-evidence.js`
- Create: `tests/unit/query/packet-evidence.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { buildEvidenceBlock, renderEvidenceBlock } from '../../../mcp/stdio/query/verbs/packet-evidence.js';

function setupRepo(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pe-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixture) {
    const tmp = path.join(os.tmpdir(), `apg-pe-${Date.now()}.json`);
    fs.writeFileSync(tmp, fs.readFileSync(`tests/fixtures/code-intel/v02/${fixture}`, 'utf8'));
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return dir;
}

describe('packet-evidence', () => {
  it('returns available=false with reason when no code-intel collection exists', () => {
    const dir = setupRepo();
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.available).toBe(false);
    expect(block.reason).toBe('no_collection');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/code_intel unavailable/);
  });

  it('returns available=true with provider + status when a fresh collection exists', () => {
    const dir = setupRepo('cpp-basic-collection.json');
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.available).toBe(true);
    expect(block.provider).toBe('cpp-clangd');
    expect(block.status).toBe('ok');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/EVIDENCE:/);
    expect(rendered).toMatch(/cpp-clangd/);
  });

  it('renders partial status distinctly from ok', () => {
    const dir = setupRepo('cpp-partial-collection.json');
    const block = buildEvidenceBlock({ repoRoot: dir });
    expect(block.status).toBe('partial');
    const rendered = renderEvidenceBlock(block);
    expect(rendered).toMatch(/partial/);
    expect(rendered).toMatch(/references/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/unit/query/packet-evidence.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/packet-evidence.js`:

```js
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { getLatestCollection, getCodeIntelEvidenceForSymbol, getCodeIntelDiagnosticsForFiles } from '../../code-intel/query.js';
import { renderEvidenceLine, formatProvenanceTag, formatThreeStateRefs } from '../../code-intel/render.js';

export function buildEvidenceBlock({ repoRoot, symbol = null, files = [] } = {}) {
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) {
    return { available: false, reason: 'no_graph' };
  }
  let block = { available: false, reason: 'no_collection' };
  try {
    const db = openExistingDb(dbPath);
    try {
      const latest = getLatestCollection(db);
      if (!latest) return block;
      const symbolEvidence = symbol ? getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) }) : null;
      const diagnostics = files.length > 0 ? getCodeIntelDiagnosticsForFiles(db, files) : [];
      block = {
        available: true,
        provider: latest.provider,
        providerVersion: latest.providerVersion,
        status: latest.status,
        operations: latest.operations,
        freshnessBasis: latest.freshnessBasis,
        freshnessValue: latest.freshnessValue,
        compileDbHash: latest.compileDbHash,
        collectedAt: latest.collectedAt,
        symbol: symbolEvidence,
        diagnostics
      };
    } finally { db.close(); }
  } catch { /* leave block as not-available */ }
  return block;
}

export function renderEvidenceBlock(block) {
  if (!block || !block.available) {
    return renderEvidenceLine({ available: false, reason: block?.reason || 'no_collection' });
  }
  const lines = [renderEvidenceLine({
    available: true,
    provider: block.provider,
    providerVersion: block.providerVersion,
    status: block.status,
    operations: block.operations
  })];
  if (block.symbol && block.symbol.found) {
    lines.push(`  symbol: defs=${block.symbol.summary.definitions} refs=${block.symbol.summary.references} hovers=${block.symbol.summary.hovers} (${formatProvenanceTag({ kind: 'reference', confidence: 'high', provenance: `${block.provider}@${block.providerVersion}` })})`);
    if (block.symbol.references.length > 0) {
      lines.push(`  ref state: ${formatThreeStateRefs({ state: block.symbol.references[0]?.result_state || 'found', count: block.symbol.references.length, providerStatus: block.status })}`);
    }
  }
  if (block.diagnostics?.length > 0) {
    const sevCounts = block.diagnostics.reduce((acc, d) => {
      const sev = d.raw?.severity || 'info';
      acc[sev] = (acc[sev] || 0) + 1;
      return acc;
    }, {});
    lines.push(`  diagnostics: ${Object.entries(sevCounts).map(([s, c]) => `${s}=${c}`).join(' ')}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run, commit**

Run: `npx vitest run tests/unit/query/packet-evidence.test.js`
Expected: PASS.

```bash
git add mcp/stdio/query/verbs/packet-evidence.js tests/unit/query/packet-evidence.test.js
git commit -m "feat(packet): add code-intel EVIDENCE block builder + renderer"
```

---

## Task 3: Verify-mode handler + fixtures

**Files:**
- Create: `mcp/stdio/query/verbs/packet-verify.js`
- Create: `tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json`
- Create: `tests/unit/query/packet-verify.test.js`

- [ ] **Step 1: Write the bar-diagnostic fixture**

`tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json`:

```json
{
  "schema_version": "0.2",
  "collectionId": "ci-2026-05-09T14-00-00Z-bar01",
  "provider": "cpp-clangd",
  "providerVersion": "0.1.0",
  "projectRoot": "/repo/root",
  "session": {
    "collectedAt": "2026-05-09T14:00:00Z",
    "freshnessBasis": "compile_db_hash",
    "compileDbHash": "bar01"
  },
  "operations": {
    "definitions": { "status": "ok", "count": 0 },
    "diagnostics": { "status": "ok", "count": 1 }
  },
  "status": "ok",
  "records": [
    {
      "schema_version": "0.2",
      "collectionId": "ci-2026-05-09T14-00-00Z-bar01",
      "kind": "diagnostic",
      "language": "cpp",
      "file": "src/bar.cpp",
      "severity": "error",
      "message": "use of undeclared identifier 'oops'",
      "range": { "start": { "line": 7, "col": 5 }, "end": { "line": 7, "col": 9 } },
      "provenance": "cpp-clangd@0.1.0"
    }
  ]
}
```

- [ ] **Step 2: Write failing tests for the 5 verify-mode acceptance cases**

`tests/unit/query/packet-verify.test.js`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { buildVerifyPacket } from '../../../mcp/stdio/query/verbs/packet-verify.js';

function setupRepo({ fixture, stale = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-vfy-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixture) {
    const tmp = path.join(os.tmpdir(), `apg-vfy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    let content = fs.readFileSync(`tests/fixtures/code-intel/v02/${fixture}`, 'utf8');
    if (stale) {
      // simulate stale by setting a far-past collectedAt
      const obj = JSON.parse(content);
      obj.session.collectedAt = '2025-01-01T00:00:00Z';
      content = JSON.stringify(obj);
    }
    fs.writeFileSync(tmp, content);
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return dir;
}

describe('verify mode (W1.4 fixtures)', () => {
  it('(a) clean edit + fresh provider — returns ok packet with diagnostics block', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.mode).toBe('verify');
    expect(packet.evidence.available).toBe(true);
    expect(packet.evidence.status).toBe('ok');
    expect(packet.diagnostics.length).toBe(1);
    expect(packet.stale).toBe(false);
    expect(packet.partial).toBe(false);
  });

  it('(b) edit + stale provider — surfaces stale=true', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json', stale: true });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.available).toBe(true);
    expect(packet.stale).toBe(true);
  });

  it('(c) edit + provider unavailable — explicit unavailable + tree-sitter-only output', () => {
    const dir = setupRepo();
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.available).toBe(false);
    expect(packet.rendered).toMatch(/code_intel unavailable/);
    expect(packet.rendered).toMatch(/tree-sitter\+overlay only/);
  });

  it('(d) edit touching audited code — surfaces SOURCE_REQUIRED', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'], audited: true });
    expect(packet.sourceRequired).toBe(true);
    expect(packet.rendered).toMatch(/SOURCE_REQUIRED/);
  });

  it('(e) edit + partial provider state — renders partial status distinctly', () => {
    const dir = setupRepo({ fixture: 'cpp-partial-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.status).toBe('partial');
    expect(packet.partial).toBe(true);
    expect(packet.rendered).toMatch(/CODE_INTEL partial/);
    expect(packet.rendered).toMatch(/references/);
  });

  it('exercises files[] with an untracked file (pre-clean-ref)', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/new_untracked.cpp'] });
    expect(packet.diagnostics.length).toBe(0);
    expect(packet.evidence.available).toBe(true);
    expect(packet.rendered).toMatch(/src\/new_untracked.cpp/);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run tests/unit/query/packet-verify.test.js`
Expected: FAIL.

- [ ] **Step 4: Implement**

`mcp/stdio/query/verbs/packet-verify.js`:

```js
import { buildEvidenceBlock, renderEvidenceBlock } from './packet-evidence.js';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function computeStale(block) {
  if (!block?.collectedAt) return false;
  const age = Date.now() - new Date(block.collectedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

function renderVerify(packet) {
  const lines = [];
  lines.push('MODE: verify');
  lines.push(`FILES: ${packet.files.join(', ')}`);
  if (packet.since) lines.push(`SINCE: ${packet.since}`);

  if (!packet.evidence.available) {
    lines.push(renderEvidenceBlock(packet.evidence));
    lines.push('TRUST: tree-sitter+overlay only');
  } else {
    if (packet.partial) {
      const refsOp = packet.evidence.operations?.references;
      const ncCount = refsOp?.notCollectedFiles?.length || 0;
      const diagOk = packet.evidence.operations?.diagnostics?.status === 'ok';
      lines.push(`CODE_INTEL partial: ${diagOk ? 'diagnostics collected' : 'diagnostics partial'}, references not_collected for ${ncCount} files`);
      lines.push(renderEvidenceBlock(packet.evidence));
    } else {
      lines.push(renderEvidenceBlock(packet.evidence));
    }
    if (packet.stale) lines.push('FRESHNESS: STALE — code_intel collection older than threshold; consider re-running `apg code-intel collect`');
  }

  if (packet.diagnostics.length > 0) {
    lines.push(`DIAGNOSTICS (${packet.diagnostics.length}):`);
    for (const d of packet.diagnostics.slice(0, 10)) {
      const raw = d.raw || {};
      lines.push(`  ${raw.severity || 'info'} ${d.file}:${raw.range?.start?.line ?? '?'}: ${raw.message || ''}`);
    }
  }

  if (packet.sourceRequired) {
    lines.push('SOURCE_REQUIRED: this change touches audited code; confirm against source even with code_intel evidence');
  }
  return lines.join('\n');
}

export function buildVerifyPacket({ repoRoot, since = null, files = [], audited = false } = {}) {
  const evidence = buildEvidenceBlock({ repoRoot, files });
  const partial = evidence.available && evidence.status === 'partial';
  const stale = evidence.available && computeStale(evidence);
  const diagnostics = (evidence.diagnostics || []).filter(d => files.includes(d.file));
  const packet = {
    mode: 'verify',
    files: [...files],
    since,
    evidence,
    diagnostics,
    partial,
    stale,
    sourceRequired: !!audited
  };
  packet.rendered = renderVerify(packet);
  return packet;
}
```

- [ ] **Step 5: Run, commit**

Run: `npx vitest run tests/unit/query/packet-verify.test.js`
Expected: PASS, 6/6.

```bash
git add mcp/stdio/query/verbs/packet-verify.js mcp/stdio/query/verbs/packet-evidence.js tests/unit/query/packet-verify.test.js tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json
git commit -m "feat(packet): add verify mode handler + W1.4 fixtures (5 cases + untracked)"
```

---

## Task 4: Wire `verify` mode into `graph_packet`

**Files:**
- Modify: `mcp/stdio/query/verbs/packet.js`

- [ ] **Step 1: Inspect current dispatch**

Run: `grep -n "PACKET_MODES\|graphPacket\|export" mcp/stdio/query/verbs/packet.js | head`

- [ ] **Step 2: Modify packet.js**

In `mcp/stdio/query/verbs/packet.js`:

1. Add `'verify'` to `PACKET_MODES`:

```js
const PACKET_MODES = new Set(['orient', 'plan', 'debug', 'review', 'audit', 'verify']);
```

2. Add `verify` mode override:

```js
const MODE_OVERRIDES = {
  orient: {},
  plan: { read_first: 10, contracts: 8, tests: 8, risks: 8 },
  debug: { read_first: 10, tests: 10, risks: 8 },
  review: { read_first: 8, contracts: 8, tests: 10, risks: 10 },
  audit: { read_first: 10, contracts: 10, tests: 10, risks: 12 },
  verify: { read_first: 8, contracts: 4, tests: 8, risks: 8 }
};
```

3. Import the new helpers near the top:

```js
import { buildVerifyPacket } from './packet-verify.js';
import { buildEvidenceBlock, renderEvidenceBlock } from './packet-evidence.js';
```

4. Update `graphPacket` to dispatch verify mode and inject the EVIDENCE block:

Find the existing entry function (around line 431):

```js
export async function graphPacket({ repoRoot, target, mode = 'orient', budget = DEFAULTS.budget_tokens, live = false, since = null, files = [], audited = false }) {
```

Add a verify-mode short-circuit at the top of the function body:

```js
const normalizedMode = normalizeMode(mode);
if (normalizedMode === 'verify') {
  const verifyPacket = buildVerifyPacket({ repoRoot, since, files, audited });
  return verifyPacket.rendered;
}
```

For non-verify modes, render the EVIDENCE block by appending it after the existing trailing risks/notes section. Locate the lines that build the final packet text (search for `'RISKS:'` or the final `.join('\n')`). Add before the final assembly:

```js
let evidenceBlockLines = [];
try {
  const block = buildEvidenceBlock({ repoRoot, symbol: target, files: opts.read_first_files || [] });
  if (block.available || (block && block.reason === 'no_collection')) {
    evidenceBlockLines = [renderEvidenceBlock(block)];
  }
} catch { /* swallow */ }
```

Then include `evidenceBlockLines` in the final concatenation, e.g.:

```js
const finalLines = [
  // ... existing lines ...
  ...evidenceBlockLines,
  // ... existing lines ...
];
```

If the existing function builds output by string concatenation rather than line arrays, append `evidenceBlockLines.join('\n') + '\n'` to the output before the final `return`.

- [ ] **Step 3: Add an integration test for verify mode through `graphPacket`**

Append to `tests/unit/query/packet-verify.test.js`:

```js
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';

describe('graphPacket(mode:verify)', () => {
  it('routes verify mode through buildVerifyPacket', async () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const out = await graphPacket({ repoRoot: dir, mode: 'verify', files: ['src/bar.cpp'] });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/MODE: verify/);
    expect(out).toMatch(/DIAGNOSTICS/);
  });
});
```

- [ ] **Step 4: Run, commit**

Run: `npx vitest run tests/unit/query/packet-verify.test.js`
Expected: PASS, 7/7.

Run: `npx vitest run tests/unit/query/`
Expected: zero regressions vs the post-Plan-#3 baseline.

```bash
git add mcp/stdio/query/verbs/packet.js tests/unit/query/packet-verify.test.js
git commit -m "feat(packet): register verify mode + fold EVIDENCE block into all modes"
```

---

## Task 5: Full regression sweep + tag

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run tests/unit/`
Expected: PASS, no regressions.

- [ ] **Step 2: Smoke verify mode**

Create a temp repo with a fixture and call the CLI:

```bash
node -e "
import('./mcp/stdio/query/verbs/packet.js').then(async m => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.default.mkdtempSync(path.default.join(os.default.tmpdir(),'apg-smoke-'));
  fs.default.mkdirSync(path.default.join(dir,'.aify-graph'),{recursive:true});
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.default.join(dir,'.aify-graph','graph.sqlite');
  const { openDb, openExistingDb } = await import('./mcp/stdio/storage/db.js');
  const db = openDb(dbPath); db.close();
  const tmp = path.default.join(os.default.tmpdir(),'apg-smoke-fix.json');
  fs.default.writeFileSync(tmp, fs.default.readFileSync('tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json','utf8'));
  const { importCodeIntel } = await import('./mcp/stdio/ingest/code-intel/importer.js');
  const db2 = openExistingDb(dbPath,{readonly:false}); importCodeIntel(tmp, db2); db2.close();
  const out = await m.graphPacket({ repoRoot: dir, mode: 'verify', files: ['src/bar.cpp'] });
  console.log(out);
});
"
```

Expected: prints a packet starting with `MODE: verify` and including `DIAGNOSTICS (1):`.

- [ ] **Step 3: Tag**

```bash
git tag plan-4-packet-verify-complete
```

---

## Acceptance summary

After Plan #4:

- `graph_packet({mode:'verify', since, files, audited})` returns a post-edit decision packet covering all five W1.4 fixture cases plus untracked files.
- Existing modes (`orient | plan | debug | review | audit`) include an EVIDENCE block when code-intel is available, with explicit negative evidence when not.
- Three-state result distinction (`found | not_found_after_retry | not_collected`) renders consistently via `mcp/stdio/code-intel/render.js` helpers.
- Fact-budget caps and ranking (changed_files → task_anchors → code_intel_confidence → recency) are exposed in `packet-budget.js` and ready for downstream consumers.
- Zero regressions on pre-existing query tests.

This is the **user-visible payoff**. Steven can dogfood `graph_packet({mode:'verify'})` against any APG repo with a v0.2 collection imported.
