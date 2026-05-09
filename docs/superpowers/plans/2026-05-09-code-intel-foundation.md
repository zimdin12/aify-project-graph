# Code-Intel Foundation (M0 + M0.5 + M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify the code-intel provider boundary contract (M0.5) as v0.2 schemas, upgrade the existing v0.1 import foundation (`d7bf17a`) to handle v0.2 records and collection-batch envelopes, ship a fixture provider for test use, and lock the contract behind validators so future provider work (M2 C++ clangd) can plug in cleanly.

**Architecture:**
- Two JSON Schemas: `code-intel-record.v0.2.schema.json` (single record) and `code-intel-collection.v0.2.schema.json` (batch envelope holding many records + metadata).
- Backwards-compatible importer: detects v0.1 vs v0.2 by presence of `schema_version` + `collection` fields; v0.1 path stays untouched.
- Path normalization helper enforces repo-relative forward-slash on every record at ingest.
- Fixture provider emits valid v0.2 collections for test use.

**Tech Stack:** Node.js 20+, ajv (JSON Schema validator), better-sqlite3, vitest (existing test runner).

**Plan series context:** This is Plan #1 of a series. Plans #2 (C++ clangd provider), #3 (graph merge + freshness), #4 (packet v2 + verify mode), #5 (bridge integration), #6 (eval + install lab) follow as #1 lands. Superplan: `docs/superpowers/specs/2026-05-09-next-gen-code-intel-bridge-superplan.md`.

---

## File Structure

**Create:**
- `docs/schemas/code-intel-record.v0.2.schema.json` — single-record schema.
- `docs/schemas/code-intel-collection.v0.2.schema.json` — collection-batch envelope.
- `docs/integrations/code-intel-provider-contract.md` — human-readable contract spec.
- `mcp/stdio/ingest/code-intel/paths.js` — repo-relative path normalization helper.
- `mcp/stdio/ingest/code-intel/v02.js` — v0.2 schema/validation module (separate from v0.1 to keep the migration explicit).
- `tools/code-intel/fixture/provider.mjs` — fixture provider emitting valid v0.2 collections.
- `tests/unit/ingest/code-intel/paths.test.js`
- `tests/unit/ingest/code-intel/v02.test.js`
- `tests/unit/ingest/code-intel/importer-v02.test.js`
- `tests/fixtures/code-intel/v02/cpp-basic-collection.json` — valid v0.2 fixture.
- `tests/fixtures/code-intel/v02/cpp-partial-collection.json` — partial-status fixture.

**Modify:**
- `mcp/stdio/ingest/code-intel/schema.js` — add v0.2 dispatcher; keep v0.1 path.
- `mcp/stdio/ingest/code-intel/importer.js` — support v0.2 collection envelopes.
- `docs/schemas/code-intel-record.schema.json` — leave unchanged; v0.1 stays the default until full migration.
- `docs/schema-versions.md` — add v0.2 row.
- `package.json` — add `ajv` dependency if not present (verify in Task 1).

---

## Task 1: Verify ajv presence + decide validator stance

**Files:**
- Read: `package.json`
- Read: `mcp/stdio/ingest/code-intel/schema.js`

- [ ] **Step 1: Inspect existing dependencies and validation approach**

Run: `cat package.json | grep -E "ajv|json-schema"`
Run: `head -50 mcp/stdio/ingest/code-intel/schema.js`

If ajv is not present, the existing `schema.js` is doing manual validation. v0.2 introduces enough structure (collection envelopes, status taxonomy) that a real JSON Schema validator pays for itself.

- [ ] **Step 2: Add ajv as a dependency if absent**

If absent, run:

```bash
npm install --save ajv@^8.17.1 ajv-formats@^3.0.1
```

If present, skip.

- [ ] **Step 3: Commit dependency change if any**

```bash
git add package.json package-lock.json
git commit -m "chore: add ajv for code-intel v0.2 validation"
```

Skip commit if no change.

---

## Task 2: Define v0.2 record schema

**Files:**
- Create: `docs/schemas/code-intel-record.v0.2.schema.json`

