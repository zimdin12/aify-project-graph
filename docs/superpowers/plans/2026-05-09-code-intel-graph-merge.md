# Plan #3: Graph merge + freshness model (M3 + M3.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire imported v0.2 code-intel collections into APG's existing query verbs so agents see compiler-backed evidence with provenance, freshness, and the three-state result distinction. Add a code-intel collection manifest in storage so freshness can be reported separately from graph freshness.

**Architecture:**
- Storage adds a `code_intel_collections` table tracking which collections have been imported, against which `compile_db_hash`/`git_commit`, when, and with what per-operation status.
- `graph_health` adds a `codeIntel` block reporting availability, provider, freshness, and last collection.
- A new shared module `mcp/stdio/code-intel/query.js` exposes `getCodeIntelEvidenceForSymbol(db, symbolKey)` and `getCodeIntelDiagnosticsForFiles(db, files)` so verbs and the future `verify` mode (Plan #4) consume one canonical helper.
- `graph_pull` accepts an optional `code_intel` layer that includes defs/refs/hover/diagnostics for a queried symbol.
- `graph_change_plan` uses code-intel ref counts (when present) to rank affected files; tree-sitter occurrences appear as fallback `INFERRED` provenance.
- Three-state rendering: `found`, `not_found_after_retry`, `not_collected` — a shared helper formats consistent `EVIDENCE:` lines.

**Tech Stack:** Node.js 20+, ajv, better-sqlite3, vitest. No new runtime deps.

**Plan series:** #3 of 6. Depends on Plans #1 + #2.

---

## File Structure

**Create:**
- `mcp/stdio/code-intel/query.js` — query helpers reading from `code_intel_records` + `code_intel_collections`.
- `mcp/stdio/code-intel/render.js` — three-state evidence rendering helpers.
- `tests/unit/code-intel/query.test.js`
- `tests/unit/code-intel/render.test.js`
- `tests/unit/query/health-code-intel.test.js`
- `tests/unit/query/pull-code-intel.test.js`
- `tests/unit/query/change-plan-code-intel.test.js`

**Modify:**
- `mcp/stdio/storage/schema.js` — add `code_intel_collections` table.
- `mcp/stdio/ingest/code-intel/importer.js` — record a collection row when ingesting a v0.2 envelope.
- `mcp/stdio/query/verbs/health.js` — add `codeIntel` section to the response.
- `mcp/stdio/query/verbs/pull.js` — add `code_intel` layer (opt-in via layers param).
- `mcp/stdio/query/verbs/change_plan.js` — use code-intel refs for ranking when present.

---

## Task 1: Storage — `code_intel_collections` table

**Files:**
- Modify: `mcp/stdio/storage/schema.js`
- Create: `tests/unit/storage/code-intel-collections.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureCodeIntelCollectionsTable } from '../../../mcp/stdio/storage/schema.js';

describe('code_intel_collections', () => {
  it('creates the table idempotently', () => {
    const db = new Database(':memory:');
    ensureCodeIntelCollectionsTable(db);
    ensureCodeIntelCollectionsTable(db);
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='code_intel_collections'").get();
    expect(row?.name).toBe('code_intel_collections');
  });

  it('accepts a row with provider, status, freshness, operations json', () => {
    const db = new Database(':memory:');
    ensureCodeIntelCollectionsTable(db);
    db.prepare(`
      INSERT INTO code_intel_collections
        (collection_id, provider, provider_version, project_root, language, status,
         freshness_basis, freshness_value, compile_db_hash, indexed_commit,
         operations_json, collected_at, errors_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ci-1', 'cpp-clangd', '0.1.0', '/r', 'cpp', 'ok',
      'compile_db_hash', 'abc123', 'abc123', 'deadbeef',
      JSON.stringify({ definitions: { status: 'ok', count: 1 } }),
      '2026-05-09T12:00:00Z', null
    );
    const row = db.prepare('SELECT * FROM code_intel_collections WHERE collection_id=?').get('ci-1');
    expect(row.provider).toBe('cpp-clangd');
    expect(row.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/storage/code-intel-collections.test.js`
Expected: FAIL — `ensureCodeIntelCollectionsTable is not a function`.

- [ ] **Step 3: Add the table**

In `mcp/stdio/storage/schema.js`, add an exported function (and call it from the existing schema-creation entry point):

```js
const codeIntelCollectionsTable = `
  CREATE TABLE IF NOT EXISTS code_intel_collections (
    collection_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_version TEXT NOT NULL,
    project_root TEXT NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL,
    freshness_basis TEXT,
    freshness_value TEXT,
    compile_db_hash TEXT,
    indexed_commit TEXT,
    operations_json TEXT,
    collected_at TEXT NOT NULL,
    errors_json TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS code_intel_collections_provider_idx ON code_intel_collections(provider);
  CREATE INDEX IF NOT EXISTS code_intel_collections_collected_idx ON code_intel_collections(collected_at);
`;

export function ensureCodeIntelCollectionsTable(db) {
  db.exec(codeIntelCollectionsTable);
}
```

Wire `ensureCodeIntelCollectionsTable(db)` into the existing migrations entry point alongside `ensureCodeIntelRecordsTable` (added in Plan #1).

- [ ] **Step 4: Run tests, verify pass, commit**

Run: `npx vitest run tests/unit/storage/code-intel-collections.test.js`
Expected: PASS, 2/2.

```bash
git add mcp/stdio/storage/schema.js tests/unit/storage/code-intel-collections.test.js
git commit -m "feat(storage): add code_intel_collections table for freshness tracking"
```

---

## Task 2: Importer records collections

**Files:**
- Modify: `mcp/stdio/ingest/code-intel/importer.js`
- Create: `tests/unit/ingest/code-intel/importer-collections.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../../mcp/stdio/ingest/code-intel/importer.js';

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/code-intel/v02', name), 'utf8'));
}

describe('importer records collections', () => {
  it('inserts a code_intel_collections row when ingesting a v0.2 envelope', () => {
    const tmp = path.join(os.tmpdir(), `apg-cic-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(loadFixture('cpp-basic-collection.json')));
    const db = openDb(':memory:');
    const stats = importCodeIntel(tmp, db);
    expect(stats.collectionId).toMatch(/^ci-/);
    const row = db.prepare('SELECT * FROM code_intel_collections WHERE collection_id=?').get(stats.collectionId);
    expect(row).toBeTruthy();
    expect(row.provider).toBe('cpp-clangd');
    expect(row.status).toBe('ok');
    const ops = JSON.parse(row.operations_json);
    expect(ops.definitions.status).toBe('ok');
  });

  it('records partial-status collections with operations json', () => {
    const tmp = path.join(os.tmpdir(), `apg-cic-${Date.now()}-p.json`);
    fs.writeFileSync(tmp, JSON.stringify(loadFixture('cpp-partial-collection.json')));
    const db = openDb(':memory:');
    const stats = importCodeIntel(tmp, db);
    const row = db.prepare('SELECT * FROM code_intel_collections WHERE collection_id=?').get(stats.collectionId);
    expect(row.status).toBe('partial');
    const ops = JSON.parse(row.operations_json);
    expect(ops.references.status).toBe('partial');
    expect(ops.references.notCollectedFiles).toContain('src/baz.cpp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ingest/code-intel/importer-collections.test.js`
Expected: FAIL — collection row not inserted.

- [ ] **Step 3: Modify importer to insert the row**

In `mcp/stdio/ingest/code-intel/importer.js`, inside `importV02Collection(envelope, db, options)` (added in Plan #1), insert before the records loop:

```js
const collectionInsert = db.prepare(`
  INSERT OR REPLACE INTO code_intel_collections
    (collection_id, provider, provider_version, project_root, language, status,
     freshness_basis, freshness_value, compile_db_hash, indexed_commit,
     operations_json, collected_at, errors_json)
  VALUES (@collection_id, @provider, @provider_version, @project_root, @language, @status,
          @freshness_basis, @freshness_value, @compile_db_hash, @indexed_commit,
          @operations_json, @collected_at, @errors_json)
`);
const firstRecord = envelope.records?.[0];
collectionInsert.run({
  collection_id: envelope.collectionId,
  provider: envelope.provider,
  provider_version: envelope.providerVersion,
  project_root: envelope.projectRoot,
  language: firstRecord?.language || envelope.records?.[0]?.language || 'unknown',
  status: envelope.status,
  freshness_basis: envelope.session?.freshnessBasis ?? null,
  freshness_value: envelope.session?.freshnessValue ?? envelope.session?.compileDbHash ?? null,
  compile_db_hash: envelope.session?.compileDbHash ?? null,
  indexed_commit: envelope.session?.indexedCommit ?? null,
  operations_json: JSON.stringify(envelope.operations || {}),
  collected_at: envelope.session?.collectedAt ?? new Date().toISOString(),
  errors_json: envelope.errors ? JSON.stringify(envelope.errors) : null
});
```

Also call `ensureCodeIntelCollectionsTable(db)` at the top of `importV02Collection` (idempotent).

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run tests/unit/ingest/code-intel/`
Expected: PASS, all tests including the 2 new ones.

```bash
git add mcp/stdio/ingest/code-intel/importer.js tests/unit/ingest/code-intel/importer-collections.test.js
git commit -m "feat(code-intel): record collection rows on import for freshness tracking"
```

---

## Task 3: Three-state rendering helper

**Files:**
- Create: `mcp/stdio/code-intel/render.js`
- Create: `tests/unit/code-intel/render.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest';
import {
  renderEvidenceLine,
  formatProvenanceTag,
  formatThreeStateRefs
} from '../../../mcp/stdio/code-intel/render.js';

describe('render helpers', () => {
  it('renders provenance tag', () => {
    expect(formatProvenanceTag({ kind: 'reference', confidence: 'high', provenance: 'cpp-clangd@0.1.0' })).toBe('CODE_INTEL');
    expect(formatProvenanceTag({ kind: 'reference', provenance: 'tree-sitter' })).toBe('EXTRACTED');
    expect(formatProvenanceTag({ kind: 'reference', provenance: 'text-search', confidence: 'low' })).toBe('INFERRED');
    expect(formatProvenanceTag({ kind: 'overlay' })).toBe('OVERLAY');
  });

  it('formats found refs', () => {
    const out = formatThreeStateRefs({ state: 'found', count: 5, providerStatus: 'ok' });
    expect(out).toMatch(/found/);
    expect(out).toMatch(/5/);
  });

  it('formats not_found_after_retry distinctly from not_collected', () => {
    const found = formatThreeStateRefs({ state: 'not_found_after_retry', count: 0, providerStatus: 'ok' });
    expect(found).toMatch(/not_found_after_retry/);
    const notColl = formatThreeStateRefs({ state: 'not_collected', count: 0, providerStatus: 'partial', reason: 'partial_batch' });
    expect(notColl).toMatch(/not_collected/);
    expect(notColl).not.toMatch(/not_found_after_retry/);
  });

  it('renders a compact EVIDENCE line for unavailable code-intel', () => {
    const line = renderEvidenceLine({ available: false, reason: 'provider_missing' });
    expect(line).toMatch(/code_intel unavailable/);
    expect(line).toMatch(/provider_missing/);
  });

  it('renders an EVIDENCE line for partial state', () => {
    const line = renderEvidenceLine({
      available: true,
      provider: 'cpp-clangd',
      providerVersion: '0.1.0',
      operations: { definitions: { status: 'ok', count: 3 }, references: { status: 'partial', count: 2, notCollectedFiles: ['src/x.cpp'] } },
      status: 'partial'
    });
    expect(line).toMatch(/partial/);
    expect(line).toMatch(/references/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/code-intel/render.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`mcp/stdio/code-intel/render.js`:

```js
export function formatProvenanceTag(record) {
  if (!record) return 'UNKNOWN';
  if (record.kind === 'overlay' || record.provenance === 'overlay') return 'OVERLAY';
  if (record.provenance === 'text-search' || record.confidence === 'low') return 'INFERRED';
  if (record.provenance === 'tree-sitter' || record.provenance === 'extract') return 'EXTRACTED';
  if (typeof record.provenance === 'string' && record.provenance.includes('@')) return 'CODE_INTEL';
  return 'EXTRACTED';
}

export function formatThreeStateRefs({ state, count = 0, providerStatus = 'ok', reason = '' }) {
  if (state === 'found') return `found (${count}, provider=${providerStatus})`;
  if (state === 'not_found_after_retry') return `not_found_after_retry (provider=${providerStatus})`;
  if (state === 'not_collected') return `not_collected${reason ? ` (${reason})` : ''}`;
  return `unknown (${state})`;
}

export function renderEvidenceLine(input) {
  if (!input || input.available === false) {
    const reason = input?.reason || 'provider_missing';
    return `EVIDENCE: tree-sitter+overlay only; code_intel unavailable (${reason}: install clangd or set --no-code-intel to silence)`;
  }
  const parts = [];
  parts.push(`provider=${input.provider}@${input.providerVersion}`);
  parts.push(`status=${input.status}`);
  if (input.operations) {
    const opSummary = Object.entries(input.operations).map(([op, info]) =>
      `${op}=${info.status}${info.count != null ? `(${info.count})` : ''}${info.notCollectedFiles?.length ? `[notCollected:${info.notCollectedFiles.length}]` : ''}`
    ).join(' ');
    parts.push(opSummary);
  }
  return `EVIDENCE: ${parts.join('; ')}`;
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add mcp/stdio/code-intel/render.js tests/unit/code-intel/render.test.js
git commit -m "feat(code-intel): add three-state result + provenance rendering helpers"
```

---

## Task 4: Code-intel query helpers

**Files:**
- Create: `mcp/stdio/code-intel/query.js`
- Create: `tests/unit/code-intel/query.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import {
  getCodeIntelEvidenceForSymbol,
  getCodeIntelDiagnosticsForFiles,
  getLatestCollection
} from '../../../mcp/stdio/code-intel/query.js';

const fixtureRepo = path.resolve('tests/fixtures/code-intel/v02');

function importFixture(db, name) {
  const tmp = path.join(os.tmpdir(), `apg-q-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(fixtureRepo, name), 'utf8'));
  return importCodeIntel(tmp, db);
}

describe('code-intel query helpers', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns latest collection metadata', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const latest = getLatestCollection(db);
    expect(latest).toBeTruthy();
    expect(latest.provider).toBe('cpp-clangd');
    expect(latest.status).toBe('ok');
  });

  it('finds defs/refs for a symbol qname', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const evidence = getCodeIntelEvidenceForSymbol(db, { qname: 'ns::foo(int)' });
    expect(evidence.found).toBe(true);
    expect(evidence.definitions.length).toBe(1);
    expect(evidence.references.length).toBe(1);
    expect(evidence.references[0].file).toBe('src/bar.cpp');
  });

  it('returns found=false when symbol is unknown', () => {
    importFixture(db, 'cpp-basic-collection.json');
    const evidence = getCodeIntelEvidenceForSymbol(db, { qname: 'unknown::sym' });
    expect(evidence.found).toBe(false);
    expect(evidence.definitions.length).toBe(0);
  });

  it('returns diagnostics for queried files when present', () => {
    // partial fixture has no diagnostic records, so we just assert empty
    importFixture(db, 'cpp-partial-collection.json');
    const diags = getCodeIntelDiagnosticsForFiles(db, ['src/bar.cpp']);
    expect(Array.isArray(diags)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/code-intel/query.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`mcp/stdio/code-intel/query.js`:

```js
function rowToRecord(row) {
  let raw = {};
  try { raw = JSON.parse(row.raw); } catch { /* ignore */ }
  return {
    kind: row.kind,
    language: row.language,
    symbolId: row.symbol_id,
    qname: row.qname,
    file: row.file,
    range: raw.range,
    confidence: row.confidence,
    provenance: row.provenance,
    result_state: row.result_state,
    collectionId: row.collection_id,
    raw
  };
}

export function getLatestCollection(db, opts = {}) {
  const lang = opts.language;
  const sql = lang
    ? `SELECT * FROM code_intel_collections WHERE language=? ORDER BY collected_at DESC LIMIT 1`
    : `SELECT * FROM code_intel_collections ORDER BY collected_at DESC LIMIT 1`;
  const stmt = db.prepare(sql);
  const row = lang ? stmt.get(lang) : stmt.get();
  if (!row) return null;
  let operations = {};
  try { operations = JSON.parse(row.operations_json || '{}'); } catch { /* ignore */ }
  return {
    collectionId: row.collection_id,
    provider: row.provider,
    providerVersion: row.provider_version,
    projectRoot: row.project_root,
    language: row.language,
    status: row.status,
    freshnessBasis: row.freshness_basis,
    freshnessValue: row.freshness_value,
    compileDbHash: row.compile_db_hash,
    indexedCommit: row.indexed_commit,
    operations,
    collectedAt: row.collected_at,
    importedAt: row.imported_at
  };
}

export function getCodeIntelEvidenceForSymbol(db, { qname, symbolId } = {}) {
  if (!qname && !symbolId) {
    return { found: false, definitions: [], references: [], hovers: [], summary: { definitions: 0, references: 0, hovers: 0 } };
  }
  const conditions = [];
  const params = [];
  if (symbolId) { conditions.push('symbol_id = ?'); params.push(symbolId); }
  if (qname) { conditions.push('qname = ?'); params.push(qname); }
  const where = conditions.join(' OR ');
  const rows = db.prepare(`SELECT * FROM code_intel_records WHERE ${where}`).all(...params);
  const definitions = rows.filter(r => r.kind === 'definition').map(rowToRecord);
  const references = rows.filter(r => r.kind === 'reference').map(rowToRecord);
  const hovers = rows.filter(r => r.kind === 'hover').map(rowToRecord);
  return {
    found: definitions.length > 0 || references.length > 0,
    definitions,
    references,
    hovers,
    summary: { definitions: definitions.length, references: references.length, hovers: hovers.length }
  };
}

export function getCodeIntelDiagnosticsForFiles(db, files) {
  if (!files || files.length === 0) return [];
  const placeholders = files.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM code_intel_records WHERE kind='diagnostic' AND file IN (${placeholders}) ORDER BY range_start_line`).all(...files);
  return rows.map(rowToRecord);
}
```

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run tests/unit/code-intel/query.test.js`
Expected: PASS, 4/4.

```bash
git add mcp/stdio/code-intel/query.js tests/unit/code-intel/query.test.js
git commit -m "feat(code-intel): add query helpers for symbol evidence + diagnostics + latest collection"
```

---

## Task 5: `graph_health` reports `codeIntel`

**Files:**
- Modify: `mcp/stdio/query/verbs/health.js`
- Create: `tests/unit/query/health-code-intel.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-h-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  return { dir, graphDir, dbPath };
}

describe('graph_health.codeIntel', () => {
  it('reports codeIntel.available=false when no collection exists', async () => {
    const { dir } = setupRepo();
    const result = await graphHealth({ repoRoot: dir });
    expect(result.codeIntel.available).toBe(false);
    expect(result.codeIntel.reason).toBe('no_collection');
  });

  it('reports codeIntel.available=true after a collection import', async () => {
    const { dir, dbPath } = setupRepo();
    const tmp = path.join(os.tmpdir(), `apg-h-ci-${Date.now()}.json`);
    fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
    const db = openExistingDb(dbPath);
    importCodeIntel(tmp, db);
    db.close();
    const result = await graphHealth({ repoRoot: dir });
    expect(result.codeIntel.available).toBe(true);
    expect(result.codeIntel.provider).toBe('cpp-clangd');
    expect(result.codeIntel.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run tests/unit/query/health-code-intel.test.js`
Expected: FAIL — `result.codeIntel` is undefined.

- [ ] **Step 3: Add `codeIntel` block to `graphHealth`**

In `mcp/stdio/query/verbs/health.js`, after the existing health computation (and before the final return), add:

```js
import { getLatestCollection } from '../../code-intel/query.js';

// ... inside graphHealth, after we open db successfully:
let codeIntel = { available: false, reason: 'no_collection' };
try {
  const db = openExistingDb(dbPath);
  try {
    const latest = getLatestCollection(db);
    if (latest) {
      codeIntel = {
        available: true,
        provider: latest.provider,
        providerVersion: latest.providerVersion,
        status: latest.status,
        language: latest.language,
        freshnessBasis: latest.freshnessBasis,
        freshnessValue: latest.freshnessValue,
        compileDbHash: latest.compileDbHash,
        indexedCommit: latest.indexedCommit,
        collectedAt: latest.collectedAt,
        operations: latest.operations
      };
    }
  } finally { db.close(); }
} catch { /* leave codeIntel as not-available */ }
```

Add `codeIntel` to the returned object.

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run tests/unit/query/health-code-intel.test.js`
Expected: PASS, 2/2.

Run also: `npx vitest run tests/unit/query/`
Expected: no regressions on existing health tests.

```bash
git add mcp/stdio/query/verbs/health.js tests/unit/query/health-code-intel.test.js
git commit -m "feat(query): graph_health reports codeIntel availability + freshness"
```

---

## Task 6: `graph_pull` exposes `code_intel` layer

**Files:**
- Modify: `mcp/stdio/query/verbs/pull.js`
- Create: `tests/unit/query/pull-code-intel.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';

function setupRepoWithCollection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pull-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  const tmp = path.join(os.tmpdir(), `apg-pull-${Date.now()}.json`);
  fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
  const db2 = openExistingDb(dbPath);
  importCodeIntel(tmp, db2);
  db2.close();
  return dir;
}

describe('graph_pull code_intel layer', () => {
  it('returns code_intel evidence for a known qname when layer is requested', async () => {
    const dir = setupRepoWithCollection();
    const result = await graphPull({ repoRoot: dir, node: 'ns::foo(int)', layers: ['code_intel'] });
    expect(result.code_intel).toBeTruthy();
    expect(result.code_intel.found).toBe(true);
    expect(result.code_intel.definitions.length).toBe(1);
    expect(result.code_intel.references.length).toBe(1);
  });

  it('omits code_intel when layer not requested', async () => {
    const dir = setupRepoWithCollection();
    const result = await graphPull({ repoRoot: dir, node: 'ns::foo(int)', layers: ['code'] });
    expect(result.code_intel).toBeUndefined();
  });

  it('returns code_intel.found=false for unknown symbols', async () => {
    const dir = setupRepoWithCollection();
    const result = await graphPull({ repoRoot: dir, node: 'unknown::sym', layers: ['code_intel'] });
    expect(result.code_intel.found).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run tests/unit/query/pull-code-intel.test.js`
Expected: FAIL — `code_intel` not present.

- [ ] **Step 3: Modify `graph_pull`**

In `mcp/stdio/query/verbs/pull.js`:

1. Add `'code_intel'` to `ALL_LAYERS`.
2. Import `getCodeIntelEvidenceForSymbol` from `../../code-intel/query.js`.
3. After computing the layer set, if `code_intel` is requested, compute:

```js
import { getCodeIntelEvidenceForSymbol } from '../../code-intel/query.js';

// inside graphPull, after layers computed:
if (resolvedLayers.has('code_intel')) {
  try {
    const db = openExistingDb(dbPath);
    try {
      const evidence = getCodeIntelEvidenceForSymbol(db, { qname: String(node) });
      result.code_intel = evidence;
    } finally { db.close(); }
  } catch { result.code_intel = { found: false, definitions: [], references: [], hovers: [], summary: { definitions: 0, references: 0, hovers: 0 } }; }
}
```

`code_intel` should NOT be in `DEFAULT_LAYERS` — it is explicit opt-in to keep token budget controlled.

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run tests/unit/query/pull-code-intel.test.js`
Expected: PASS.

Run: `npx vitest run tests/unit/query/`
Expected: no regressions.

```bash
git add mcp/stdio/query/verbs/pull.js tests/unit/query/pull-code-intel.test.js
git commit -m "feat(query): graph_pull exposes opt-in code_intel layer"
```

---

## Task 7: `graph_change_plan` uses code-intel ranking when present

**Files:**
- Modify: `mcp/stdio/query/verbs/change_plan.js`
- Create: `tests/unit/query/change-plan-code-intel.test.js`

- [ ] **Step 1: Inspect current `change_plan` ranking**

Run: `grep -n "rank\|score\|sort" mcp/stdio/query/verbs/change_plan.js | head`

Identify the existing affected-files ranking step.

- [ ] **Step 2: Write failing test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { changePlan } from '../../../mcp/stdio/query/verbs/change_plan.js';

function setupRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cp-ci-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath);
  db.close();
  const tmp = path.join(os.tmpdir(), `apg-cp-${Date.now()}.json`);
  fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-basic-collection.json', 'utf8'));
  const db2 = openExistingDb(dbPath);
  importCodeIntel(tmp, db2);
  db2.close();
  return dir;
}

describe('change_plan code_intel ranking', () => {
  it('annotates affected-files items with provenance when code-intel evidence is available', async () => {
    const dir = setupRepo();
    const result = await changePlan({ repoRoot: dir, symbol: 'ns::foo(int)' });
    expect(result.affected).toBeTruthy();
    expect(Array.isArray(result.affected.items)).toBe(true);
    if (result.affected.items.length > 0) {
      const ciItem = result.affected.items.find(it => it.provenance === 'CODE_INTEL');
      expect(ciItem).toBeTruthy();
      expect(ciItem.file).toBe('src/bar.cpp');
    }
    expect(result.code_intel_used).toBe(true);
  });

  it('falls back gracefully when no code-intel evidence is present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cp-empty-'));
    const graphDir = path.join(dir, '.aify-graph');
    mkdirSync(graphDir, { recursive: true });
    const dbPath = path.join(graphDir, 'graph.sqlite');
    const db = openDb(dbPath);
    db.close();
    const result = await changePlan({ repoRoot: dir, symbol: 'unknown::sym' });
    expect(result.code_intel_used).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run tests/unit/query/change-plan-code-intel.test.js`
Expected: FAIL.

- [ ] **Step 3: Modify `change_plan` to consult code-intel refs**

In `mcp/stdio/query/verbs/change_plan.js`, near the top:

```js
import { getCodeIntelEvidenceForSymbol } from '../../code-intel/query.js';
import { openExistingDb } from '../../storage/db.js';
```

Inside `changePlan(...)`, before/around the existing affected-files compute:

```js
let codeIntelUsed = false;
let codeIntelItems = [];
try {
  const db = openExistingDb(dbPath);
  try {
    const evidence = getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) });
    if (evidence.found) {
      codeIntelUsed = true;
      const seen = new Set();
      for (const r of evidence.references) {
        if (r.file && !seen.has(r.file)) {
          seen.add(r.file);
          codeIntelItems.push({ file: r.file, provenance: 'CODE_INTEL', confidence: r.confidence || 'high' });
        }
      }
    }
  } finally { db.close(); }
} catch { /* fall back */ }
```

When merging into the response, prepend `codeIntelItems` to the existing items list (deduplicated by file), tagging tree-sitter-only items with `provenance: 'EXTRACTED'`. Add `code_intel_used: codeIntelUsed` to the result.

If the existing change_plan response shape is different (e.g., uses a flat `affected` array directly), adapt: ensure (a) compiler-backed items are first, (b) every item has a `provenance` field, (c) `code_intel_used` is exposed at the top level.

- [ ] **Step 4: Run tests, commit**

Run: `npx vitest run tests/unit/query/change-plan-code-intel.test.js`
Expected: PASS.

Run: `npx vitest run tests/unit/query/`
Expected: no regressions.

```bash
git add mcp/stdio/query/verbs/change_plan.js tests/unit/query/change-plan-code-intel.test.js
git commit -m "feat(query): graph_change_plan ranks affected files using code-intel refs when present"
```

---

## Task 8: Full regression sweep + tag

- [ ] **Step 1: Run full unit suite**

Run: `npx vitest run tests/unit/`
Expected: PASS, no regressions.

- [ ] **Step 2: Tag**

```bash
git tag plan-3-graph-merge-complete
```

---

## Acceptance summary

After Plan #3:

- Imported v0.2 collections create rows in `code_intel_collections`, surfaced as `graph_health.codeIntel`.
- `graph_pull` exposes an opt-in `code_intel` layer with defs/refs/hovers for a queried symbol.
- `graph_change_plan` uses code-intel reference counts to rank affected files when present, with explicit `provenance` tags (`CODE_INTEL` / `EXTRACTED`) and a `code_intel_used` boolean.
- Three-state result rendering helpers (`formatThreeStateRefs`, `renderEvidenceLine`, `formatProvenanceTag`) ready for Plan #4 packet integration.
- Zero regressions on pre-existing query tests.

This is the unblock for Plan #4 (packet v2 + verify mode + fact budget), which consumes `getCodeIntelEvidenceForSymbol`, `getCodeIntelDiagnosticsForFiles`, and `getLatestCollection` for the new evidence-enriched packet output.
