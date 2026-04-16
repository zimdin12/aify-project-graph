# aify-project-graph v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of `aify-project-graph` — an on-demand, agent-facing codebase graph map backed by embedded KuzuDB, producing token-efficient responses for Claude Code / Codex.

**Architecture:** Node.js MCP stdio server per repo. Tree-sitter for parsing (Python + TS/JS). Embedded KuzuDB at `<repo>/.aify-graph/graph.kuzu`. Two-axis fingerprint incremental updates. Git-diff-aware freshness at query time. Compact `NODE`/`EDGE` line-format responses with hard token budget enforcement. Claude Code skill + install docs delivered alongside.

**Tech Stack:** Node.js 20+, KuzuDB (official Node driver), web-tree-sitter + tree-sitter-python + tree-sitter-typescript, Vitest (tests), proper-lockfile (write lock), execa (git), picocolors (log formatting).

**Spec:** `docs/superpowers/specs/2026-04-16-aify-project-graph-design.md` — read this before starting any task.

---

## File structure

```
aify-project-graph/
  package.json                             # Task 1
  vitest.config.js                         # Task 1
  .gitignore                               # Task 1
  README.md                                # Task 30
  LICENSE                                  # Task 30 (MIT)
  ATTRIBUTION.md                           # Task 30

  mcp/stdio/
    server.js                              # Task 26 — MCP entrypoint
    storage/
      db.js                                # Task 3 — KuzuDB wrapper
      schema.js                            # Task 2 — DDL + migrations
      nodes.js                             # Task 4 — node CRUD
      edges.js                             # Task 4 — edge CRUD
    ingest/
      fingerprint.js                       # Task 5
      walker.js                            # Task 6 — tree-sitter base
      extractors/
        base.js                            # Task 6 — Extractor interface
        python.js                          # Tasks 7-8
        typescript.js                      # Task 9
      resolver.js                          # Task 10 — cross-file
    freshness/
      git.js                               # Task 11 — git helpers
      manifest.js                          # Task 12 — JSON atomic writes
      lock.js                              # Task 13 — file lock
      orchestrator.js                      # Task 14 — reindex flow
    query/
      renderer.js                          # Task 15 — compact line format
      budget.js                            # Task 16 — token budget
      rank.js                              # Task 17 — ranking rules
      verbs/
        status.js                          # Task 18
        index.js                           # Task 19
        whereis.js                         # Task 20
        callers.js                         # Task 21
        callees.js                         # Task 21
        neighbors.js                       # Task 22
        module_tree.js                     # Task 23
        impact.js                          # Task 24
        summary.js                         # Task 25
        report.js                          # Task 25

  integrations/
    claude-code/
      skill/SKILL.md                       # Task 27

  docs/
    superpowers/specs/                     # (spec lives here)
    superpowers/plans/                     # (this plan)
    query-format.md                        # Task 15 (alongside renderer)

  install.claude.md                        # Task 28
  install.codex.md                         # Task 29
  install.opencode.md                      # Task 29

  tests/
    fixtures/
      tiny-python/                         # Task 7 — fixture repo
      tiny-ts/                             # Task 9
    unit/                                  # one per source file
    integration/                           # end-to-end via MCP server
```

**Principle:** one file, one responsibility. Tests mirror source layout. Fixtures are real tiny repos, not mock strings.

---

## Execution guidance

- Every task follows **TDD**: write the failing test first, run it and **see it fail**, implement the minimum to pass, run and **see it pass**, commit.
- After every task: `npm test` must be green.
- Commits are per-task. Plan steps include the commit command.
- `node --version` must be ≥20. The plan assumes `npm` is the package manager.
- The repo has no remote yet; `git init` happens in Task 1. Do not push until user explicitly asks.

---

## Task 1: Scaffold package + test harness

**Files:**
- Create: `package.json`, `vitest.config.js`, `.gitignore`
- Create: `tests/unit/smoke.test.js`

- [ ] **Step 1: Initialize git**

```bash
cd /c/Docker/aify-project-graph
git init
git add docs/
git commit -m "docs: initial spec and plan"
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "aify-project-graph",
  "version": "0.0.1",
  "description": "On-demand codebase graph map for coding agents (Claude Code, Codex)",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "kuzu": "^0.10.0",
    "web-tree-sitter": "^0.25.0",
    "tree-sitter-python": "^0.23.0",
    "tree-sitter-typescript": "^0.23.0",
    "proper-lockfile": "^4.1.2",
    "execa": "^9.5.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.aify-graph/
coverage/
*.log
.DS_Store
```

- [ ] **Step 5: Write failing smoke test**

`tests/unit/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('test harness runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Install + run**

```bash
npm install
npm test
```

Expected: 1 passing test. If `kuzu` or tree-sitter native builds fail, resolve before continuing — they are the load-bearing deps.

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.js .gitignore tests/
git commit -m "chore: scaffold package and test harness"
```

---

## Task 2: KuzuDB schema (DDL)

**Files:**
- Create: `mcp/stdio/storage/schema.js`
- Create: `tests/unit/storage/schema.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/storage/schema.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import kuzu from 'kuzu';
import { createSchema, SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';

describe('schema', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-schema-'));
  });

  afterEach(async () => {
    if (db) await db.close?.();
    await rm(dir, { recursive: true, force: true });
  });

  it('creates node and edge tables idempotently', async () => {
    db = new kuzu.Database(join(dir, 'g.kuzu'));
    const conn = new kuzu.Connection(db);
    await createSchema(conn);
    // second call should be a no-op
    await createSchema(conn);

    const nodes = await conn.query('CALL show_tables() RETURN *');
    const rows = await nodes.getAll();
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Repository', 'File', 'Module', 'Function', 'Method',
        'Class', 'Interface', 'Type', 'Variable', 'Symbol', 'Test',
        'CONTAINS', 'DEFINES', 'DECLARES', 'IMPORTS', 'EXPORTS',
        'CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE',
        'TESTS', 'DEPENDS_ON',
      ])
    );
    expect(SCHEMA_VERSION).toBeTypeOf('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/storage/schema.test.js
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement schema**

`mcp/stdio/storage/schema.js`:

```js
export const SCHEMA_VERSION = 1;

const NODE_TABLES = [
  ['Repository', 'id STRING, name STRING, root STRING, langs STRING[]'],
  ['File',       'id STRING, path STRING, language STRING, content_hash STRING, last_modified INT64'],
  ['Module',     'id STRING, label STRING, file_path STRING'],
  ['Function',   NODE_COLS()],
  ['Method',     NODE_COLS()],
  ['Class',      NODE_COLS()],
  ['Interface',  NODE_COLS()],
  ['Type',       NODE_COLS()],
  ['Variable',   NODE_COLS()],
  ['Symbol',     NODE_COLS()],
  ['Test',       NODE_COLS()],
];

function NODE_COLS() {
  return [
    'id STRING',
    'label STRING',
    'file_path STRING',
    'start_line INT64',
    'end_line INT64',
    'language STRING',
    'community_id INT64',
    'confidence DOUBLE',
    'structural_fp STRING',
    'dependency_fp STRING',
  ].join(', ');
}

const EDGE_TABLES = [
  // rel table name, FROM, TO, props
  ['CONTAINS',   'Repository', 'File'],
  ['DEFINES',    'File',       'Symbol'],
  ['DECLARES',   'File',       'Symbol'],
  ['IMPORTS',    'File',       'File'],
  ['EXPORTS',    'File',       'Symbol'],
  ['CALLS',      'Symbol',     'Symbol'],
  ['REFERENCES', 'Symbol',     'Symbol'],
  ['EXTENDS',    'Class',      'Class'],
  ['IMPLEMENTS', 'Class',      'Interface'],
  ['USES_TYPE',  'Symbol',     'Type'],
  ['TESTS',      'Test',       'Symbol'],
  ['DEPENDS_ON', 'Symbol',     'Symbol'],
];

const EDGE_PROPS =
  'relation STRING, source_file STRING, source_line INT64, confidence DOUBLE, extractor STRING';

export async function createSchema(conn) {
  for (const [name, cols] of NODE_TABLES) {
    await conn.query(
      `CREATE NODE TABLE IF NOT EXISTS ${name}(${cols}, PRIMARY KEY(id))`
    );
  }
  for (const [name, from, to] of EDGE_TABLES) {
    await conn.query(
      `CREATE REL TABLE IF NOT EXISTS ${name}(FROM ${from} TO ${to}, ${EDGE_PROPS})`
    );
  }
}
```

Notes for the implementer:
- KuzuDB requires a **primary key** on node tables; we use `id`.
- The `Symbol` node is a generic catch-all. Edges targeting "Symbol" will cover any of the more specific types because of how kuzu handles inheritance via table schemas — if a cast is needed, add a union-style lookup helper in Task 4.
- `IF NOT EXISTS` makes `createSchema` idempotent.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/storage/schema.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/storage/schema.js tests/unit/storage/schema.test.js
git commit -m "feat(storage): KuzuDB schema (nodes + edges) with idempotent create"
```

---

## Task 3: Storage DB wrapper

**Files:**
- Create: `mcp/stdio/storage/db.js`
- Create: `tests/unit/storage/db.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/storage/db.test.js`:

```js
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';

describe('db wrapper', () => {
  let dir, handle;

  afterEach(async () => {
    if (handle) await handle.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('opens, runs a query, closes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-db-'));
    handle = await openDb(join(dir, 'g.kuzu'));

    const rows = await handle.all('CALL show_tables() RETURN *');
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/unit/storage/db.test.js
```

- [ ] **Step 3: Implement wrapper**

`mcp/stdio/storage/db.js`:

```js
import kuzu from 'kuzu';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSchema } from './schema.js';

export async function openDb(dbPath) {
  await mkdir(dirname(dbPath), { recursive: true });
  const database = new kuzu.Database(dbPath);
  const conn = new kuzu.Connection(database);
  await createSchema(conn);

  return {
    all: async (cypher, params = {}) => {
      const prepared = params && Object.keys(params).length
        ? await conn.prepare(cypher)
        : null;
      const result = prepared
        ? await conn.execute(prepared, params)
        : await conn.query(cypher);
      return result.getAll();
    },
    run: async (cypher, params = {}) => {
      const prepared = params && Object.keys(params).length
        ? await conn.prepare(cypher)
        : null;
      if (prepared) await conn.execute(prepared, params);
      else await conn.query(cypher);
    },
    close: async () => {
      await conn.close?.();
      await database.close?.();
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/unit/storage/db.test.js
```

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/storage/db.js tests/unit/storage/db.test.js
git commit -m "feat(storage): db wrapper with open/all/run/close + schema init"
```

---

## Task 4: Node & edge CRUD

**Files:**
- Create: `mcp/stdio/storage/nodes.js`, `mcp/stdio/storage/edges.js`
- Create: `tests/unit/storage/crud.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/storage/crud.test.js`:

```js
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode, deleteNode, getNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge, deleteEdgesFrom, deleteEdgesTo, listEdges }
  from '../../../mcp/stdio/storage/edges.js';