- [ ] **Step 1: Write the schema file**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aify.dev/schemas/code-intel-record.v0.2.schema.json",
  "title": "Aify code-intel record v0.2",
  "type": "object",
  "required": ["kind", "schema_version", "collectionId", "language"],
  "properties": {
    "schema_version": { "const": "0.2" },
    "collectionId": { "type": "string", "minLength": 1 },
    "kind": {
      "type": "string",
      "enum": ["definition", "reference", "call", "include", "diagnostic", "hover", "symbol"]
    },
    "language": { "type": "string", "minLength": 1 },
    "symbolId": { "type": "string" },
    "qname": { "type": "string" },
    "name": { "type": "string" },
    "signature": { "type": "string" },
    "container": { "type": "string" },
    "symbol_kind": { "type": "string" },
    "file": { "type": "string", "pattern": "^[^/].*$|^$" },
    "range": { "$ref": "#/$defs/range" },
    "start_line": { "type": "integer", "minimum": 1 },
    "end_line": { "type": "integer", "minimum": 1 },
    "context": {
      "type": "string",
      "enum": ["call_expr", "virtual_call", "template_inst", "macro_expansion", "include", "other"]
    },
    "confidence": {
      "type": "string",
      "enum": ["high", "medium", "low"]
    },
    "provenance": { "type": "string", "minLength": 1 },
    "freshness": { "type": "string" },
    "result_state": {
      "type": "string",
      "enum": ["found", "not_found_after_retry", "not_collected"]
    },
    "from": { "$ref": "#/$defs/endpoint" },
    "to": { "$ref": "#/$defs/endpoint" },
    "severity": { "type": "string", "enum": ["error", "warning", "info", "hint"] },
    "code": { "type": "string" },
    "message": { "type": "string" },
    "raw": { "type": "object" }
  },
  "allOf": [
    {
      "if": { "properties": { "kind": { "const": "diagnostic" } } },
      "then": { "required": ["file", "severity", "message"] }
    },
    {
      "if": { "properties": { "kind": { "enum": ["definition", "reference", "call"] } } },
      "then": { "required": ["symbolId", "qname"] }
    }
  ],
  "$defs": {
    "range": {
      "type": "object",
      "required": ["start", "end"],
      "properties": {
        "start": { "$ref": "#/$defs/position" },
        "end": { "$ref": "#/$defs/position" }
      }
    },
    "position": {
      "type": "object",
      "required": ["line"],
      "properties": {
        "line": { "type": "integer", "minimum": 1 },
        "col": { "type": "integer", "minimum": 1 }
      }
    },
    "endpoint": {
      "type": "object",
      "properties": {
        "symbolId": { "type": "string" },
        "qname": { "type": "string" },
        "name": { "type": "string" },
        "file": { "type": "string" },
        "line": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

The `file` pattern `^[^/].*$|^$` enforces "no leading slash" — repo-relative is the contract; the empty alternative permits a synthetic record like a top-level diagnostic from the provider itself.

- [ ] **Step 2: Commit**

```bash
git add docs/schemas/code-intel-record.v0.2.schema.json
git commit -m "feat(schema): add code-intel record v0.2"
```

---

## Task 3: Define v0.2 collection envelope schema

**Files:**
- Create: `docs/schemas/code-intel-collection.v0.2.schema.json`

- [ ] **Step 1: Write the schema file**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://aify.dev/schemas/code-intel-collection.v0.2.schema.json",
  "title": "Aify code-intel collection v0.2 (provider response envelope)",
  "type": "object",
  "required": [
    "schema_version",
    "collectionId",
    "provider",
    "providerVersion",
    "projectRoot",
    "session",
    "operations",
    "status",
    "records"
  ],
  "properties": {
    "schema_version": { "const": "0.2" },
    "collectionId": { "type": "string", "minLength": 1 },
    "provider": { "type": "string", "minLength": 1 },
    "providerVersion": { "type": "string", "minLength": 1 },
    "projectRoot": { "type": "string", "minLength": 1 },
    "session": {
      "type": "object",
      "required": ["collectedAt", "freshnessBasis"],
      "properties": {
        "collectedAt": { "type": "string", "format": "date-time" },
        "freshnessBasis": {
          "type": "string",
          "enum": ["git_commit", "file_mtime", "compile_db_hash", "unknown"]
        },
        "freshnessValue": { "type": "string" },
        "compileDbHash": { "type": "string" },
        "warmedFiles": { "type": "integer", "minimum": 0 },
        "warmupMs": { "type": "integer", "minimum": 0 }
      }
    },
    "operations": {
      "type": "object",
      "patternProperties": {
        "^(definitions|references|hover|diagnostics|symbols)$": {
          "type": "object",
          "required": ["status"],
          "properties": {
            "status": {
              "type": "string",
              "enum": ["ok", "partial", "not_collected", "unsupported"]
            },
            "count": { "type": "integer", "minimum": 0 },
            "reason": { "type": "string" },
            "notCollectedFiles": {
              "type": "array",
              "items": { "type": "string" }
            }
          }
        }
      },
      "additionalProperties": false
    },
    "status": {
      "type": "string",
      "enum": ["ok", "partial", "error"]
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["code", "message"],
        "properties": {
          "code": {
            "type": "string",
            "enum": [
              "provider_missing",
              "compile_db_missing",
              "language_unsupported",
              "wrapper_failed",
              "language_server_missing",
              "language_server_timeout",
              "internal_error"
            ]
          },
          "message": { "type": "string" },
          "hint": { "type": "string" }
        }
      }
    },
    "records": {
      "type": "array",
      "items": { "$ref": "https://aify.dev/schemas/code-intel-record.v0.2.schema.json" }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/schemas/code-intel-collection.v0.2.schema.json
git commit -m "feat(schema): add code-intel collection envelope v0.2"
```

---

## Task 4: Implement path normalization helper

**Files:**
- Create: `mcp/stdio/ingest/code-intel/paths.js`
- Create: `tests/unit/ingest/code-intel/paths.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/ingest/code-intel/paths.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { toRepoRelative, isRepoRelative } from '../../../../mcp/stdio/ingest/code-intel/paths.js';

describe('code-intel paths', () => {
  it('normalizes absolute path inside projectRoot to forward-slash repo-relative', () => {
    const result = toRepoRelative('/repo/root', '/repo/root/src/foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('normalizes Windows-style absolute path inside projectRoot', () => {
    const result = toRepoRelative('C:\\repo\\root', 'C:\\repo\\root\\src\\foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('passes through already-repo-relative forward-slash paths unchanged', () => {
    const result = toRepoRelative('/repo/root', 'src/foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('rewrites backslashes in already-relative paths', () => {
    const result = toRepoRelative('/repo/root', 'src\\foo.cpp');
    expect(result).toBe('src/foo.cpp');
  });

  it('throws when path escapes projectRoot', () => {
    expect(() => toRepoRelative('/repo/root', '/elsewhere/foo.cpp')).toThrow(/outside projectRoot/);
  });

  it('throws when path escapes projectRoot via .. traversal', () => {
    expect(() => toRepoRelative('/repo/root', '/repo/root/../escape.cpp')).toThrow(/outside projectRoot/);
  });

  it('isRepoRelative returns true for forward-slash relative paths', () => {
    expect(isRepoRelative('src/foo.cpp')).toBe(true);
    expect(isRepoRelative('')).toBe(true);
  });

  it('isRepoRelative returns false for absolute paths', () => {
    expect(isRepoRelative('/abs/path')).toBe(false);
    expect(isRepoRelative('C:/abs/path')).toBe(false);
    expect(isRepoRelative('C:\\abs\\path')).toBe(false);
  });

  it('isRepoRelative returns false for paths with backslashes', () => {
    expect(isRepoRelative('src\\foo.cpp')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ingest/code-intel/paths.test.js`
Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Implement the helper**

Create `mcp/stdio/ingest/code-intel/paths.js`:

```js
import path from 'node:path';

export function isRepoRelative(p) {
  if (typeof p !== 'string') return false;
  if (p === '') return true;
  if (p.includes('\\')) return false;
  if (p.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return true;
}

export function toRepoRelative(projectRoot, filePath) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    throw new Error('toRepoRelative: projectRoot is required');
  }
  if (typeof filePath !== 'string') {
    throw new Error('toRepoRelative: filePath must be string');
  }

  const normalizedRoot = path.resolve(projectRoot);

  if (isRepoRelative(filePath)) {
    return filePath;
  }

  let candidate = filePath;
  if (!path.isAbsolute(candidate) && /\\/.test(candidate)) {
    return candidate.replace(/\\/g, '/');
  }
  if (!path.isAbsolute(candidate)) {
    return candidate;
  }

  const resolved = path.resolve(candidate);
  const rel = path.relative(normalizedRoot, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`toRepoRelative: path '${filePath}' is outside projectRoot '${projectRoot}'`);
  }

  return rel.split(path.sep).join('/');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ingest/code-intel/paths.test.js`
Expected: PASS, 9/9 tests.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/ingest/code-intel/paths.js tests/unit/ingest/code-intel/paths.test.js
git commit -m "feat(code-intel): add repo-relative path normalization helper"
```

---

## Task 5: Implement v0.2 schema validator module

**Files:**
- Create: `mcp/stdio/ingest/code-intel/v02.js`
- Create: `tests/unit/ingest/code-intel/v02.test.js`
- Create: `tests/fixtures/code-intel/v02/cpp-basic-collection.json`
- Create: `tests/fixtures/code-intel/v02/cpp-partial-collection.json`

- [ ] **Step 1: Write the basic-collection fixture**

Create `tests/fixtures/code-intel/v02/cpp-basic-collection.json`:

```json
{
  "schema_version": "0.2",
  "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
  "provider": "cpp-clangd",
  "providerVersion": "0.1.0",
  "projectRoot": "/repo/root",
  "session": {
    "collectedAt": "2026-05-09T12:34:56Z",
    "freshnessBasis": "compile_db_hash",
    "freshnessValue": "abc123",
    "compileDbHash": "abc123",
    "warmedFiles": 18,
    "warmupMs": 1400
  },
  "operations": {
    "definitions": { "status": "ok", "count": 1 },
    "references":  { "status": "ok", "count": 1 },
    "diagnostics": { "status": "ok", "count": 0 }
  },
  "status": "ok",
  "records": [
    {
      "schema_version": "0.2",
      "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
      "kind": "definition",
      "language": "cpp",
      "symbolId": "c:@N@ns@F@foo#I#",
      "qname": "ns::foo(int)",
      "signature": "void(int)",
      "container": "ns",
      "file": "src/foo.cpp",
      "range": { "start": { "line": 12, "col": 5 }, "end": { "line": 12, "col": 8 } },
      "confidence": "high",
      "provenance": "cpp-clangd@0.1.0",
      "freshness": "compile_db_hash:abc123",
      "result_state": "found"
    },
    {
      "schema_version": "0.2",
      "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
      "kind": "reference",
      "language": "cpp",
      "symbolId": "c:@N@ns@F@foo#I#",
      "qname": "ns::foo(int)",
      "container": "ns",
      "file": "src/bar.cpp",
      "range": { "start": { "line": 7, "col": 3 }, "end": { "line": 7, "col": 6 } },
      "context": "call_expr",
      "confidence": "high",
      "provenance": "cpp-clangd@0.1.0",
      "result_state": "found"
    }
  ]
}
```

- [ ] **Step 2: Write the partial-collection fixture**

Create `tests/fixtures/code-intel/v02/cpp-partial-collection.json`:

```json
{
  "schema_version": "0.2",
  "collectionId": "ci-2026-05-09T13-00-00Z-def456",
  "provider": "cpp-clangd",
  "providerVersion": "0.1.0",
  "projectRoot": "/repo/root",
  "session": {
    "collectedAt": "2026-05-09T13:00:00Z",
    "freshnessBasis": "compile_db_hash",
    "compileDbHash": "def456"
  },
  "operations": {
    "definitions": { "status": "ok", "count": 1 },
    "references": {
      "status": "partial",
      "count": 3,
      "notCollectedFiles": ["src/baz.cpp", "src/qux.cpp"]
    },
    "diagnostics": { "status": "not_collected", "reason": "not_requested" },
    "hover": { "status": "unsupported" }
  },
  "status": "partial",
  "records": [
    {
      "schema_version": "0.2",
      "collectionId": "ci-2026-05-09T13-00-00Z-def456",
      "kind": "definition",
      "language": "cpp",
      "symbolId": "c:@N@ns@F@bar#",
      "qname": "ns::bar()",
      "container": "ns",
      "file": "src/bar.cpp",
      "range": { "start": { "line": 3, "col": 5 }, "end": { "line": 3, "col": 8 } },
      "confidence": "high",
      "provenance": "cpp-clangd@0.1.0",
      "result_state": "found"
    }
  ]
}
```

- [ ] **Step 3: Write failing tests**

Create `tests/unit/ingest/code-intel/v02.test.js`:

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateRecord,
  validateCollection,
  isV02Collection
} from '../../../../mcp/stdio/ingest/code-intel/v02.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../fixtures/code-intel/v02');

const loadFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));

describe('code-intel v0.2 validation', () => {
  it('validates the basic collection fixture', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validates the partial collection fixture', () => {
    const collection = loadFixture('cpp-partial-collection.json');
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
  });

  it('rejects a collection missing collectionId', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    delete collection.collectionId;
    const result = validateCollection(collection);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /collectionId/.test(e))).toBe(true);
  });

  it('rejects a collection with unknown error code', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    collection.status = 'error';
    collection.errors = [{ code: 'made_up_code', message: 'x' }];
    const result = validateCollection(collection);
    expect(result.valid).toBe(false);
  });

  it('rejects a record with absolute path', () => {
    const record = {
      schema_version: '0.2',
      collectionId: 'ci-1',
      kind: 'diagnostic',
      language: 'cpp',
      file: '/abs/path/file.cpp',
      severity: 'error',
      message: 'oops'
    };
    const result = validateRecord(record);
    expect(result.valid).toBe(false);
  });

  it('rejects a definition record missing symbolId', () => {
    const record = {
      schema_version: '0.2',
      collectionId: 'ci-1',
      kind: 'definition',
      language: 'cpp',
      qname: 'ns::foo()',
      file: 'src/foo.cpp'
    };
    const result = validateRecord(record);
    expect(result.valid).toBe(false);
  });

  it('isV02Collection returns true for v0.2 envelope', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    expect(isV02Collection(collection)).toBe(true);
  });

  it('isV02Collection returns false for v0.1 record', () => {
    const v01 = { kind: 'symbol', qname: 'foo', file_path: 'src/foo.cpp' };
    expect(isV02Collection(v01)).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ingest/code-intel/v02.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 5: Implement the validator module**

Create `mcp/stdio/ingest/code-intel/v02.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, '../../../../docs/schemas');

const recordSchema = JSON.parse(
  fs.readFileSync(path.join(schemasDir, 'code-intel-record.v0.2.schema.json'), 'utf8')
);
const collectionSchema = JSON.parse(
  fs.readFileSync(path.join(schemasDir, 'code-intel-collection.v0.2.schema.json'), 'utf8')
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(recordSchema);
ajv.addSchema(collectionSchema);

const recordValidator = ajv.getSchema(recordSchema.$id);
const collectionValidator = ajv.getSchema(collectionSchema.$id);

function formatErrors(errors) {
  if (!errors) return [];
  return errors.map(e => `${e.instancePath || '/'} ${e.message} (${JSON.stringify(e.params)})`);
}

export function validateRecord(record) {
  const ok = recordValidator(record);
  return { valid: !!ok, errors: formatErrors(recordValidator.errors) };
}

export function validateCollection(collection) {
  const ok = collectionValidator(collection);
  return { valid: !!ok, errors: formatErrors(collectionValidator.errors) };
}

export function isV02Collection(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.schema_version === '0.2' &&
    typeof value.collectionId === 'string' &&
    Array.isArray(value.records)
  );
}

export const V02_RECORD_SCHEMA_ID = recordSchema.$id;
export const V02_COLLECTION_SCHEMA_ID = collectionSchema.$id;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ingest/code-intel/v02.test.js`
Expected: PASS, 8/8 tests.

- [ ] **Step 7: Commit**

```bash
git add mcp/stdio/ingest/code-intel/v02.js tests/unit/ingest/code-intel/v02.test.js tests/fixtures/code-intel/v02/
git commit -m "feat(code-intel): add v0.2 schema validators + fixtures"
```

---

## Task 6: Update existing schema dispatcher to detect and route v0.2

**Files:**
- Modify: `mcp/stdio/ingest/code-intel/schema.js`

- [ ] **Step 1: Read the existing schema.js to find its public entry points**

Run: `grep -n "export" mcp/stdio/ingest/code-intel/schema.js`

Capture exported function names. The plan assumes the file exports a function like `normalizeRecord(record)` or similar. If the actual exports differ, adapt the dispatcher to wrap the real entry point.

- [ ] **Step 2: Add v0.2 detection that delegates to v02.js**

At the top of `mcp/stdio/ingest/code-intel/schema.js`, add:

```js
import { isV02Collection, validateCollection as validateV02Collection, validateRecord as validateV02Record } from './v02.js';
```

After the existing exports, add:

```js
export function detectSchemaVersion(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if (isV02Collection(value)) return '0.2';
  if (value.schema_version === '0.2') return '0.2';
  return '0.1';
}

export function validateAny(value) {
  const version = detectSchemaVersion(value);
  if (version === '0.2') {
    return Array.isArray(value.records)
      ? validateV02Collection(value)
      : validateV02Record(value);
  }
  return { valid: true, errors: [], version };
}
```

The v0.1 path remains permissive (matches current `d7bf17a` behavior); v0.2 enforces validation strictly.

- [ ] **Step 3: Add a unit test for the dispatcher**

Append to `tests/unit/ingest/code-intel/v02.test.js`:

```js
import { detectSchemaVersion, validateAny } from '../../../../mcp/stdio/ingest/code-intel/schema.js';

describe('schema dispatcher', () => {
  it('detects v0.2 collection', () => {
    expect(detectSchemaVersion({ schema_version: '0.2', collectionId: 'x', records: [] })).toBe('0.2');
  });

  it('detects v0.1 record (legacy)', () => {
    expect(detectSchemaVersion({ kind: 'symbol', qname: 'foo' })).toBe('0.1');
  });

  it('validateAny enforces v0.2 envelopes', () => {
    const result = validateAny({ schema_version: '0.2', collectionId: 'x', records: [] });
    expect(result.valid).toBe(false);
  });

  it('validateAny is permissive for v0.1', () => {
    const result = validateAny({ kind: 'symbol', qname: 'foo' });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/ingest/code-intel/v02.test.js`
Expected: PASS, 12/12 tests.

- [ ] **Step 5: Commit**

```bash
git add mcp/stdio/ingest/code-intel/schema.js tests/unit/ingest/code-intel/v02.test.js
git commit -m "feat(code-intel): dispatch v0.2 vs v0.1 in schema entry points"
```

---

## Task 7: Teach the importer to ingest v0.2 collection envelopes

**Files:**
- Modify: `mcp/stdio/ingest/code-intel/importer.js`
- Create: `tests/unit/ingest/code-intel/importer-v02.test.js`

- [ ] **Step 1: Inspect the current importer interface**

Run: `grep -n "export\|function importCodeIntel\|module.exports" mcp/stdio/ingest/code-intel/importer.js`

Identify the main public entry. The plan assumes a function like `importCodeIntel(filepath, db, options)` that reads JSONL line-by-line. v0.2 introduces single-file JSON envelopes, so the importer needs to dispatch by file shape.

- [ ] **Step 2: Write failing test for v0.2 envelope ingest**

Create `tests/unit/ingest/code-intel/importer-v02.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { importCodeIntel } from '../../../../mcp/stdio/ingest/code-intel/importer.js';
import { applySchema } from '../../../../mcp/stdio/storage/schema.js';

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/code-intel/v02', name),
      'utf8'
    )
  );
}

function freshDb() {
  const db = new Database(':memory:');
  applySchema(db);
  return db;
}

describe('importer v0.2', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `apg-ci-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  it('ingests a v0.2 basic collection without throwing', () => {
    fs.writeFileSync(tmpFile, JSON.stringify(loadFixture('cpp-basic-collection.json')));
    const db = freshDb();
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.recordsImported).toBe(2);
    expect(stats.collectionId).toMatch(/^ci-/);
  });

  it('ingests a v0.2 partial collection and surfaces partial status in stats', () => {
    fs.writeFileSync(tmpFile, JSON.stringify(loadFixture('cpp-partial-collection.json')));
    const db = freshDb();
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.collectionStatus).toBe('partial');
    expect(stats.operations.references.status).toBe('partial');
    expect(stats.operations.references.notCollectedFiles).toEqual(['src/baz.cpp', 'src/qux.cpp']);
  });

  it('rejects a v0.2 envelope that fails validation', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ schema_version: '0.2', collectionId: 'x', records: [] }));
    const db = freshDb();
    expect(() => importCodeIntel(tmpFile, db)).toThrow(/validation/i);
  });

  it('still ingests v0.1 JSONL files unchanged', () => {
    const v01 = [
      { kind: 'symbol', qname: 'foo', file_path: 'src/foo.cpp', start_line: 1, end_line: 1 }
    ].map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(tmpFile, v01);
    const db = freshDb();
    const stats = importCodeIntel(tmpFile, db);
    expect(stats.schemaVersion).toBe('0.1');
    expect(stats.recordsImported).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/ingest/code-intel/importer-v02.test.js`
Expected: FAIL — importer does not yet detect v0.2.

- [ ] **Step 4: Modify the importer to detect v0.2 envelope**

In `mcp/stdio/ingest/code-intel/importer.js`, before the existing JSONL-line reader runs, add a dispatcher:

```js
import { detectSchemaVersion, validateAny } from './schema.js';
```

Replace the body of `importCodeIntel(filepath, db, options = {})` (or whatever the existing signature is) with logic shaped like this — keeping the existing v0.1 line loop intact for the v0.1 branch:

```js
export function importCodeIntel(filepath, db, options = {}) {
  const raw = fs.readFileSync(filepath, 'utf8').trim();
  if (raw.length === 0) {
    return { schemaVersion: 'unknown', recordsImported: 0 };
  }

  // v0.2 collection envelope: single JSON object with `schema_version: "0.2"`.
  let parsedHead;
  try {
    parsedHead = JSON.parse(raw);
  } catch {
    parsedHead = null;
  }

  if (parsedHead && detectSchemaVersion(parsedHead) === '0.2') {
    const validation = validateAny(parsedHead);
    if (!validation.valid) {
      throw new Error(`code-intel v0.2 validation failed: ${validation.errors.join('; ')}`);
    }
    return importV02Collection(parsedHead, db, options);
  }

  // Fallback: existing v0.1 JSONL line loop (unchanged).
  return importV01Jsonl(raw, db, options);
}

function importV02Collection(envelope, db, options) {
  const stats = {
    schemaVersion: '0.2',
    collectionId: envelope.collectionId,
    collectionStatus: envelope.status,
    operations: envelope.operations,
    recordsImported: 0
  };

  const insert = makeRecordInserter(db, options);
  for (const record of envelope.records) {
    insert(record, envelope);
    stats.recordsImported += 1;
  }

  return stats;
}
```

`makeRecordInserter` and `importV01Jsonl` should be extracted from the existing file body. If the existing file uses different naming, adapt the wrapper rather than renaming public APIs — backwards compatibility with `d7bf17a` callers is required.

If `makeRecordInserter` does not exist yet, the minimum viable shape for v0.2 is:

```js
function makeRecordInserter(db, options) {
  // Minimal: store the record's identifying fields. M3 graph merge will replace this.
  const stmt = db.prepare(`
    INSERT INTO code_intel_records
      (collection_id, kind, language, symbol_id, qname, file, range_start_line, range_end_line, confidence, provenance, result_state, raw)
    VALUES
      (@collection_id, @kind, @language, @symbol_id, @qname, @file, @range_start_line, @range_end_line, @confidence, @provenance, @result_state, @raw)
  `);
  return (record, envelope) => {
    const range = record.range || {};
    stmt.run({
      collection_id: record.collectionId,
      kind: record.kind,
      language: record.language,
      symbol_id: record.symbolId ?? null,
      qname: record.qname ?? null,
      file: record.file ?? null,
      range_start_line: range.start?.line ?? record.start_line ?? null,
      range_end_line: range.end?.line ?? record.end_line ?? null,
      confidence: record.confidence ?? null,
      provenance: record.provenance ?? null,
      result_state: record.result_state ?? null,
      raw: JSON.stringify(record)
    });
  };
}
```

Add the storage table in Task 8 below — Task 7 leaves the importer expecting the `code_intel_records` table to exist.

- [ ] **Step 5: Add the storage table**

In `mcp/stdio/storage/schema.js`, add (preserve existing migrations):

```js
const codeIntelRecordsTable = `
  CREATE TABLE IF NOT EXISTS code_intel_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    language TEXT NOT NULL,
    symbol_id TEXT,
    qname TEXT,
    file TEXT,
    range_start_line INTEGER,
    range_end_line INTEGER,
    confidence TEXT,
    provenance TEXT,
    result_state TEXT,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS code_intel_records_collection_idx ON code_intel_records(collection_id);
  CREATE INDEX IF NOT EXISTS code_intel_records_symbol_idx ON code_intel_records(symbol_id);
`;
```

Wire it into the existing `applySchema` migration sequence. The exact insertion point depends on the file's structure — append to the migration list and run the SQL with `db.exec(codeIntelRecordsTable)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ingest/code-intel/importer-v02.test.js`
Expected: PASS, 4/4 tests.

- [ ] **Step 7: Run the full ingest test suite to verify no regressions**

Run: `npx vitest run tests/unit/ingest/`
Expected: PASS — including pre-existing `importer.test.js` and `schema.test.js` from `d7bf17a`.

- [ ] **Step 8: Commit**

```bash
git add mcp/stdio/ingest/code-intel/importer.js mcp/stdio/storage/schema.js tests/unit/ingest/code-intel/importer-v02.test.js
git commit -m "feat(code-intel): import v0.2 collection envelopes"
```

---

## Task 8: Build the fixture provider

**Files:**
- Create: `tools/code-intel/fixture/provider.mjs`
- Create: `tests/unit/ingest/code-intel/fixture-provider.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/ingest/code-intel/fixture-provider.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { runFixtureProvider } from '../../../../tools/code-intel/fixture/provider.mjs';
import { validateCollection } from '../../../../mcp/stdio/ingest/code-intel/v02.js';

describe('fixture provider', () => {
  it('emits a valid v0.2 collection for a basic request', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'files',
      files: ['src/foo.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(collection.collectionId).toMatch(/^ci-/);
    expect(collection.records.length).toBeGreaterThan(0);
    expect(collection.status).toBe('ok');
  });

  it('emits a partial collection when requested via options.simulatePartial', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'files',
      files: ['src/foo.cpp', 'src/baz.cpp'],
      operations: ['definitions', 'references'],
      simulate: { partial: { references: ['src/baz.cpp'] } }
    });
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(collection.status).toBe('partial');
    expect(collection.operations.references.status).toBe('partial');
    expect(collection.operations.references.notCollectedFiles).toContain('src/baz.cpp');
  });

  it('emits an error collection when requested via options.simulateError', async () => {
    const collection = await runFixtureProvider({
      language: 'cpp',
      projectRoot: '/repo/root',
      scope: 'all',
      operations: ['definitions'],
      simulate: { error: { code: 'compile_db_missing' } }
    });
    expect(collection.status).toBe('error');
    expect(collection.errors[0].code).toBe('compile_db_missing');
    expect(collection.errors[0].hint).toMatch(/compile_commands/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ingest/code-intel/fixture-provider.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fixture provider**

Create `tools/code-intel/fixture/provider.mjs`:

```js
import crypto from 'node:crypto';

const HINTS = {
  compile_db_missing:
    'compile_commands.json not found at projectRoot; run cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or set --no-code-intel to silence',
  provider_missing: 'install clangd and add it to PATH or set --no-code-intel to silence',
  language_unsupported: 'language not supported by this provider; check provider capabilities',
  wrapper_failed: 'apg code-intel wrapper exited non-zero; run apg code-intel doctor for details',
  language_server_missing: 'language server binary missing; doctor reports the resolution chain',
  language_server_timeout: 'language server did not respond within startup window',
  internal_error: 'see provider logs'
};

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tail = crypto.randomBytes(4).toString('hex');
  return `ci-${ts}-${tail}`;
}

export async function runFixtureProvider(req) {
  const collectionId = newCollectionId();
  const provider = 'fixture';
  const providerVersion = '0.1.0';
  const collectedAt = new Date().toISOString();

  if (req.simulate?.error) {
    const code = req.simulate.error.code || 'internal_error';
    return {
      schema_version: '0.2',
      collectionId,
      provider,
      providerVersion,
      projectRoot: req.projectRoot,
      session: { collectedAt, freshnessBasis: 'unknown' },
      operations: {},
      status: 'error',
      errors: [{ code, message: `simulated ${code}`, hint: HINTS[code] || '' }],
      records: []
    };
  }

  const operations = {};
  const records = [];
  const partialMap = req.simulate?.partial || {};

  for (const op of req.operations || []) {
    const partialFiles = partialMap[op] || [];
    if (partialFiles.length > 0) {
      operations[op] = {
        status: 'partial',
        count: Math.max(0, (req.files?.length || 0) - partialFiles.length),
        notCollectedFiles: partialFiles
      };
    } else {
      operations[op] = { status: 'ok', count: 0 };
    }
  }

  const targetFiles = (req.files || ['src/sample.cpp']).filter(
    f => !(partialMap['definitions'] || []).includes(f)
  );

  for (const file of targetFiles) {
    if (operations.definitions) {
      records.push({
        schema_version: '0.2',
        collectionId,
        kind: 'definition',
        language: req.language,
        symbolId: `c:@F@sample_${file.replace(/[^a-z0-9]/gi, '_')}#`,
        qname: `sample::sample_${file.replace(/[^a-z0-9]/gi, '_')}()`,
        signature: 'void()',
        container: 'sample',
        file,
        range: { start: { line: 1, col: 1 }, end: { line: 1, col: 10 } },
        confidence: 'high',
        provenance: `${provider}@${providerVersion}`,
        result_state: 'found'
      });
      operations.definitions.count = (operations.definitions.count || 0) + 1;
    }
    if (operations.references && !(partialMap['references'] || []).includes(file)) {
      records.push({
        schema_version: '0.2',
        collectionId,
        kind: 'reference',
        language: req.language,
        symbolId: `c:@F@sample_${file.replace(/[^a-z0-9]/gi, '_')}#`,
        qname: `sample::sample_${file.replace(/[^a-z0-9]/gi, '_')}()`,
        container: 'sample',
        file,
        range: { start: { line: 5, col: 1 }, end: { line: 5, col: 10 } },
        context: 'call_expr',
        confidence: 'high',
        provenance: `${provider}@${providerVersion}`,
        result_state: 'found'
      });
      operations.references.count = (operations.references.count || 0) + 1;
    }
  }

  const anyPartial = Object.values(operations).some(o => o.status === 'partial');
  const status = anyPartial ? 'partial' : 'ok';

  return {
    schema_version: '0.2',
    collectionId,
    provider,
    providerVersion,
    projectRoot: req.projectRoot,
    session: { collectedAt, freshnessBasis: 'unknown' },
    operations,
    status,
    records
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ingest/code-intel/fixture-provider.test.js`
Expected: PASS, 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/code-intel/fixture/provider.mjs tests/unit/ingest/code-intel/fixture-provider.test.js
git commit -m "feat(code-intel): add fixture provider emitting valid v0.2 collections"
```

---

## Task 9: Write the human-readable provider contract spec

**Files:**
- Create: `docs/integrations/code-intel-provider-contract.md`

- [ ] **Step 1: Verify the integrations directory**

Run: `ls docs/integrations/ 2>&1 || echo "MISSING"`

If missing, the directory is created when we add the file.

- [ ] **Step 2: Write the contract document**

Create `docs/integrations/code-intel-provider-contract.md`:

```markdown
# Code-intel provider contract (v0.2)

This document is the human-readable companion to the JSON Schemas:

- `docs/schemas/code-intel-record.v0.2.schema.json` — single record.
- `docs/schemas/code-intel-collection.v0.2.schema.json` — provider response envelope.

A code-intel provider is any tool that emits a v0.2 collection envelope from a structured collection request. APG ships `cpp-clangd` (Plan #2) and a `fixture` provider for tests. The contract is provider-neutral; SCIP/LSIF importers and analyzer-based providers must conform to the same boundary.

## Wire shape

A provider response is a single JSON object validated by `code-intel-collection.v0.2.schema.json`. Records inside `records[]` validate against `code-intel-record.v0.2.schema.json`.

Required envelope fields: `schema_version`, `collectionId`, `provider`, `providerVersion`, `projectRoot`, `session`, `operations`, `status`, `records`.

Required record fields: `schema_version`, `collectionId`, `kind`, `language`. `definition`, `reference`, and `call` records additionally require `symbolId` and `qname`. `diagnostic` records additionally require `file`, `severity`, and `message`.

## Identity and traceability

Every record carries `collectionId` so imported facts trace back to the provider run that produced them. `symbolId` is the provider-stable identifier (e.g., a clangd USR). `qname` includes the disambiguating signature where the language requires it (`ns::foo(int)` rather than `ns::foo`). `language` is required so multi-language consumers can dispatch by record.

## Path normalization

Every path in the response, JSONL records, and error fields is **repo-relative and forward-slash normalized** against `projectRoot`. Enforcement is on the provider side — the importer rejects records that violate the rule. APG ships `mcp/stdio/ingest/code-intel/paths.js` as the canonical helper.

## Status taxonomy

**Roll-up `status`:** `ok | partial | error`. `partial` is never permitted to collapse into `ok` or `error`; consumers must read per-operation status.

**Per-operation `operations.<op>.status`:** `ok | partial | not_collected | unsupported`. `partial` carries `count` and `notCollectedFiles[]`. `not_collected` carries `reason`. `unsupported` indicates the provider does not support the operation for the requested language.

**Error codes (closed set):** `provider_missing`, `compile_db_missing`, `language_unsupported`, `wrapper_failed`, `language_server_missing`, `language_server_timeout`, `internal_error`. Every error includes a `hint` string suitable for surfacing in `debug | verify | audit` packets.

## Three-state result distinction

Records carry `result_state` ∈ {`found`, `not_found_after_retry`, `not_collected`}. Consumers must distinguish all three; "no records returned" is not equivalent to any single state. Symbol-aware reference queries that come back empty on a capable target trigger one warm-and-retry pass before being persisted as `not_found_after_retry`. Empty results on a non-capable target persist as `not_collected` with a `reason`.

## Confidence

Records carry `confidence` ∈ {`high`, `medium`, `low`}. Direct call references and definitions are `high`. Virtual-call, template-instantiation, and macro-expansion contexts are at most `medium`. Text-search-derived inferences are `low` and tagged `provenance: INFERRED`, never `CODE_INTEL`. Providers may emit confidence directly or APG derives it deterministically from `(kind, context, provider)`.

## Freshness

`session.freshnessBasis` ∈ {`git_commit`, `file_mtime`, `compile_db_hash`, `unknown`} and `session.freshnessValue` together describe what the provider's freshness is anchored to. Plan #3 (graph merge + freshness) consumes these to render `code_intel=fresh|stale|partial` in briefs and packets.

## Wrapper expectations

A provider invoked through the APG wrapper command (`apg code-intel <subcommand>`, with `aify-code-intel` as PATH shim) must:

- resolve underlying tool paths project-local → bundled → global;
- exit non-zero with `wrapper_failed` rather than silently downgrading when the underlying language server is missing;
- support a `doctor` subcommand reporting tool versions and prerequisite state;
- batch-warm same-language files before diagnostic collection.

These requirements are validated in Plan #2 (C++ clangd provider).

## v1 vs v2 scope

**v1 (this contract):** capabilities, request/response, per-operation status, JSONL output, wrapper expectations, error codes, three-state results, freshness basis.

**v2 (deferred):** cross-provider deduplication (clangd + SCIP for the same fact), incremental collection deltas, multi-language session in one provider call, streaming partial results during long collections.

## Backwards compatibility

The v0.1 schema (`docs/schemas/code-intel-record.schema.json`) and the existing `d7bf17a` import path remain functional. The importer dispatches by detecting the v0.2 envelope shape (`schema_version: "0.2"` + `collectionId` + `records[]`). v0.1 callers are not affected by Plan #1.
```

- [ ] **Step 3: Update `docs/schema-versions.md`**

Read the current file first:

Run: `cat docs/schema-versions.md`

Append a row for v0.2 in the existing table format (preserving whatever structure is already there). Example fragment to add:

```markdown
| code-intel | 0.2 | 2026-05-09 | adds `collectionId`, `projectRoot`, `symbolId`/`qname`/`signature`/`container`, categorical `confidence`, `result_state`, collection envelope with per-operation status, repo-relative path enforcement |
```

Adapt the column count to the existing table structure if it differs.

- [ ] **Step 4: Commit**

```bash
git add docs/integrations/code-intel-provider-contract.md docs/schema-versions.md
git commit -m "docs(code-intel): add v0.2 provider contract spec"
```

---

## Task 10: Full regression sweep

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run tests/unit/`
Expected: PASS — every existing test plus the new ones from Tasks 4-8.

If any previously-passing test now fails, do not paper over it. Investigate the regression and fix the underlying cause before continuing.

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run tests/unit/smoke.test.js`
Expected: PASS.

- [ ] **Step 3: Verify schema files load standalone**

Run: `node -e "import('./mcp/stdio/ingest/code-intel/v02.js').then(m => console.log('loaded:', typeof m.validateCollection))"`
Expected: prints `loaded: function`.

- [ ] **Step 4: Verify the fixture provider is invokable from CLI**

Run: `node -e "import('./tools/code-intel/fixture/provider.mjs').then(m => m.runFixtureProvider({ language: 'cpp', projectRoot: '/r', scope: 'files', files: ['src/foo.cpp'], operations: ['definitions'] })).then(c => console.log(c.status, c.records.length))"`
Expected: prints `ok 1`.

- [ ] **Step 5: Tag the foundation milestone in git**

```bash
git tag plan-1-foundation-complete
```

(Tag is local; not pushed automatically.)

---

## Acceptance summary

After Plan #1 lands:

- v0.2 record and collection schemas are codified, validated by ajv, with fixtures.
- Existing v0.1 import path (from `d7bf17a`) works unchanged.
- v0.2 collections are detected, validated, and ingested into a new `code_intel_records` table.
- Path normalization is enforced at ingest (repo-relative forward-slash).
- Three-state result distinction (`found` / `not_found_after_retry` / `not_collected`) is representable in records.
- Per-operation status (including `partial` with `notCollectedFiles[]`) is preserved into importer stats.
- Fixture provider emits valid v0.2 collections including `partial` and `error` states for downstream test use.
- Provider contract is documented at `docs/integrations/code-intel-provider-contract.md`.

This is the unblock for Plan #2 (C++ clangd provider) and Plan #4 (packet v2 + verify mode), both of which depend on the v0.2 envelope and the three-state model.