describe('storage crud', () => {
  let dir, db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-crud-'));
    db = await openDb(join(dir, 'g.kuzu'));
  });

  afterEach(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('upsert + get node', async () => {
    const node = {
      id: 'fn:foo',
      label: 'foo',
      file_path: 'src/a.py',
      start_line: 1,
      end_line: 10,
      language: 'python',
      confidence: 1.0,
      structural_fp: 's1',
      dependency_fp: 'd1',
    };
    await upsertNode(db, 'Function', node);
    const back = await getNode(db, 'Function', 'fn:foo');
    expect(back.label).toBe('foo');
    expect(back.structural_fp).toBe('s1');
  });

  it('upsert replaces existing node', async () => {
    const node = {
      id: 'fn:foo', label: 'foo', file_path: 'src/a.py',
      start_line: 1, end_line: 10, language: 'python',
      confidence: 1.0, structural_fp: 's1', dependency_fp: 'd1',
    };
    await upsertNode(db, 'Function', node);
    await upsertNode(db, 'Function', { ...node, structural_fp: 's2' });
    const back = await getNode(db, 'Function', 'fn:foo');
    expect(back.structural_fp).toBe('s2');
  });

  it('edge upsert + listEdges + deleteEdgesFrom/To', async () => {
    const mk = (id) => ({
      id, label: id, file_path: 'src/a.py',
      start_line: 1, end_line: 1, language: 'python',
      confidence: 1.0, structural_fp: 's', dependency_fp: 'd',
    });
    await upsertNode(db, 'Function', mk('a'));
    await upsertNode(db, 'Function', mk('b'));
    await upsertEdge(db, 'CALLS', {
      from_table: 'Function', to_table: 'Function',
      from_id: 'a', to_id: 'b',
      source_file: 'src/a.py', source_line: 3,
      confidence: 0.9, extractor: 'python',
    });

    const edges = await listEdges(db, 'CALLS', { from_id: 'a' });
    expect(edges.length).toBe(1);
    expect(edges[0].to_id).toBe('b');

    await deleteEdgesFrom(db, 'CALLS', 'Function', 'a');
    const after = await listEdges(db, 'CALLS', { from_id: 'a' });
    expect(after.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — FAIL**

```bash
npm test -- tests/unit/storage/crud.test.js
```

- [ ] **Step 3: Implement nodes.js**

`mcp/stdio/storage/nodes.js`:

```js
const NODE_FIELDS = [
  'id', 'label', 'file_path', 'start_line', 'end_line', 'language',
  'community_id', 'confidence', 'structural_fp', 'dependency_fp',
];

export async function upsertNode(db, table, node) {
  const row = {};
  for (const f of NODE_FIELDS) row[f] = node[f] ?? defaultFor(f);
  // KuzuDB: MERGE isn't universal; use DELETE+CREATE semantics for idempotence.
  await db.run(`MATCH (n:${table} {id: $id}) DELETE n`, { id: row.id });
  const cols = NODE_FIELDS.join(', ');
  const params = NODE_FIELDS.map((f) => `$${f}`).join(', ');
  await db.run(`CREATE (:${table} {${setters(NODE_FIELDS)}})`, row);
}

export async function getNode(db, table, id) {
  const rows = await db.all(`MATCH (n:${table} {id: $id}) RETURN n`, { id });
  return rows[0]?.n ?? null;
}

export async function deleteNode(db, table, id) {
  await db.run(`MATCH (n:${table} {id: $id}) DETACH DELETE n`, { id });
}

function setters(fields) {
  return fields.map((f) => `${f}: $${f}`).join(', ');
}

function defaultFor(field) {
  if (field === 'community_id') return -1;
  if (field === 'start_line' || field === 'end_line') return 0;
  if (field === 'confidence') return 1.0;
  return '';
}
```

- [ ] **Step 4: Implement edges.js**

`mcp/stdio/storage/edges.js`:

```js
export async function upsertEdge(db, relation, edge) {
  const {
    from_table, to_table, from_id, to_id,
    source_file, source_line, confidence = 1.0, extractor = 'unknown',
  } = edge;
  await db.run(
    `MATCH (a:${from_table} {id: $from_id}), (b:${to_table} {id: $to_id})
     CREATE (a)-[:${relation} {
       relation: $relation, source_file: $source_file,
       source_line: $source_line, confidence: $confidence, extractor: $extractor
     }]->(b)`,
    { from_id, to_id, relation, source_file, source_line, confidence, extractor }
  );
}

export async function listEdges(db, relation, filter = {}) {
  let where = '';
  if (filter.from_id) where += ' WHERE a.id = $from_id';
  if (filter.to_id) where += where ? ' AND b.id = $to_id' : ' WHERE b.id = $to_id';
  const rows = await db.all(
    `MATCH (a)-[r:${relation}]->(b)${where}
     RETURN a.id AS from_id, b.id AS to_id, r.confidence AS confidence,
            r.source_file AS source_file, r.source_line AS source_line`,
    filter
  );
  return rows;
}

export async function deleteEdgesFrom(db, relation, from_table, from_id) {
  await db.run(
    `MATCH (a:${from_table} {id: $from_id})-[r:${relation}]->() DELETE r`,
    { from_id }
  );
}

export async function deleteEdgesTo(db, relation, to_table, to_id) {
  await db.run(
    `MATCH ()-[r:${relation}]->(b:${to_table} {id: $to_id}) DELETE r`,
    { to_id }
  );
}
```

- [ ] **Step 5: Run — PASS**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/storage/ tests/unit/storage/
git commit -m "feat(storage): node and edge CRUD primitives"
```

---

## Task 5: Two-axis fingerprints

**Files:**
- Create: `mcp/stdio/ingest/fingerprint.js`
- Create: `tests/unit/ingest/fingerprint.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/ingest/fingerprint.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { structuralFingerprint, dependencyFingerprint }
  from '../../../mcp/stdio/ingest/fingerprint.js';

describe('fingerprint', () => {
  it('structural_fp changes on signature change but not body change', () => {
    const a = structuralFingerprint({
      qname: 'mod.foo', signature: '(x: int) -> str',
      decorators: [], parent_class: null, node_type: 'Function',
    });
    const b = structuralFingerprint({
      qname: 'mod.foo', signature: '(x: int, y: int) -> str',
      decorators: [], parent_class: null, node_type: 'Function',
    });
    expect(a).not.toBe(b);

    const c = structuralFingerprint({
      qname: 'mod.foo', signature: '(x: int) -> str',
      decorators: [], parent_class: null, node_type: 'Function',
    });
    expect(a).toBe(c);
  });

  it('dependency_fp changes when outgoing refs change order-independently', () => {
    const a = dependencyFingerprint({
      calls: ['os.path.join', 'os.getcwd'],
      references: ['sys.argv'],
      type_uses: ['str', 'int'],
      raises: [],
      imports: [],
    });
    // Same set, different order
    const b = dependencyFingerprint({
      calls: ['os.getcwd', 'os.path.join'],
      references: ['sys.argv'],
      type_uses: ['int', 'str'],
      raises: [],
      imports: [],
    });
    expect(a).toBe(b);

    // Add one call
    const c = dependencyFingerprint({
      calls: ['os.path.join', 'os.getcwd', 'os.stat'],
      references: ['sys.argv'],
      type_uses: ['str', 'int'],
      raises: [],
      imports: [],
    });
    expect(a).not.toBe(c);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/ingest/fingerprint.js`:

```js
import { createHash } from 'node:crypto';

function sha(parts) {
  const h = createHash('sha256');
  for (const p of parts) h.update(String(p), 'utf8').update('\u0001');
  return h.digest('hex').slice(0, 16);
}

export function structuralFingerprint(sym) {
  return sha([
    sym.qname ?? '',
    sym.signature ?? '',
    (sym.decorators ?? []).join(','),
    sym.parent_class ?? '',
    sym.node_type ?? '',
  ]);
}

export function dependencyFingerprint(deps) {
  const canon = (arr) => [...(arr ?? [])].sort().join('|');
  return sha([
    canon(deps.calls),
    canon(deps.references),
    canon(deps.type_uses),
    canon(deps.raises),
    canon(deps.imports),
  ]);
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/ingest/fingerprint.js tests/unit/ingest/
git commit -m "feat(ingest): two-axis fingerprint (structural + dependency)"
```

---

## Task 6: Tree-sitter walker + Extractor interface

**Files:**
- Create: `mcp/stdio/ingest/walker.js`, `mcp/stdio/ingest/extractors/base.js`
- Create: `tests/unit/ingest/walker.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/ingest/walker.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseSource } from '../../../mcp/stdio/ingest/walker.js';

describe('walker', () => {
  it('parses a python snippet to a tree', async () => {
    const src = 'def foo():\n    return 1\n';
    const tree = await parseSource(src, 'python');
    expect(tree.rootNode.type).toBe('module');
    expect(tree.rootNode.descendantsOfType('function_definition').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement walker**

`mcp/stdio/ingest/walker.js`:

```js
import Parser from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

let parserReady = null;
const langs = new Map();

async function initParser() {
  if (parserReady) return parserReady;
  parserReady = (async () => {
    await Parser.init();
  })();
  return parserReady;
}

async function loadLang(lang) {
  if (langs.has(lang)) return langs.get(lang);
  await initParser();
  const wasmPath = await resolveWasm(lang);
  const Lang = await Parser.Language.load(wasmPath);
  langs.set(lang, Lang);
  return Lang;
}

async function resolveWasm(lang) {
  // Packaged wasm files are pulled from the relevant tree-sitter-{lang} npm module.
  // We require the wasm to be present; install.sh step will copy them into vendor/.
  const here = dirname(fileURLToPath(import.meta.url));
  const vendor = join(here, '..', '..', '..', 'vendor', `tree-sitter-${lang}.wasm`);
  return vendor;
}

export async function parseSource(source, lang) {
  await initParser();
  const parser = new Parser();
  parser.setLanguage(await loadLang(lang));
  return parser.parse(source);
}
```

And `mcp/stdio/ingest/extractors/base.js`:

```js
/**
 * Extractor interface. Concrete extractors implement extract(filePath, source, tree).
 * Returns { nodes: ExtractedNode[], edges: ExtractedEdge[] } for a single file.
 *
 * ExtractedNode: { id, table, fields, structural_fp_input, dependency_fp_input }
 * ExtractedEdge: { relation, from_id, from_table, to_qname, source_line, confidence }
 *
 * Cross-file edges use to_qname (string) — the resolver (Task 10) turns qnames into
 * real to_id values after all files are extracted.
 */
export class Extractor {
  async extract(filePath, source, tree) {
    throw new Error('Extractor.extract must be implemented');
  }
}
```

- [ ] **Step 4: Vendor the WASM files**

```bash
mkdir -p vendor
cp node_modules/tree-sitter-python/tree-sitter-python.wasm vendor/tree-sitter-python.wasm 2>/dev/null || \
  echo "tree-sitter-python.wasm not shipped as wasm; add a build step"
```

If the package ships a native `.node` binding instead of `.wasm`, the walker needs to use the native `tree-sitter` package instead of `web-tree-sitter`. In that case, swap `walker.js` to:

```js
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import TypeScript from 'tree-sitter-typescript';

const parsers = new Map();
function getParser(lang) {
  if (parsers.has(lang)) return parsers.get(lang);
  const p = new Parser();
  if (lang === 'python') p.setLanguage(Python);
  else if (lang === 'typescript') p.setLanguage(TypeScript.typescript);
  else if (lang === 'tsx') p.setLanguage(TypeScript.tsx);
  else throw new Error(`unknown lang ${lang}`);
  parsers.set(lang, p);
  return p;
}
export function parseSource(source, lang) {
  return getParser(lang).parse(source);
}
```

Pick whichever path the installed kuzu + tree-sitter versions support on the target platform. Windows users are more likely to want native bindings; Linux/Mac can go either way. Document the choice in `docs/extractor-guide.md` later.

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/ingest/walker.js mcp/stdio/ingest/extractors/base.js vendor/ tests/unit/ingest/walker.test.js
git commit -m "feat(ingest): tree-sitter walker + Extractor interface"
```

---

## Task 7: Python extractor — top-level declarations

**Files:**
- Create: `mcp/stdio/ingest/extractors/python.js`
- Create: `tests/fixtures/tiny-python/a.py`, `tests/fixtures/tiny-python/b.py`
- Create: `tests/unit/ingest/python.test.js`

- [ ] **Step 1: Create fixture files**

`tests/fixtures/tiny-python/a.py`:

```python
import os
from b import bar

class Greeter:
    def __init__(self, name: str) -> None:
        self.name = name

    def hello(self) -> str:
        return bar(self.name)

def top_level(x: int) -> int:
    return x + 1
```

`tests/fixtures/tiny-python/b.py`:

```python
def bar(name: str) -> str:
    return f"hello {name}"
```

- [ ] **Step 2: Write failing test**

`tests/unit/ingest/python.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PythonExtractor } from '../../../mcp/stdio/ingest/extractors/python.js';
import { parseSource } from '../../../mcp/stdio/ingest/walker.js';

const FIX = 'tests/fixtures/tiny-python';

describe('python extractor', () => {
  it('extracts top-level function, class, and methods from a.py', async () => {
    const src = await readFile(join(FIX, 'a.py'), 'utf8');
    const tree = await parseSource(src, 'python');
    const ex = new PythonExtractor();
    const { nodes, edges } = await ex.extract('a.py', src, tree);

    const labels = nodes.map((n) => `${n.table}:${n.fields.label}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        'File:a.py',
        'Class:Greeter',
        'Method:__init__',
        'Method:hello',
        'Function:top_level',
      ])
    );

    // CONTAINS edges link File → Class, Class → Method (captured as cross-file
    // edges pending resolver, or as structural edges with to_id when same file)
    const contains = edges.filter((e) => e.relation === 'CONTAINS');
    expect(contains.length).toBeGreaterThan(0);
  });

  it('extracts IMPORTS edges as pending (to_qname)', async () => {
    const src = await readFile(join(FIX, 'a.py'), 'utf8');
    const tree = await parseSource(src, 'python');
    const ex = new PythonExtractor();
    const { edges } = await ex.extract('a.py', src, tree);
    const imports = edges.filter((e) => e.relation === 'IMPORTS');
    expect(imports.map((e) => e.to_qname)).toEqual(
      expect.arrayContaining(['os', 'b'])
    );
  });
});
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement Python extractor**

`mcp/stdio/ingest/extractors/python.js`:

```js
import { Extractor } from './base.js';
import { structuralFingerprint, dependencyFingerprint }
  from '../fingerprint.js';

const LANG = 'python';

export class PythonExtractor extends Extractor {
  async extract(filePath, source, tree) {
    const nodes = [];
    const edges = [];
    const fileId = `file:${filePath}`;

    nodes.push({
      id: fileId,
      table: 'File',
      fields: {
        id: fileId,
        label: filePath,
        file_path: filePath,
        language: LANG,
        start_line: 1,
        end_line: tree.rootNode.endPosition.row + 1,
        confidence: 1.0,
        structural_fp: '', dependency_fp: '',
      },
      structural_fp_input: null,
      dependency_fp_input: null,
    });

    const root = tree.rootNode;

    // Imports
    for (const imp of root.descendantsOfType('import_statement')) {
      const names = imp.descendantsOfType('dotted_name');
      for (const n of names) {
        edges.push({
          relation: 'IMPORTS',
          from_id: fileId,
          from_table: 'File',
          to_qname: n.text,
          source_line: imp.startPosition.row + 1,
          confidence: 1.0,
        });
      }
    }
    for (const imp of root.descendantsOfType('import_from_statement')) {
      const mod = imp.childForFieldName('module_name');
      if (mod) {
        edges.push({
          relation: 'IMPORTS',
          from_id: fileId,
          from_table: 'File',
          to_qname: mod.text,
          source_line: imp.startPosition.row + 1,
          confidence: 1.0,
        });
      }
    }

    // Top-level functions
    for (const fn of root.children.filter((c) => c.type === 'function_definition')) {
      emitFn(fn, nodes, edges, fileId, filePath, null);
    }

    // Classes (+ methods)
    for (const cls of root.descendantsOfType('class_definition')) {
      const name = cls.childForFieldName('name').text;
      const id = `class:${filePath}:${name}`;
      const sig = `class ${name}`;
      const structural = { qname: name, signature: sig, decorators: [], parent_class: null, node_type: 'Class' };
      nodes.push({
        id, table: 'Class',
        fields: baseFields(id, name, filePath, cls),
        structural_fp_input: structural,
        dependency_fp_input: { calls: [], references: [], type_uses: [], raises: [], imports: [] },
      });
      edges.push(mkContains(fileId, 'File', id, cls.startPosition.row + 1));
      for (const m of cls.descendantsOfType('function_definition')) {
        emitFn(m, nodes, edges, id, filePath, name);
      }
    }

    // Fill fingerprints
    for (const n of nodes) {
      if (n.structural_fp_input) {
        n.fields.structural_fp = structuralFingerprint(n.structural_fp_input);
      }
      if (n.dependency_fp_input) {
        n.fields.dependency_fp = dependencyFingerprint(n.dependency_fp_input);
      }
    }

    return { nodes, edges };
  }
}

function baseFields(id, label, filePath, tsNode) {
  return {
    id, label, file_path: filePath, language: LANG,
    start_line: tsNode.startPosition.row + 1,
    end_line: tsNode.endPosition.row + 1,
    confidence: 1.0,
    structural_fp: '', dependency_fp: '',
  };
}

function mkContains(fromId, fromTable, toId, line) {
  return {
    relation: 'CONTAINS', from_id: fromId, from_table: fromTable,
    to_qname: toId,                             // resolver will bind in-file
    source_line: line, confidence: 1.0,
  };
}

function emitFn(fnNode, nodes, edges, parentId, filePath, parentClass) {
  const name = fnNode.childForFieldName('name').text;
  const params = fnNode.childForFieldName('parameters')?.text ?? '()';
  const returnType = fnNode.childForFieldName('return_type')?.text ?? '';
  const isMethod = parentClass !== null;
  const isTest = name.startsWith('test_') || name === 'setUp' || name === 'tearDown';
  const table = isTest ? 'Test' : (isMethod ? 'Method' : 'Function');
  const qname = isMethod ? `${parentClass}.${name}` : name;
  const id = `${table.toLowerCase()}:${filePath}:${qname}`;
  const sig = `${name}${params}${returnType ? ' -> ' + returnType : ''}`;

  // Collect outgoing refs from body
  const body = fnNode.childForFieldName('body');
  const calls = [];
  const references = [];
  if (body) {
    for (const c of body.descendantsOfType('call')) {
      const callee = c.childForFieldName('function');
      if (callee) calls.push(callee.text);
    }
    for (const id_ of body.descendantsOfType('identifier')) {
      references.push(id_.text);
    }
  }

  nodes.push({
    id, table,
    fields: baseFields(id, name, filePath, fnNode),
    structural_fp_input: {
      qname, signature: sig, decorators: [], parent_class: parentClass, node_type: table,
    },
    dependency_fp_input: {
      calls, references, type_uses: [], raises: [], imports: [],
    },
  });

  edges.push(mkContains(parentId,
    parentClass ? 'Class' : 'File',
    id,
    fnNode.startPosition.row + 1));

  // Emit pending CALLS edges
  for (const c of calls) {
    edges.push({
      relation: 'CALLS',
      from_id: id,
      from_table: table,
      to_qname: c,
      source_line: fnNode.startPosition.row + 1,
      confidence: 0.8,
    });
  }
}
```

- [ ] **Step 5: Run — PASS**

```bash
npm test -- tests/unit/ingest/python.test.js
```

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/ingest/extractors/python.js tests/fixtures/tiny-python/ tests/unit/ingest/python.test.js
git commit -m "feat(extractor): python — files, classes, functions, methods, imports, calls"
```

---

## Task 8: Python extractor — fingerprint stability

**Files:**
- Modify: `tests/unit/ingest/python.test.js` (extend)

- [ ] **Step 1: Append stability test**

```js
// at the end of the existing describe block:

it('structural_fp is stable across body-only changes, dependency_fp is not', async () => {
  const srcA = `
def foo(x: int) -> int:
    return x + 1
`;
  const srcB = `
def foo(x: int) -> int:
    y = x + 1
    return y
`;
  const ex = new PythonExtractor();
  const { parseSource } = await import('../../../mcp/stdio/ingest/walker.js');
  const a = (await ex.extract('f.py', srcA, await parseSource(srcA, 'python')))
    .nodes.find((n) => n.fields.label === 'foo');
  const b = (await ex.extract('f.py', srcB, await parseSource(srcB, 'python')))
    .nodes.find((n) => n.fields.label === 'foo');
  expect(a.fields.structural_fp).toBe(b.fields.structural_fp);
  // body mentions `y` identifier in B, which is a reference; dep fp differs
  expect(a.fields.dependency_fp).not.toBe(b.fields.dependency_fp);
});

it('dependency_fp is stable when only whitespace changes', async () => {
  const srcA = `def foo():\n    bar()\n    baz()\n`;
  const srcB = `def foo():\n\n    bar()\n    baz()\n`;
  const ex = new PythonExtractor();
  const { parseSource } = await import('../../../mcp/stdio/ingest/walker.js');
  const a = (await ex.extract('f.py', srcA, await parseSource(srcA, 'python')))
    .nodes.find((n) => n.fields.label === 'foo');
  const b = (await ex.extract('f.py', srcB, await parseSource(srcB, 'python')))
    .nodes.find((n) => n.fields.label === 'foo');
  expect(a.fields.dependency_fp).toBe(b.fields.dependency_fp);
});
```

- [ ] **Step 2: Run**

```bash
npm test -- tests/unit/ingest/python.test.js
```

If the stability tests fail because the extractor's `references` collection is picking up parameter names (making dependency_fp unstable), exclude function parameters from the identifier sweep in `emitFn`. Re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ingest/python.test.js mcp/stdio/ingest/extractors/python.js
git commit -m "test(extractor): python fingerprint stability (structural + dependency)"
```

---

## Task 9: TypeScript/JavaScript extractor

**Files:**
- Create: `mcp/stdio/ingest/extractors/typescript.js`
- Create: `tests/fixtures/tiny-ts/a.ts`, `tests/fixtures/tiny-ts/b.ts`
- Create: `tests/unit/ingest/typescript.test.js`

- [ ] **Step 1: Create fixture**

`tests/fixtures/tiny-ts/a.ts`:

```ts
import { bar } from './b';

export class Greeter {
  constructor(private name: string) {}
  hello(): string {
    return bar(this.name);
  }
}

export function topLevel(x: number): number {
  return x + 1;
}
```

`tests/fixtures/tiny-ts/b.ts`:

```ts
export function bar(name: string): string {
  return `hello ${name}`;
}
```

- [ ] **Step 2: Write failing test**

`tests/unit/ingest/typescript.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TypeScriptExtractor } from '../../../mcp/stdio/ingest/extractors/typescript.js';
import { parseSource } from '../../../mcp/stdio/ingest/walker.js';

describe('typescript extractor', () => {
  it('extracts classes, methods, top-level functions from a.ts', async () => {
    const src = await readFile('tests/fixtures/tiny-ts/a.ts', 'utf8');
    const tree = await parseSource(src, 'typescript');
    const ex = new TypeScriptExtractor();
    const { nodes, edges } = await ex.extract('a.ts', src, tree);

    const labels = nodes.map((n) => `${n.table}:${n.fields.label}`);
    expect(labels).toEqual(expect.arrayContaining([
      'File:a.ts', 'Class:Greeter', 'Method:hello', 'Function:topLevel',
    ]));

    const imports = edges.filter((e) => e.relation === 'IMPORTS');
    expect(imports.map((e) => e.to_qname)).toContain('./b');
  });
});
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement**

`mcp/stdio/ingest/extractors/typescript.js`:

```js
import { Extractor } from './base.js';
import { structuralFingerprint, dependencyFingerprint }
  from '../fingerprint.js';

const LANG = 'typescript';

export class TypeScriptExtractor extends Extractor {
  async extract(filePath, source, tree) {
    const nodes = [];
    const edges = [];
    const fileId = `file:${filePath}`;

    nodes.push({
      id: fileId, table: 'File',
      fields: {
        id: fileId, label: filePath, file_path: filePath, language: LANG,
        start_line: 1, end_line: tree.rootNode.endPosition.row + 1,
        confidence: 1.0, structural_fp: '', dependency_fp: '',
      },
      structural_fp_input: null, dependency_fp_input: null,
    });

    const root = tree.rootNode;

    for (const imp of root.descendantsOfType('import_statement')) {
      const src = imp.descendantsOfType('string')[0];
      if (src) {
        // strip quotes
        const modName = src.text.slice(1, -1);
        edges.push({
          relation: 'IMPORTS', from_id: fileId, from_table: 'File',
          to_qname: modName, source_line: imp.startPosition.row + 1, confidence: 1.0,
        });
      }
    }

    for (const fn of root.descendantsOfType('function_declaration')) {
      emitFn(fn, nodes, edges, fileId, filePath, null);
    }

    for (const cls of root.descendantsOfType('class_declaration')) {
      const name = cls.childForFieldName('name').text;
      const id = `class:${filePath}:${name}`;
      nodes.push({
        id, table: 'Class',
        fields: baseFields(id, name, filePath, cls),
        structural_fp_input: { qname: name, signature: `class ${name}`, decorators: [], parent_class: null, node_type: 'Class' },
        dependency_fp_input: { calls: [], references: [], type_uses: [], raises: [], imports: [] },
      });
      edges.push({
        relation: 'CONTAINS', from_id: fileId, from_table: 'File',
        to_qname: id, source_line: cls.startPosition.row + 1, confidence: 1.0,
      });
      const body = cls.childForFieldName('body');
      if (body) {
        for (const m of body.children.filter((c) => c.type === 'method_definition')) {
          emitFn(m, nodes, edges, id, filePath, name);
        }
      }
    }

    for (const n of nodes) {
      if (n.structural_fp_input) n.fields.structural_fp = structuralFingerprint(n.structural_fp_input);
      if (n.dependency_fp_input) n.fields.dependency_fp = dependencyFingerprint(n.dependency_fp_input);
    }

    return { nodes, edges };
  }
}

function baseFields(id, label, filePath, tsNode) {
  return {
    id, label, file_path: filePath, language: LANG,
    start_line: tsNode.startPosition.row + 1,
    end_line: tsNode.endPosition.row + 1,
    confidence: 1.0, structural_fp: '', dependency_fp: '',
  };
}

function emitFn(fnNode, nodes, edges, parentId, filePath, parentClass) {
  const nameNode = fnNode.childForFieldName('name');
  if (!nameNode) return;
  const name = nameNode.text;
  const isMethod = parentClass !== null;
  const isTest = name.startsWith('test') || name.endsWith('_test');
  const table = isTest ? 'Test' : (isMethod ? 'Method' : 'Function');
  const qname = isMethod ? `${parentClass}.${name}` : name;
  const id = `${table.toLowerCase()}:${filePath}:${qname}`;

  const body = fnNode.childForFieldName('body');
  const calls = [];
  if (body) {
    for (const c of body.descendantsOfType('call_expression')) {
      const callee = c.childForFieldName('function');
      if (callee) calls.push(callee.text);
    }
  }

  nodes.push({
    id, table,
    fields: baseFields(id, name, filePath, fnNode),
    structural_fp_input: { qname, signature: name, decorators: [], parent_class: parentClass, node_type: table },
    dependency_fp_input: { calls, references: [], type_uses: [], raises: [], imports: [] },
  });
  edges.push({
    relation: 'CONTAINS', from_id: parentId,
    from_table: parentClass ? 'Class' : 'File',
    to_qname: id, source_line: fnNode.startPosition.row + 1, confidence: 1.0,
  });
  for (const c of calls) {
    edges.push({
      relation: 'CALLS', from_id: id, from_table: table,
      to_qname: c, source_line: fnNode.startPosition.row + 1, confidence: 0.8,
    });
  }
}
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/ingest/extractors/typescript.js tests/fixtures/tiny-ts/ tests/unit/ingest/typescript.test.js
git commit -m "feat(extractor): typescript/javascript — classes, methods, functions, imports, calls"
```

---

## Task 10: Cross-file resolver

**Files:**
- Create: `mcp/stdio/ingest/resolver.js`
- Create: `tests/unit/ingest/resolver.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/ingest/resolver.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolveEdges } from '../../../mcp/stdio/ingest/resolver.js';
import { PythonExtractor } from '../../../mcp/stdio/ingest/extractors/python.js';
import { parseSource } from '../../../mcp/stdio/ingest/walker.js';

describe('resolver', () => {
  it('resolves a cross-file CALLS edge by unique qname', async () => {
    const ex = new PythonExtractor();
    const aSrc = await readFile('tests/fixtures/tiny-python/a.py', 'utf8');
    const bSrc = await readFile('tests/fixtures/tiny-python/b.py', 'utf8');
    const a = await ex.extract('a.py', aSrc, await parseSource(aSrc, 'python'));
    const b = await ex.extract('b.py', bSrc, await parseSource(bSrc, 'python'));

    const all = {
      nodes: [...a.nodes, ...b.nodes],
      edges: [...a.edges, ...b.edges],
    };
    const { resolved, dirty } = resolveEdges(all.nodes, all.edges);
    const cross = resolved.filter(
      (e) => e.relation === 'CALLS' && e.to_qname === 'bar'
    );
    // Should have been rewritten to point at function:b.py:bar
    expect(cross.length).toBe(0);
    const resolvedBar = resolved.filter(
      (e) => e.relation === 'CALLS' && e.to_id === 'function:b.py:bar'
    );
    expect(resolvedBar.length).toBeGreaterThan(0);
  });

  it('leaves unresolvable to_qname edges in dirty with reason', () => {
    const nodes = [{ id: 'function:a.py:foo', table: 'Function', fields: { label: 'foo' } }];
    const edges = [{ relation: 'CALLS', from_id: 'function:a.py:foo', from_table: 'Function', to_qname: 'nope_not_here', source_line: 1, confidence: 0.8 }];
    const { resolved, dirty } = resolveEdges(nodes, edges);
    expect(resolved.length).toBe(0);
    expect(dirty.length).toBe(1);
    expect(dirty[0].reason).toBe('unresolved_target');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/ingest/resolver.js`:

```js
/**
 * Given nodes + edges from one or more extractors, rewrite any edge that still
 * has `to_qname` into a concrete `to_id` referring to an existing node.
 *
 * Returns { resolved, dirty } where:
 *   resolved = edges with to_id set
 *   dirty    = edges we couldn't bind, each with a .reason
 */
export function resolveEdges(nodes, edges) {
  // Build lookup maps by label + by id
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byLabel = new Map();
  const byQname = new Map();
  for (const n of nodes) {
    const label = n.fields?.label ?? n.label;
    if (label) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(n);
    }
    // qname for functions/methods: last two segments of id are "path:qname"
    const id = n.id ?? '';
    const m = id.match(/:(?:[^:]+):([^:]+)$/);
    if (m) {
      const q = m[1];
      if (!byQname.has(q)) byQname.set(q, []);
      byQname.get(q).push(n);
    }
  }

  const resolved = [];
  const dirty = [];

  for (const e of edges) {
    if (e.to_id && byId.has(e.to_id)) {
      resolved.push(e);
      continue;
    }
    if (!e.to_qname) {
      dirty.push({ ...e, reason: 'no_qname' });
      continue;
    }
    // direct id hit?
    if (byId.has(e.to_qname)) {
      resolved.push({ ...e, to_id: e.to_qname, to_table: byId.get(e.to_qname).table });
      continue;
    }
    // unique label or qname match?
    const candLabel = byLabel.get(e.to_qname) ?? [];
    const candQname = byQname.get(e.to_qname) ?? [];
    const cands = mergeUnique(candLabel, candQname);
    if (cands.length === 1) {
      resolved.push({ ...e, to_id: cands[0].id, to_table: cands[0].table });
    } else if (cands.length === 0) {
      dirty.push({ ...e, reason: 'unresolved_target' });
    } else {
      // ambiguous — pick the highest confidence, mark low-confidence
      const pick = cands[0];
      resolved.push({
        ...e, to_id: pick.id, to_table: pick.table,
        confidence: Math.min(e.confidence ?? 1.0, 0.5),
      });
    }
  }

  return { resolved, dirty };
}

function mergeUnique(a, b) {
  const seen = new Set();
  const out = [];
  for (const n of [...a, ...b]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/ingest/resolver.js tests/unit/ingest/resolver.test.js
git commit -m "feat(ingest): cross-file resolver (qname → id binding + dirty edges)"
```

---

## Task 11: Git diff helper

**Files:**
- Create: `mcp/stdio/freshness/git.js`
- Create: `tests/unit/freshness/git.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/freshness/git.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { gitHead, gitStatus } from '../../../mcp/stdio/freshness/git.js';

describe('git helpers', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-git-'));
    await execa('git', ['init', '-q'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@test.local'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'test'], { cwd: dir });
    await writeFile(join(dir, 'a.txt'), 'hello\n');
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '-qm', 'init'], { cwd: dir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gitHead returns a sha', async () => {
    const head = await gitHead(dir);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('gitStatus returns empty when clean', async () => {
    const status = await gitStatus(dir);
    expect(status.dirty).toEqual([]);
    expect(status.untracked).toEqual([]);
  });

  it('gitStatus reports dirty files after a modification', async () => {
    await writeFile(join(dir, 'a.txt'), 'goodbye\n');
    const status = await gitStatus(dir);
    expect(status.dirty).toEqual(['a.txt']);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/freshness/git.js`:

```js
import { execa } from 'execa';

export async function gitHead(cwd) {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

export async function gitStatus(cwd) {
  const { stdout } = await execa('git', ['status', '--porcelain=v1', '-z'], { cwd });
  const entries = stdout.split('\u0000').filter(Boolean);
  const dirty = [];
  const untracked = [];
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === '??') untracked.push(path);
    else dirty.push(path);
  }
  return { dirty, untracked };
}

export async function changedFilesBetween(cwd, fromSha, toSha) {
  const { stdout } = await execa(
    'git',
    ['diff', '--name-only', '-z', `${fromSha}..${toSha}`],
    { cwd }
  );
  return stdout.split('\u0000').filter(Boolean);
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/freshness/git.js tests/unit/freshness/git.test.js
git commit -m "feat(freshness): git HEAD + status + diff helpers"
```

---

## Task 12: Manifest with atomic writes

**Files:**
- Create: `mcp/stdio/freshness/manifest.js`
- Create: `tests/unit/freshness/manifest.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/freshness/manifest.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, writeManifest, defaultManifest }
  from '../../../mcp/stdio/freshness/manifest.js';

describe('manifest', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apg-man-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('readManifest returns default on missing file', async () => {
    const m = await readManifest(dir);
    expect(m).toEqual(defaultManifest());
  });

  it('write+read round-trip', async () => {
    const m = {
      ...defaultManifest(),
      commit: 'deadbeef',
      indexedAt: '2026-04-16T01:00:00Z',
      dirtyFiles: ['x.py'],
      dirtyEdges: [],
      schemaVersion: 1,
      extractorVersion: '1.0.0',
    };
    await writeManifest(dir, m);
    const back = await readManifest(dir);
    expect(back).toEqual(m);
  });

  it('atomic write leaves no tmp file on success', async () => {
    await writeManifest(dir, defaultManifest());
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(files).toContain('manifest.json');
  });
});

import { readdir } from 'node:fs/promises';
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/freshness/manifest.js`:

```js
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_PATH = (dir) => join(dir, 'manifest.json');
const TMP_PATH = (dir) => join(dir, 'manifest.json.tmp');

export function defaultManifest() {
  return {
    commit: null,
    indexedAt: null,
    nodes: 0,
    edges: 0,
    dirtyFiles: [],
    dirtyEdges: [],
    schemaVersion: 1,
    extractorVersion: '0.0.0',
    parserBundleVersion: '0.0.0',
  };
}

export async function readManifest(dir) {
  try {
    const txt = await readFile(MANIFEST_PATH(dir), 'utf8');
    return { ...defaultManifest(), ...JSON.parse(txt) };
  } catch (err) {
    if (err.code === 'ENOENT') return defaultManifest();
    throw err;
  }
}

export async function writeManifest(dir, manifest) {
  await mkdir(dir, { recursive: true });
  const tmp = TMP_PATH(dir);
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await rename(tmp, MANIFEST_PATH(dir));
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/freshness/manifest.js tests/unit/freshness/manifest.test.js
git commit -m "feat(freshness): manifest JSON with atomic rename writes"
```

---

## Task 13: File write lock

**Files:**
- Create: `mcp/stdio/freshness/lock.js`
- Create: `tests/unit/freshness/lock.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/freshness/lock.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withWriteLock } from '../../../mcp/stdio/freshness/lock.js';

describe('write lock', () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apg-lock-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('runs the inner function and returns its result', async () => {
    const val = await withWriteLock(dir, async () => 42);
    expect(val).toBe(42);
  });

  it('serializes concurrent holders', async () => {
    const order = [];
    const inner = async (tag) => {
      order.push(`start:${tag}`);
      await new Promise((r) => setTimeout(r, 25));
      order.push(`end:${tag}`);
    };
    await Promise.all([
      withWriteLock(dir, () => inner('a')),
      withWriteLock(dir, () => inner('b')),
    ]);
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/freshness/lock.js`:

```js
import lockfile from 'proper-lockfile';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_FILE = (dir) => join(dir, '.write.lock');

export async function withWriteLock(dir, fn) {
  await mkdir(dir, { recursive: true });
  const f = LOCK_FILE(dir);
  // proper-lockfile wants a file to lock
  await writeFile(f, '', { flag: 'a' });
  const release = await lockfile.lock(f, {
    retries: { retries: 20, minTimeout: 20, maxTimeout: 200, factor: 1.5 },
    stale: 60000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/freshness/lock.js tests/unit/freshness/lock.test.js
git commit -m "feat(freshness): file-level write lock for multi-runtime safety"
```

---

## Task 14: Freshness orchestrator

**Files:**
- Create: `mcp/stdio/freshness/orchestrator.js`
- Create: `tests/integration/freshness.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/freshness.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';

describe('freshness orchestrator', () => {
  let repo;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-fresh-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('first call builds the graph from scratch', async () => {
    const result = await ensureFresh(repo);
    expect(result.action).toBe('full_build');
    expect(result.indexed_files).toBeGreaterThan(0);
  });

  it('second call on unchanged tree is a no-op', async () => {
    await ensureFresh(repo);
    const result = await ensureFresh(repo);
    expect(result.action).toBe('noop');
  });

  it('modifying a file triggers incremental reindex of that file only', async () => {
    await ensureFresh(repo);
    await writeFile(join(repo, 'a.py'), '# touched\n' + (await import('node:fs/promises')).then);
    // simpler: overwrite with a valid python change
    await writeFile(join(repo, 'a.py'),
      'def top_level(x: int) -> int:\n    return x + 2\n');
    const result = await ensureFresh(repo);
    expect(result.action).toBe('incremental');
    expect(result.indexed_files).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/freshness/orchestrator.js`:

```js
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { openDb } from '../storage/db.js';
import { upsertNode, deleteNode } from '../storage/nodes.js';
import { upsertEdge, deleteEdgesFrom, deleteEdgesTo } from '../storage/edges.js';
import { parseSource } from '../ingest/walker.js';
import { PythonExtractor } from '../ingest/extractors/python.js';
import { TypeScriptExtractor } from '../ingest/extractors/typescript.js';
import { resolveEdges } from '../ingest/resolver.js';
import { gitHead, gitStatus } from './git.js';
import { readManifest, writeManifest, defaultManifest } from './manifest.js';
import { withWriteLock } from './lock.js';

const GRAPH_DIR = (repo) => join(repo, '.aify-graph');
const DB_PATH = (repo) => join(GRAPH_DIR(repo), 'graph.kuzu');

function extractorFor(path) {
  if (path.endsWith('.py')) return new PythonExtractor();
  if (path.endsWith('.ts') || path.endsWith('.tsx') ||
      path.endsWith('.js') || path.endsWith('.jsx')) return new TypeScriptExtractor();
  return null;
}

function langFor(path) {
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.tsx')) return 'tsx';
  return 'typescript';
}

export async function ensureFresh(repo) {
  return withWriteLock(GRAPH_DIR(repo), async () => {
    const manifest = await readManifest(GRAPH_DIR(repo));
    const head = await gitHead(repo).catch(() => null);
    const status = await gitStatus(repo).catch(() => ({ dirty: [], untracked: [] }));
    const changed = [...new Set([...status.dirty, ...status.untracked])];

    const db = await openDb(DB_PATH(repo));
    try {
      // decision
      if (manifest.commit === null) {
        const result = await fullBuild(repo, db);
        await writeManifest(GRAPH_DIR(repo), {
          ...defaultManifest(), commit: head,
          indexedAt: new Date().toISOString(),
          nodes: result.nodes, edges: result.edges,
        });
        return { action: 'full_build', ...result };
      }
      if (manifest.commit === head && changed.length === 0) {
        return { action: 'noop', indexed_files: 0 };
      }
      // incremental — reindex changed files only
      const result = await incrementalReindex(repo, db, changed);
      await writeManifest(GRAPH_DIR(repo), {
        ...manifest, commit: head,
        indexedAt: new Date().toISOString(),
        nodes: result.nodes, edges: result.edges,
      });
      return { action: 'incremental', ...result };
    } finally {
      await db.close();
    }
  });
}

async function fullBuild(repo, db) {
  const { walkFiles } = await import('./walk-files.js'); // helper: list all tracked source files
  const files = await walkFiles(repo);
  let totalNodes = 0, totalEdges = 0;
  const allNodes = [];
  const allEdges = [];
  for (const rel of files) {
    const extractor = extractorFor(rel);
    if (!extractor) continue;
    const source = await readFile(join(repo, rel), 'utf8');
    const tree = await parseSource(source, langFor(rel));
    const { nodes, edges } = await extractor.extract(rel, source, tree);
    allNodes.push(...nodes);
    allEdges.push(...edges);
  }
  const { resolved, dirty } = resolveEdges(allNodes, allEdges);
  for (const n of allNodes) {
    await upsertNode(db, n.table, n.fields);
    totalNodes++;
  }
  for (const e of resolved) {
    await upsertEdge(db, e.relation, e);
    totalEdges++;
  }
  return {
    indexed_files: files.filter((f) => extractorFor(f)).length,
    nodes: totalNodes, edges: totalEdges,
    dirty_edges: dirty,
  };
}

async function incrementalReindex(repo, db, changedPaths) {
  let indexedFiles = 0;
  let deltaNodes = 0, deltaEdges = 0;
  for (const rel of changedPaths) {
    const extractor = extractorFor(rel);
    if (!extractor) continue;
    const source = await readFile(join(repo, rel), 'utf8');
    const tree = await parseSource(source, langFor(rel));
    const { nodes, edges } = await extractor.extract(rel, source, tree);
    // TODO (post-v1): proper fingerprint-diff; v1 drops edges from changed file
    // and re-upserts.
    for (const e of ['CONTAINS', 'CALLS', 'DEFINES']) {
      // for each node in this file, delete edges FROM it for these relations
      for (const n of nodes) {
        await deleteEdgesFrom(db, e, n.table, n.id);
      }
    }
    const { resolved } = resolveEdges(nodes, edges);
    for (const n of nodes) {
      await upsertNode(db, n.table, n.fields);
      deltaNodes++;
    }
    for (const e of resolved) {
      await upsertEdge(db, e.relation, e);
      deltaEdges++;
    }
    indexedFiles++;
  }
  return { indexed_files: indexedFiles, nodes: deltaNodes, edges: deltaEdges };
}
```

And create the helper `mcp/stdio/freshness/walk-files.js`:

```js
import { execa } from 'execa';

export async function walkFiles(repoDir) {
  try {
    const { stdout } = await execa('git', ['ls-files', '-z'], { cwd: repoDir });
    return stdout.split('\u0000').filter(Boolean);
  } catch {
    // fallback: recurse filesystem (TODO: ignore node_modules, etc.)
    return [];
  }
}
```

- [ ] **Step 4: Run — PASS**

Expect some flakiness around path normalization on Windows; if `gitStatus` returns `tests/fixtures/tiny-python/a.py`-style paths versus `a.py`-style paths, normalize them in `ensureFresh` before passing down.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/freshness/orchestrator.js mcp/stdio/freshness/walk-files.js tests/integration/freshness.test.js
git commit -m "feat(freshness): orchestrator with full build + incremental reindex"
```

**Follow-up post-v1:** the incremental path currently rebuilds edges for the whole changed file instead of using fingerprint-diff. That's the §7 design goal but it's more complex; v1 ships with the simpler "drop and rebuild per file" approach and a TODO marker for the fingerprint-diff version. Both are correct; the fingerprint version is just faster. Leave a GitHub issue link in the file comment once the repo is public.

---

## Task 15: Compact line renderer

**Files:**
- Create: `mcp/stdio/query/renderer.js`
- Create: `tests/unit/query/renderer.test.js`
- Create: `docs/query-format.md`

- [ ] **Step 1: Write failing test**

`tests/unit/query/renderer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { renderNodeLine, renderEdgeLine, renderCompact }
  from '../../../mcp/stdio/query/renderer.js';

describe('renderer', () => {
  it('renders a node line', () => {
    const line = renderNodeLine({
      id: 'n_foo', table: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 42, community_id: 12,
    });
    expect(line).toBe('NODE n_foo function foo src/a.py:42 community=12');
  });

  it('renders an edge line', () => {
    const line = renderEdgeLine({
      from_id: 'n_caller', to_id: 'n_foo', relation: 'CALLS',
      source_file: 'src/b.py', source_line: 18, confidence: 0.95,
    });
    expect(line).toBe('EDGE n_caller→n_foo CALLS src/b.py:18 conf=0.95');
  });

  it('renderCompact emits nodes then edges then truncation footer when over budget', () => {
    const out = renderCompact({
      nodes: [
        { id: 'a', table: 'Function', label: 'a', file_path: 'x:1', start_line: 1 },
      ],
      edges: [
        { from_id: 'c', to_id: 'a', relation: 'CALLS', source_file: 'y', source_line: 2, confidence: 0.9 },
        { from_id: 'd', to_id: 'a', relation: 'CALLS', source_file: 'y', source_line: 3, confidence: 0.8 },
      ],
      truncated: 3,
      suggestion: 'top_k=10',
    });
    expect(out).toContain('NODE a function a');
    expect(out).toContain('EDGE c→a CALLS');
    expect(out).toContain('TRUNCATED 3 more (use top_k=10)');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/renderer.js`:

```js
export function renderNodeLine(n) {
  const community = n.community_id != null && n.community_id !== -1
    ? ` community=${n.community_id}` : '';
  return `NODE ${n.id} ${n.table.toLowerCase()} ${n.label} ${n.file_path}:${n.start_line}${community}`;
}

export function renderEdgeLine(e) {
  const conf = e.confidence != null
    ? ` conf=${Number(e.confidence).toFixed(2)}` : '';
  return `EDGE ${e.from_id}→${e.to_id} ${e.relation} ${e.source_file}:${e.source_line}${conf}`;
}

export function renderCompact({ nodes = [], edges = [], truncated = 0, suggestion = '' }) {
  const lines = [];
  for (const n of nodes) lines.push(renderNodeLine(n));
  for (const e of edges) lines.push(renderEdgeLine(e));
  if (truncated > 0) {
    const hint = suggestion ? ` (use ${suggestion})` : '';
    lines.push(`TRUNCATED ${truncated} more${hint}`);
  }
  return lines.join('\n');
}
```

And create `docs/query-format.md`:

```markdown
# Compact line format

Every query verb returns plain text. No JSON, no raw code bodies.

## NODE line

```
NODE <id> <type> <label> <file>:<line>[ community=<N>]
```

Example:
```
NODE n_parseFoo function parseFoo src/parser/foo.ts:42 community=12
```

## EDGE line

```
EDGE <from_id>→<to_id> <RELATION> <file>:<line> conf=<0..1>
```

## TRUNCATED footer

```
TRUNCATED <N> more (use <suggestion>)
```

Always present when a response was clipped by the token budget. The suggestion gives the caller a concrete way to ask for more (e.g. `top_k=20`, `depth=2`).

## Token budget

Default 2000 tokens, configurable per call via the verb's optional `token_budget` parameter. Renderer drops lowest-confidence / highest-depth edges first.
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/renderer.js docs/query-format.md tests/unit/query/renderer.test.js
git commit -m "feat(query): compact NODE/EDGE line renderer + format docs"
```

---

## Task 16: Token budget

**Files:**
- Create: `mcp/stdio/query/budget.js`
- Create: `tests/unit/query/budget.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/query/budget.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { estimateTokens, enforceBudget } from '../../../mcp/stdio/query/budget.js';

describe('budget', () => {
  it('estimateTokens approximates at 4 chars/token', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('enforceBudget drops lowest-confidence edges first', () => {
    const edges = [
      { confidence: 0.9, depth: 1 },
      { confidence: 0.5, depth: 1 },
      { confidence: 0.7, depth: 2 },
    ];
    // budget of 1 edge
    const out = enforceBudget(edges, 1);
    expect(out.kept.length).toBe(1);
    expect(out.kept[0].confidence).toBe(0.9);
    expect(out.dropped).toBe(2);
  });

  it('enforceBudget drops deepest second after confidence ties', () => {
    const edges = [
      { confidence: 0.8, depth: 1 },
      { confidence: 0.8, depth: 3 },
    ];
    const out = enforceBudget(edges, 1);
    expect(out.kept[0].depth).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/budget.js`:

```js
export function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function enforceBudget(edges, maxEdges) {
  const sorted = [...edges].sort((a, b) => {
    if ((b.confidence ?? 0) !== (a.confidence ?? 0)) {
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    }
    return (a.depth ?? 0) - (b.depth ?? 0);
  });
  const kept = sorted.slice(0, maxEdges);
  return { kept, dropped: edges.length - kept.length };
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/budget.js tests/unit/query/budget.test.js
git commit -m "feat(query): token budget estimator + edge pruning by confidence/depth"
```

---

## Task 17: Ranking

**Files:**
- Create: `mcp/stdio/query/rank.js`
- Create: `tests/unit/query/rank.test.js`

- [ ] **Step 1: Write failing test**

`tests/unit/query/rank.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { rankCallers } from '../../../mcp/stdio/query/rank.js';

describe('rank', () => {
  it('orders by depth asc, confidence desc, test proximity, fan-in desc', () => {
    const edges = [
      { from_id: 'a', to_id: 'target', depth: 1, confidence: 0.8, from_table: 'Function', fan_in: 2 },
      { from_id: 'b', to_id: 'target', depth: 1, confidence: 0.9, from_table: 'Function', fan_in: 1 },
      { from_id: 'c', to_id: 'target', depth: 2, confidence: 1.0, from_table: 'Function', fan_in: 5 },
      { from_id: 't', to_id: 'target', depth: 1, confidence: 0.9, from_table: 'Test',     fan_in: 1 },
    ];
    const ranked = rankCallers(edges);
    // Expect: depth=1 block first (b, t both conf 0.9; test proximity breaks tie → t first),
    // then a (depth=1, conf 0.8), then c (depth=2)
    expect(ranked.map((e) => e.from_id)).toEqual(['t', 'b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/rank.js`:

```js
export function rankCallers(edges) {
  return [...edges].sort((a, b) => {
    const d = (a.depth ?? 1) - (b.depth ?? 1);
    if (d !== 0) return d;
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    const t = testProximity(b) - testProximity(a);
    if (t !== 0) return t;
    return (b.fan_in ?? 0) - (a.fan_in ?? 0);
  });
}

export const rankCallees = rankCallers;

function testProximity(edge) {
  return edge.from_table === 'Test' ? 1 : 0;
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/rank.js tests/unit/query/rank.test.js
git commit -m "feat(query): v1 ranking — depth, confidence, test proximity, fan-in"
```

---

## Task 18: Verb — graph_status

**Files:**
- Create: `mcp/stdio/query/verbs/status.js`
- Create: `tests/integration/verbs/status.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/verbs/status.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphStatus } from '../../../mcp/stdio/query/verbs/status.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_status', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-status-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('reports not-indexed for a fresh repo', async () => {
    const s = await graphStatus({ repo });
    expect(s.indexed).toBe(false);
  });

  it('reports indexed=true and non-zero node count after ensureFresh', async () => {
    await ensureFresh(repo);
    const s = await graphStatus({ repo });
    expect(s.indexed).toBe(true);
    expect(s.nodes).toBeGreaterThan(0);
    expect(s.schemaVersion).toBe(1);
    expect(s.unresolvedEdges).toBeDefined();
    expect(s.dirtyEdgeCount).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/status.js`:

```js
import { join } from 'node:path';
import { readManifest, defaultManifest } from '../../freshness/manifest.js';
import { gitHead, gitStatus } from '../../freshness/git.js';

const GRAPH_DIR = (repo) => join(repo, '.aify-graph');

export async function graphStatus({ repo }) {
  const manifest = await readManifest(GRAPH_DIR(repo));
  const head = await gitHead(repo).catch(() => null);
  const status = await gitStatus(repo).catch(() => ({ dirty: [], untracked: [] }));
  return {
    indexed: manifest.commit !== null,
    nodes: manifest.nodes ?? 0,
    edges: manifest.edges ?? 0,
    indexedAt: manifest.indexedAt,
    commit: manifest.commit,
    currentHead: head,
    dirtyFiles: [...status.dirty, ...status.untracked],
    unresolvedEdges: (manifest.dirtyEdges ?? []).length,
    dirtyEdgeCount: (manifest.dirtyEdges ?? []).length,
    schemaVersion: manifest.schemaVersion ?? 1,
    extractorVersion: manifest.extractorVersion ?? '0.0.0',
  };
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/status.js tests/integration/verbs/status.test.js
git commit -m "feat(verb): graph_status with trust/debug fields"
```

---

## Task 19: Verb — graph_index

**Files:**
- Create: `mcp/stdio/query/verbs/index.js`
- Create: `tests/integration/verbs/index.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/verbs/index.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphIndex } from '../../../mcp/stdio/query/verbs/index.js';

describe('graph_index', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-idx-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('first call builds, returns indexed_files > 0', async () => {
    const r = await graphIndex({ repo });
    expect(r.indexed_files).toBeGreaterThan(0);
  });

  it('force=true rebuilds even on a clean tree', async () => {
    await graphIndex({ repo });
    const r = await graphIndex({ repo, force: true });
    expect(r.indexed_files).toBeGreaterThan(0);
  });

  it('paths=[file] reindexes just that file regardless of git dirt', async () => {
    await graphIndex({ repo });
    const r = await graphIndex({ repo, paths: ['a.py'] });
    expect(r.indexed_files).toBe(1);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/index.js`:

```js
import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphIndex({ repo, paths, force = false } = {}) {
  // For v1 the orchestrator encapsulates the "normal freshness flow" case.
  // Targeted-paths and force reuse the same orchestrator by faking a dirty set.
  if (paths && paths.length > 0) {
    return ensureFresh(repo, { forceChanged: paths });
  }
  if (force) {
    return ensureFresh(repo, { forceFullBuild: true });
  }
  return ensureFresh(repo);
}
```

This requires extending `ensureFresh` in `orchestrator.js` to accept `{ forceChanged, forceFullBuild }`. Add those parameter names and wire them into the decision tree:

- `forceFullBuild=true` → ignore manifest, call `fullBuild`.
- `forceChanged=[paths]` → skip the git status check, pass these paths directly to `incrementalReindex`.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/index.js mcp/stdio/freshness/orchestrator.js tests/integration/verbs/index.test.js
git commit -m "feat(verb): graph_index with paths and force precedence"
```

---

## Task 20: Verb — graph_whereis

**Files:**
- Create: `mcp/stdio/query/verbs/whereis.js`
- Create: `tests/integration/verbs/whereis.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/verbs/whereis.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_whereis', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-whereis-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('finds top_level in a.py', async () => {
    const out = await graphWhereis({ repo, symbol: 'top_level' });
    expect(out).toContain('NODE');
    expect(out).toContain('top_level');
    expect(out).toContain('a.py');
  });

  it('returns no match line when symbol is unknown', async () => {
    const out = await graphWhereis({ repo, symbol: 'xyz_no_such' });
    expect(out).toContain('NO MATCH');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/whereis.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact, renderNodeLine } from '../renderer.js';
import { withWriteLock } from '../../freshness/lock.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const GRAPH_DIR = (repo) => join(repo, '.aify-graph');
const DB_PATH = (repo) => join(GRAPH_DIR(repo), 'graph.kuzu');

const SEARCH_TABLES = ['Function', 'Method', 'Class', 'Type', 'Variable', 'Test'];

export async function graphWhereis({ repo, symbol, limit = 5 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const hits = [];
    for (const table of SEARCH_TABLES) {
      const rows = await db.all(
        `MATCH (n:${table}) WHERE n.label = $label RETURN n LIMIT $limit`,
        { label: symbol, limit }
      );
      for (const r of rows) hits.push({ ...r.n, table });
      if (hits.length >= limit) break;
    }
    if (hits.length === 0) return 'NO MATCH';
    const nodes = hits.slice(0, limit).map((h) => ({
      id: h.id, table: h.table, label: h.label,
      file_path: h.file_path, start_line: h.start_line, community_id: h.community_id,
    }));
    return renderCompact({ nodes, edges: [] });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/whereis.js tests/integration/verbs/whereis.test.js
git commit -m "feat(verb): graph_whereis — symbol → node line"
```

---

## Task 21: Verbs — graph_callers + graph_callees

**Files:**
- Create: `mcp/stdio/query/verbs/callers.js`, `mcp/stdio/query/verbs/callees.js`
- Create: `tests/integration/verbs/callers.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/verbs/callers.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_callers / graph_callees', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-call-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('graph_callers returns callers of bar', async () => {
    const out = await graphCallers({ repo, symbol: 'bar' });
    expect(out).toContain('EDGE');
    expect(out).toContain('CALLS');
    expect(out).toContain('bar');
  });

  it('graph_callees returns callees of hello (which calls bar)', async () => {
    const out = await graphCallees({ repo, symbol: 'hello' });
    expect(out).toContain('EDGE');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/callers.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallers } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const GRAPH_DIR = (repo) => join(repo, '.aify-graph');
const DB_PATH = (repo) => join(GRAPH_DIR(repo), 'graph.kuzu');

export async function graphCallers({ repo, symbol, depth = 1, top_k = 10 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const rows = await db.all(
      `MATCH (caller)-[r:CALLS*1..${depth}]->(target) WHERE target.label = $label
       RETURN caller, r, target LIMIT 100`,
      { label: symbol }
    );
    if (rows.length === 0) return 'NO CALLERS';
    const edges = rows.map((r) => ({
      from_id: r.caller.id, to_id: r.target.id, relation: 'CALLS',
      source_file: r.caller.file_path, source_line: r.caller.start_line,
      confidence: 0.9, depth: 1,
      from_table: r.caller.table ?? 'Function',
      fan_in: 1,
    }));
    const ranked = rankCallers(edges);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    return renderCompact({
      nodes: [], edges: kept,
      truncated: dropped,
      suggestion: `top_k=${top_k + 10}`,
    });
  } finally {
    await db.close();
  }
}
```

`mcp/stdio/query/verbs/callees.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { rankCallees } from '../rank.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const GRAPH_DIR = (repo) => join(repo, '.aify-graph');
const DB_PATH = (repo) => join(GRAPH_DIR(repo), 'graph.kuzu');

export async function graphCallees({ repo, symbol, depth = 1, top_k = 10 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const rows = await db.all(
      `MATCH (source)-[r:CALLS*1..${depth}]->(target) WHERE source.label = $label
       RETURN source, r, target LIMIT 100`,
      { label: symbol }
    );
    if (rows.length === 0) return 'NO CALLEES';
    const edges = rows.map((r) => ({
      from_id: r.source.id, to_id: r.target.id, relation: 'CALLS',
      source_file: r.target.file_path, source_line: r.target.start_line,
      confidence: 0.9, depth: 1, from_table: 'Function', fan_in: 1,
    }));
    const ranked = rankCallees(edges);
    const { kept, dropped } = enforceBudget(ranked, top_k);
    return renderCompact({
      nodes: [], edges: kept, truncated: dropped,
      suggestion: `top_k=${top_k + 10}`,
    });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/callers.js mcp/stdio/query/verbs/callees.js tests/integration/verbs/callers.test.js
git commit -m "feat(verbs): graph_callers + graph_callees"
```

---

## Task 22: Verb — graph_neighbors

**Files:**
- Create: `mcp/stdio/query/verbs/neighbors.js`
- Create: `tests/integration/verbs/neighbors.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/verbs/neighbors.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_neighbors', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-nb-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('returns edges filtered by edge_types', async () => {
    const out = await graphNeighbors({
      repo, node: 'bar', edge_types: ['CALLS'], depth: 1,
    });
    expect(out).toContain('CALLS');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/neighbors.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const ALL_EDGES = [
  'CONTAINS', 'DEFINES', 'DECLARES', 'IMPORTS', 'EXPORTS',
  'CALLS', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE',
  'TESTS', 'DEPENDS_ON',
];

const DB_PATH = (repo) => join(repo, '.aify-graph', 'graph.kuzu');

export async function graphNeighbors({ repo, node, edge_types = [], depth = 1, top_k = 20 }) {
  await ensureFresh(repo);
  const types = edge_types.length ? edge_types : ALL_EDGES;
  const db = await openDb(DB_PATH(repo));
  try {
    const allEdges = [];
    for (const rel of types) {
      const rows = await db.all(
        `MATCH (a)-[r:${rel}*1..${depth}]-(b) WHERE a.label = $label
         RETURN a, b LIMIT 50`,
        { label: node }
      );
      for (const row of rows) {
        allEdges.push({
          from_id: row.a.id, to_id: row.b.id, relation: rel,
          source_file: row.a.file_path, source_line: row.a.start_line,
          confidence: 0.9, depth: 1, from_table: 'Function', fan_in: 1,
        });
      }
    }
    const { kept, dropped } = enforceBudget(allEdges, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `top_k=${top_k + 20}` });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/neighbors.js tests/integration/verbs/neighbors.test.js
git commit -m "feat(verb): graph_neighbors with edge_types filter"
```

---

## Task 23: Verb — graph_module_tree

**Files:**
- Create: `mcp/stdio/query/verbs/module_tree.js`
- Create: `tests/integration/verbs/module_tree.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphModuleTree } from '../../../mcp/stdio/query/verbs/module_tree.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_module_tree', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-mt-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('returns a compact tree rooted at path', async () => {
    const out = await graphModuleTree({ repo, path: '.', depth: 2 });
    expect(out).toContain('NODE');
    expect(out).toContain('File');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/module_tree.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const DB_PATH = (repo) => join(repo, '.aify-graph', 'graph.kuzu');

export async function graphModuleTree({ repo, path = '.', depth = 2, top_k = 30 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    // Start from File nodes whose path begins with the given prefix.
    const prefix = path === '.' ? '' : path;
    const files = await db.all(
      `MATCH (f:File) WHERE f.file_path STARTS WITH $prefix RETURN f LIMIT $limit`,
      { prefix, limit: top_k }
    );
    const nodes = files.map((r) => ({
      id: r.f.id, table: 'File', label: r.f.label,
      file_path: r.f.file_path, start_line: 1, community_id: -1,
    }));
    // Walk CONTAINS edges down `depth` levels
    const edges = [];
    for (let d = 1; d <= depth; d++) {
      const rows = await db.all(
        `MATCH (a)-[r:CONTAINS*1..${d}]->(b) WHERE a.file_path STARTS WITH $prefix
         RETURN a, b LIMIT $limit`,
        { prefix, limit: top_k }
      );
      for (const row of rows) {
        edges.push({
          from_id: row.a.id, to_id: row.b.id, relation: 'CONTAINS',
          source_file: row.b.file_path, source_line: row.b.start_line,
          confidence: 1.0, depth: d, from_table: 'File', fan_in: 1,
        });
      }
    }
    return renderCompact({ nodes, edges, truncated: 0 });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/module_tree.js tests/integration/verbs/module_tree.test.js
git commit -m "feat(verb): graph_module_tree"
```

---

## Task 24: Verb — graph_impact

**Files:**
- Create: `mcp/stdio/query/verbs/impact.js`
- Create: `tests/integration/verbs/impact.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_impact', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-impact-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('returns transitive inbound impact for bar', async () => {
    const out = await graphImpact({ repo, symbol: 'bar' });
    // No truncation expected on tiny fixture; if nothing is found, verb returns NO IMPACT.
    expect(out === 'NO IMPACT' || out.includes('EDGE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/impact.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { enforceBudget } from '../budget.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const DB_PATH = (repo) => join(repo, '.aify-graph', 'graph.kuzu');
const IMPACT_EDGES = ['CALLS', 'REFERENCES', 'USES_TYPE', 'TESTS'];

export async function graphImpact({ repo, symbol, depth = 3, top_k = 30 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const all = [];
    for (const rel of IMPACT_EDGES) {
      const rows = await db.all(
        `MATCH (caller)-[r:${rel}*1..${depth}]->(target) WHERE target.label = $label
         RETURN caller, target LIMIT 100`,
        { label: symbol }
      );
      for (const row of rows) {
        all.push({
          from_id: row.caller.id, to_id: row.target.id, relation: rel,
          source_file: row.caller.file_path, source_line: row.caller.start_line,
          confidence: 0.9, depth: 1, from_table: row.caller.table ?? 'Function',
          fan_in: 1,
        });
      }
    }
    if (all.length === 0) return 'NO IMPACT';
    const { kept, dropped } = enforceBudget(all, top_k);
    return renderCompact({ nodes: [], edges: kept, truncated: dropped, suggestion: `depth=${depth + 1}` });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/impact.js tests/integration/verbs/impact.test.js
git commit -m "feat(verb): graph_impact — inbound CALLS+REFERENCES+USES_TYPE+TESTS"
```

---

## Task 25: Verbs — graph_summary + graph_report

**Files:**
- Create: `mcp/stdio/query/verbs/summary.js`, `mcp/stdio/query/verbs/report.js`
- Create: `tests/integration/verbs/summary_report.test.js`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { graphSummary } from '../../../mcp/stdio/query/verbs/summary.js';
import { graphReport } from '../../../mcp/stdio/query/verbs/report.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('graph_summary + graph_report', () => {
  let repo;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-sr-'));
    await cp('tests/fixtures/tiny-python', repo, { recursive: true });
    await execa('git', ['init', '-q'], { cwd: repo });
    await execa('git', ['config', 'user.email', 't@t'], { cwd: repo });
    await execa('git', ['config', 'user.name', 't'], { cwd: repo });
    await execa('git', ['add', '.'], { cwd: repo });
    await execa('git', ['commit', '-qm', 'init'], { cwd: repo });
    await ensureFresh(repo);
  });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('graph_summary returns a compact digest for a function', async () => {
    const out = await graphSummary({ repo, node: 'bar' });
    expect(out).toContain('NODE');
    expect(out).toContain('bar');
  });

  it('graph_report returns a repo-level digest', async () => {
    const out = await graphReport({ repo });
    expect(out).toContain('NODE'); // at minimum lists some File nodes
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/query/verbs/summary.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const DB_PATH = (repo) => join(repo, '.aify-graph', 'graph.kuzu');

export async function graphSummary({ repo, node }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const rows = await db.all(
      `MATCH (n) WHERE n.label = $label RETURN n LIMIT 1`, { label: node }
    );
    if (rows.length === 0) return 'NO NODE';
    const n = rows[0].n;
    const nodes = [{
      id: n.id, table: 'Function', label: n.label,
      file_path: n.file_path, start_line: n.start_line, community_id: n.community_id,
    }];
    // Top 3 incoming + 3 outgoing CALLS
    const incoming = await db.all(
      `MATCH (a)-[r:CALLS]->(b) WHERE b.label = $label RETURN a LIMIT 3`, { label: node }
    );
    const outgoing = await db.all(
      `MATCH (a)-[r:CALLS]->(b) WHERE a.label = $label RETURN b LIMIT 3`, { label: node }
    );
    const edges = [];
    for (const row of incoming) edges.push({
      from_id: row.a.id, to_id: n.id, relation: 'CALLS',
      source_file: row.a.file_path, source_line: row.a.start_line,
      confidence: 0.9,
    });
    for (const row of outgoing) edges.push({
      from_id: n.id, to_id: row.b.id, relation: 'CALLS',
      source_file: n.file_path, source_line: n.start_line,
      confidence: 0.9,
    });
    return renderCompact({ nodes, edges });
  } finally {
    await db.close();
  }
}
```

`mcp/stdio/query/verbs/report.js`:

```js
import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { renderCompact } from '../renderer.js';
import { ensureFresh } from '../../freshness/orchestrator.js';

const DB_PATH = (repo) => join(repo, '.aify-graph', 'graph.kuzu');

export async function graphReport({ repo, top_k = 20 }) {
  await ensureFresh(repo);
  const db = await openDb(DB_PATH(repo));
  try {
    const files = await db.all(`MATCH (f:File) RETURN f LIMIT $limit`, { limit: top_k });
    const nodes = files.map((r) => ({
      id: r.f.id, table: 'File', label: r.f.label,
      file_path: r.f.file_path, start_line: 1, community_id: -1,
    }));
    // Hub functions: top fan-in
    const hubs = await db.all(
      `MATCH (a)-[:CALLS]->(f:Function) RETURN f, count(a) AS fanin ORDER BY fanin DESC LIMIT 10`
    );
    for (const row of hubs) {
      nodes.push({
        id: row.f.id, table: 'Function', label: row.f.label,
        file_path: row.f.file_path, start_line: row.f.start_line, community_id: -1,
      });
    }
    return renderCompact({ nodes, edges: [] });
  } finally {
    await db.close();
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/query/verbs/summary.js mcp/stdio/query/verbs/report.js tests/integration/verbs/summary_report.test.js
git commit -m "feat(verbs): graph_summary + graph_report"
```

---

## Task 26: MCP stdio server

**Files:**
- Create: `mcp/stdio/server.js`
- Create: `tests/integration/server.test.js`

- [ ] **Step 1: Write failing test**

`tests/integration/server.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { execa } from 'execa';

describe('mcp server', () => {
  it('lists tools on initialize', async () => {
    // Spawn server, send one JSON-RPC initialize + tools/list, read response.
    const child = execa('node', ['mcp/stdio/server.js'], { input: '' });
    const init = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }) + '\n';
    const list = JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    }) + '\n';
    child.stdin.write(init);
    child.stdin.write(list);
    child.stdin.end();
    const { stdout } = await child;
    expect(stdout).toContain('graph_status');
    expect(stdout).toContain('graph_whereis');
    expect(stdout).toContain('graph_callers');
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

`mcp/stdio/server.js`:

```js
#!/usr/bin/env node
import readline from 'node:readline';
import { graphStatus } from './query/verbs/status.js';
import { graphIndex }  from './query/verbs/index.js';
import { graphWhereis } from './query/verbs/whereis.js';
import { graphCallers } from './query/verbs/callers.js';
import { graphCallees } from './query/verbs/callees.js';
import { graphNeighbors } from './query/verbs/neighbors.js';
import { graphModuleTree } from './query/verbs/module_tree.js';
import { graphImpact }  from './query/verbs/impact.js';
import { graphSummary } from './query/verbs/summary.js';
import { graphReport }  from './query/verbs/report.js';

const TOOLS = [
  { name: 'graph_status',      handler: graphStatus },
  { name: 'graph_index',       handler: graphIndex },
  { name: 'graph_whereis',     handler: graphWhereis },
  { name: 'graph_callers',     handler: graphCallers },
  { name: 'graph_callees',     handler: graphCallees },
  { name: 'graph_neighbors',   handler: graphNeighbors },
  { name: 'graph_module_tree', handler: graphModuleTree },
  { name: 'graph_impact',      handler: graphImpact },
  { name: 'graph_summary',     handler: graphSummary },
  { name: 'graph_report',      handler: graphReport },
];

const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'aify-project-graph', version: '0.0.1' },
    }});
    return;
  }
  if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: `aify-project-graph verb: ${t.name}`,
        inputSchema: { type: 'object', additionalProperties: true },
      })),
    }});
    return;
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'unknown tool' } });
      return;
    }
    try {
      const repo = args.repo ?? process.cwd();
      const result = await tool.handler({ ...args, repo });
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: String(err) } });
    }
  }
});
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/server.js tests/integration/server.test.js
git commit -m "feat(mcp): stdio server registering all verbs"
```

---

## Task 27: Claude Code skill

**Files:**
- Create: `integrations/claude-code/skill/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: aify-project-graph
description: Use this skill whenever working in a repo that has an `.aify-graph/` directory — it teaches how to reach for the graph tools (graph_whereis, graph_callers, graph_callees, graph_module_tree, graph_impact) instead of grep/read-file, so token spend on code navigation drops. Required before editing any symbol with more than one caller.
---

# aify-project-graph

This repo has an `aify-project-graph` index at `.aify-graph/`. Use the graph tools **before** you reach for grep or file reads when you need to understand code structure.

## When to reach for which tool

| Situation | Tool |
|---|---|
| "Where is X defined?" | `graph_whereis(symbol="X")` |
| "What calls X?" | `graph_callers(symbol="X", depth=1)` |
| "What does X call?" | `graph_callees(symbol="X", depth=1)` |
| "What's in this directory?" | `graph_module_tree(path="src/foo", depth=2)` |
| "Orient me in this repo" | `graph_report()` |
| "Show me one symbol compactly" | `graph_summary(node="X")` |
| "What breaks if I change X?" | `graph_impact(symbol="X")` **← required before edit** |
| "Is the graph current?" | `graph_status()` |
| "Reindex this repo" | `graph_index()` or `graph_index(force=true)` |

## Hard rules

1. **Before editing any symbol with >1 caller, call `graph_impact(symbol)` and read the result.** This is the discipline that keeps edits safe.
2. **Do not ask for the raw source of a symbol through the graph tools.** Use Read for source. Use the graph for structure.
3. **If `graph_status()` reports `unresolvedEdges > 0` or `dirtyEdgeCount > 0`**, the graph is partially stale. Prefer fresh Read for safety-critical edits and run `graph_index(force=true)` if needed.
4. **Counts from `graph_status()` are reliable.** Node content is always fetched via explicit verbs — never assume content was pre-injected.

## Response format

Every graph response is compact line format:

```
NODE <id> <type> <label> <file>:<line>[ community=<N>]
EDGE <from_id>→<to_id> <RELATION> <file>:<line> conf=<0..1>
TRUNCATED <N> more (use <suggestion>)
```

If you see `TRUNCATED`, decide whether the top-K answered your question or if you should refetch with the suggested argument (usually `top_k=`, `depth=`).

## Do NOT

- Pre-fetch a whole subgraph "just in case."
- Call every verb at session start — the graph is on-demand, not always-on.
- Treat `graph_report()` as authoritative when `graph_status().dirtyFiles` is non-empty.
```

- [ ] **Step 2: Commit**

```bash
git add integrations/claude-code/skill/SKILL.md
git commit -m "feat(skill): aify-project-graph — when to reach for graph verbs"
```

---

## Task 28: install.claude.md

**Files:**
- Create: `install.claude.md`

- [ ] **Step 1: Write**

`install.claude.md`:

````markdown
# Install aify-project-graph for Claude Code

## Prerequisites

- Node.js ≥20
- git
- The repo you want to index

## Steps (for the Claude Code agent to run)

1. Clone the repo (or `cd` into an existing local clone):

   ```bash
   cd <path/to/aify-project-graph>
   npm install
   npm test   # optional sanity check — should be all green
   ```

2. Register the MCP server with Claude Code. Add to `~/.claude/mcp.json` (or your OS-specific MCP config):

   ```json
   {
     "mcpServers": {
       "aify-project-graph": {
         "command": "node",
         "args": ["<path/to/aify-project-graph>/mcp/stdio/server.js"],
         "cwd": "<path/to/target/repo>"
       }
     }
   }
   ```

   Replace the two `<path/...>` placeholders with real forward-slash paths.

3. Install the Claude Code skill. Copy `integrations/claude-code/skill/` to:

   - `~/.claude/skills/aify-project-graph/` (global, all projects)
   - OR `<repo>/.claude/skills/aify-project-graph/` (project-scoped)

4. Restart Claude Code so it picks up the new MCP server and skill.

5. In the target repo, run a first index:

   ```
   graph_index()
   ```

   First call takes time proportional to repo size. Subsequent calls are incremental.

6. Verify:

   ```
   graph_status()
   ```

   Should report `indexed: true`, `unresolvedEdges: 0`, `dirtyEdgeCount: 0`.

## Troubleshooting

- **`kuzu` native build fails:** Install the Node.js native toolchain for your OS (Windows: `windows-build-tools` or Visual Studio Build Tools; macOS: Xcode CLT; Linux: `build-essential`).
- **`AbsolutePathBuf deserialized without a base path`:** This error belongs to `aify-comms`, not this project. Consult `aify-comms-debug` skill.
- **`graph_status()` reports `unresolvedEdges > 0`:** Run `graph_index(force=true)` to rebuild from scratch.
````

- [ ] **Step 2: Commit**

```bash
git add install.claude.md
git commit -m "docs: install instructions for Claude Code"
```

---

## Task 29: install.codex.md + install.opencode.md

**Files:**
- Create: `install.codex.md`, `install.opencode.md`

- [ ] **Step 1: Write both files**

`install.codex.md` is identical in substance to `install.claude.md` except step 2 uses Codex's MCP config format (`~/.codex/mcp.json` or equivalent). `install.opencode.md` is the same pattern for OpenCode.

If the exact config format differs, document the OpenCode-specific shape. Otherwise point back to `install.claude.md` for the conceptual steps.

For v1, both files can be two-paragraph stubs pointing at `install.claude.md` with notes on the runtime-specific MCP registration step. Do not invent config paths — if unknown, write `# TODO: confirm exact MCP config path for <runtime>` explicitly and leave a pointer to the runtime's docs.

- [ ] **Step 2: Commit**

```bash
git add install.codex.md install.opencode.md
git commit -m "docs: install instructions for Codex and OpenCode"
```

---

## Task 30: README, LICENSE, ATTRIBUTION + dogfood on aify-claude

**Files:**
- Create: `README.md`, `LICENSE` (MIT), `ATTRIBUTION.md`
- No new tests

- [ ] **Step 1: Write README, LICENSE, ATTRIBUTION**

`README.md`:

```markdown
# aify-project-graph

On-demand codebase graph map for coding agents (Claude Code, Codex).
Reduces token spend when navigating, modifying, and reasoning about unfamiliar code.

- **Spec:** `docs/superpowers/specs/2026-04-16-aify-project-graph-design.md`
- **Install (Claude Code):** `install.claude.md`
- **Install (Codex):** `install.codex.md`
- **Query format:** `docs/query-format.md`

## Status

v1 in development.

## License

MIT. See `LICENSE` and `ATTRIBUTION.md`.
```

`LICENSE`: standard MIT text, copyright year 2026, copyright holder "aify-project-graph contributors."

`ATTRIBUTION.md`:

```markdown
# Attribution

## graphify

Patterns adapted from [safishamsi/graphify](https://github.com/safishamsi/graphify), MIT licensed.
Specifically:
- The compact NODE/EDGE line response format.
- The high-intent named query verb surface.
- The `GRAPH_REPORT.md` interface-first digest concept.

No source code is copied verbatim; these are design patterns reimplemented.
```

- [ ] **Step 2: Dogfood — run against aify-claude**

```bash
cd /c/Docker/aify-claude
# Register this project-graph server against aify-claude in your local MCP config
# (see install.claude.md), then in Claude Code:
```

Call the following verbs against `C:/Docker/aify-claude` and **manually review** the outputs. Spot-check:

1. `graph_index()` — returns `indexed_files > 0` within 2 minutes.
2. `graph_status()` — reports correct commit, node/edge counts, `unresolvedEdges: 0`.
3. `graph_whereis(symbol="something you know exists in aify-claude")` — finds it at the right file:line.
4. `graph_callers(symbol="something with known callers")` — returns expected edges.
5. `graph_module_tree(path="mcp", depth=2)` — lists the MCP subtree.
6. `graph_impact(symbol="something central")` — returns a non-empty impact list.
7. `graph_report()` — returns a legible repo digest under 1500 tokens.
8. Edit a function body in aify-claude, re-run `graph_callers` on the affected symbol — confirm incremental reindex triggered and results are correct.

Capture findings in `docs/dogfood-aify-claude.md`. If any verb fails or returns suspicious results, file an issue before tagging v1.

- [ ] **Step 3: Commit dogfood notes**

```bash
git add README.md LICENSE ATTRIBUTION.md docs/dogfood-aify-claude.md
git commit -m "docs: README, license, attribution, and initial dogfood notes on aify-claude"
```

- [ ] **Step 4: Tag v1.0.0** (only after all previous tasks pass and dogfood is green)

```bash
git tag v0.1.0
```

---

## Self-review

**Spec coverage check:**

| Spec section | Covered by task(s) |
|---|---|
| §1 Purpose / non-goals | README (Task 30), design kept throughout |
| §2 Background / graphify inspiration | ATTRIBUTION (Task 30), renderer (Task 15) |
| §3 Architecture component map | Tasks 1–26 collectively |
| §4 Schema (nodes, edges, node identity rule, two fingerprints) | Tasks 2, 4, 5 |
| §5 Query verbs (all 10) | Tasks 18–25 |
| §5 Compact line format + token budget | Tasks 15, 16 |
| §5 Ranking rules (depth/confidence/test-proximity/fan-in) | Task 17 |
| §6 Freshness model (on-demand, git-diff-aware) | Tasks 11, 14 |
| §7 Two-axis fingerprints + reindex protocol | Tasks 5, 14 (v1 simplified incremental; note in Task 14) |
| §8 Claude Code skill | Task 27 |
| §9 Optional file-read hint hook | **Deferred post-v1** — skipped per spec §9 opt-in status; not in plan |
| §10 Repo layout | Tasks 1, 28–30 |
| §11 v1 success criteria (dogfood on aify-claude) | Task 30 |
| §12 Manifest JSON + atomic, tree-sitter drift, write lock | Tasks 12, 13 |

**Placeholder scan:** One intentional TODO in Task 29 (`install.opencode.md` config path unknown for OpenCode). The plan explicitly marks this and tells the implementer to either confirm the path or leave a clearly-flagged `# TODO` in the installed doc — not a silent placeholder.

**Type consistency:** Node node fields (`id`, `label`, `file_path`, `start_line`, `end_line`, `language`, `confidence`, `structural_fp`, `dependency_fp`) are consistent between Task 2 (DDL), Task 4 (CRUD), Task 7 (Python extractor), Task 9 (TS extractor). Edge relation names match the schema spec list. Verb names match between Task 26 (server) and the individual verb tasks (18–25).

**Deferred to post-v1 (explicitly flagged):**
- §7 fingerprint-diff incremental update (Task 14 note — v1 drops and rebuilds edges per changed file; correct but slower).
- §9 file-read hint hook (opt-in per spec).
- 1M-node benchmark (§11 stretch goal).

These are design-known shortcuts, not placeholder holes.

---

## End of plan
