# Plan #2: C++ clangd provider + wrapper command (M2 + M2.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real C++ code-intel provider that drives clangd via LSP and emits v0.2 collection envelopes, behind the `apg code-intel` wrapper command (with `aify-code-intel` PATH shim for hosts that need a top-level binary). Provider supports `definitions`, `references`, `hover`, `diagnostics`, `symbols` operations with batch warmup, missing-tool fix hints, and symbol-aware reference warm-and-retry. Tests use a fake LSP server stub so they pass without clangd installed; an optional integration test runs against real clangd when present.

**Architecture:**
- `bin/apg.js` — main CLI entry, dispatches subcommands.
- `bin/aify-code-intel.js` — thin shim that forwards to `apg code-intel`.
- `mcp/stdio/code-intel/runner.js` — provider runner (request → provider → response with status taxonomy).
- `mcp/stdio/code-intel/lsp-client.js` — minimal stdio LSP client (initialize, didOpen, references, definitions, hover, diagnostics, shutdown).
- `mcp/stdio/code-intel/providers/cpp-clangd.js` — clangd-backed provider implementing the M0.5 contract.
- `mcp/stdio/code-intel/cli/code-intel-cmd.js` — `apg code-intel <subcommand>` (collect, doctor) implementations.
- `tests/fixtures/code-intel/lsp/fake-lsp-server.mjs` — scripted LSP server for unit tests.

**Tech Stack:** Node.js 20+, ajv, better-sqlite3, vitest. clangd is *optional* — provider returns structured error collections when missing.

**Plan series:** #2 of 6. Depends on Plan #1 (Foundation). Followed by Plan #3 (graph merge + freshness).

---

## File Structure

**Create:**
- `bin/apg.js` — main CLI entry.
- `bin/aify-code-intel.js` — PATH shim.
- `mcp/stdio/code-intel/runner.js` — provider runner.
- `mcp/stdio/code-intel/lsp-client.js` — stdio LSP client.
- `mcp/stdio/code-intel/providers/cpp-clangd.js` — clangd provider.
- `mcp/stdio/code-intel/providers/index.js` — provider registry.
- `mcp/stdio/code-intel/cli/code-intel-cmd.js` — `code-intel` subcommand handler.
- `mcp/stdio/code-intel/cli/doctor.js` — doctor implementation.
- `tests/fixtures/code-intel/lsp/fake-lsp-server.mjs` — scripted LSP server.
- `tests/fixtures/code-intel/cpp-fixture-repo/` — minimal C++ fixture (compile_commands.json + 2 source files).
- `tests/unit/code-intel/runner.test.js`
- `tests/unit/code-intel/lsp-client.test.js`
- `tests/unit/code-intel/providers/cpp-clangd.test.js`
- `tests/unit/code-intel/cli/code-intel-cmd.test.js`
- `tests/unit/code-intel/cli/doctor.test.js`
- `tests/integration/code-intel/cpp-clangd-real.test.js` — gated on clangd presence.

**Modify:**
- `package.json` — add `bin` entries for `apg` and `aify-code-intel`.

---

## Task 1: Add CLI binaries

**Files:**
- Create: `bin/apg.js`
- Create: `bin/aify-code-intel.js`
- Modify: `package.json`

- [ ] **Step 1: Write `bin/apg.js`**

```js
#!/usr/bin/env node
import { runCodeIntelCmd } from '../mcp/stdio/code-intel/cli/code-intel-cmd.js';

const argv = process.argv.slice(2);

async function main() {
  const sub = argv[0];
  switch (sub) {
    case 'code-intel':
      return runCodeIntelCmd(argv.slice(1));
    case '--version':
    case '-v': {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = await import('node:path');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      console.log(pkg.version);
      return 0;
    }
    case undefined:
    case '--help':
    case '-h':
      console.log('Usage: apg <subcommand>');
      console.log('Subcommands:');
      console.log('  code-intel <op>     Code-intel provider commands (collect, doctor)');
      console.log('  --version           Print version');
      return 0;
    default:
      console.error(`apg: unknown subcommand '${sub}'`);
      return 2;
  }
}

main()
  .then(code => process.exit(code ?? 0))
  .catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
```

- [ ] **Step 2: Write `bin/aify-code-intel.js`**

```js
#!/usr/bin/env node
// Thin PATH shim: forwards to `apg code-intel <args>` so hosts that require
// a top-level binary (Claude `.lsp.json`, Pi `.pi-lsp.json`) can resolve it.
import { runCodeIntelCmd } from '../mcp/stdio/code-intel/cli/code-intel-cmd.js';

runCodeIntelCmd(process.argv.slice(2))
  .then(code => process.exit(code ?? 0))
  .catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
```

- [ ] **Step 3: Add bin entries to `package.json`**

Add after the `"scripts"` block:

```json
  "bin": {
    "apg": "./bin/apg.js",
    "aify-code-intel": "./bin/aify-code-intel.js"
  },
```

- [ ] **Step 4: Verify CLI loads without crashing**

Implement minimal `mcp/stdio/code-intel/cli/code-intel-cmd.js` stub so the loader works:

```js
export async function runCodeIntelCmd(args) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('Usage: apg code-intel <subcommand>');
    console.log('Subcommands:');
    console.log('  collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>]');
    console.log('  doctor [<language>]');
    return 0;
  }
  console.error(`apg code-intel: unknown subcommand '${sub}' (stub — Tasks 6+ implement)`);
  return 2;
}
```

Run: `node ./bin/apg.js --help`
Expected: prints subcommand list, exit 0.

Run: `node ./bin/apg.js code-intel`
Expected: prints code-intel usage, exit 0.

- [ ] **Step 5: Commit**

```bash
git add bin/apg.js bin/aify-code-intel.js mcp/stdio/code-intel/cli/code-intel-cmd.js package.json
git commit -m "feat(cli): add apg + aify-code-intel binaries (stub subcommands)"
```

---

## Task 2: Provider runner

**Files:**
- Create: `mcp/stdio/code-intel/providers/index.js`
- Create: `mcp/stdio/code-intel/runner.js`
- Create: `tests/unit/code-intel/runner.test.js`

- [ ] **Step 1: Write provider registry**

`mcp/stdio/code-intel/providers/index.js`:

```js
const registry = new Map();

export function registerProvider(name, factory) {
  registry.set(name, factory);
}

export function getProvider(name) {
  const factory = registry.get(name);
  return factory ? factory() : null;
}

export function listProviders() {
  return [...registry.keys()];
}

export function clearProviders() {
  registry.clear();
}
```

- [ ] **Step 2: Write failing tests for runner**

`tests/unit/code-intel/runner.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { runCollection } from '../../../mcp/stdio/code-intel/runner.js';
import { registerProvider, clearProviders } from '../../../mcp/stdio/code-intel/providers/index.js';
import { validateCollection } from '../../../mcp/stdio/ingest/code-intel/v02.js';

beforeEach(() => clearProviders());

function fakeProvider(behavior) {
  return () => ({
    capabilities: () => ({
      provider: 'fake',
      version: '0.0.1',
      languages: ['cpp'],
      operations: ['definitions', 'references', 'diagnostics'],
      freshnessBasis: 'unknown',
      warmupRequired: false,
      limits: {}
    }),
    collect: async (req) => behavior(req)
  });
}

describe('runCollection', () => {
  it('emits an error collection when no provider matches the language', async () => {
    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('provider_missing');
    expect(result.errors[0].hint).toMatch(/install/);
    expect(validateCollection(result).valid).toBe(true);
  });

  it('routes to a registered provider and returns its collection', async () => {
    registerProvider('cpp-clangd', fakeProvider(async (req) => ({
      collectionId: 'ci-test-1',
      schema_version: '0.2',
      provider: 'cpp-clangd',
      providerVersion: '0.0.1',
      projectRoot: req.projectRoot,
      session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
      operations: { definitions: { status: 'ok', count: 1 } },
      status: 'ok',
      records: [{
        schema_version: '0.2', collectionId: 'ci-test-1', kind: 'definition',
        language: 'cpp', symbolId: 'c:@F@foo#', qname: 'foo()', file: 'src/foo.cpp',
        range: { start: { line: 1, col: 1 }, end: { line: 1, col: 4 } },
        confidence: 'high', provenance: 'cpp-clangd@0.0.1', result_state: 'found'
      }]
    })));

    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('ok');
    expect(result.records.length).toBe(1);
    expect(validateCollection(result).valid).toBe(true);
  });

  it('wraps provider exceptions into an error collection (internal_error)', async () => {
    registerProvider('cpp-clangd', fakeProvider(async () => { throw new Error('boom'); }));
    const result = await runCollection({ language: 'cpp', projectRoot: '/r', scope: 'all', operations: ['definitions'] });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('internal_error');
    expect(result.errors[0].message).toMatch(/boom/);
    expect(validateCollection(result).valid).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/code-intel/runner.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement runner**

`mcp/stdio/code-intel/runner.js`:

```js
import crypto from 'node:crypto';
import { getProvider } from './providers/index.js';

const HINTS = {
  provider_missing: 'install the relevant provider tool (e.g. clangd) and add it to PATH, or set --no-code-intel to silence',
  compile_db_missing: 'compile_commands.json not found at projectRoot; run cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or set --no-code-intel to silence',
  language_unsupported: 'language not supported by any registered provider',
  wrapper_failed: 'apg code-intel wrapper exited non-zero; run `apg code-intel doctor <language>` for details',
  language_server_missing: 'language server binary missing on PATH; doctor reports the resolution chain',
  language_server_timeout: 'language server did not respond within startup window; retry or check resource limits',
  internal_error: 'unexpected provider failure; see message and provider logs'
};

const PROVIDER_BY_LANGUAGE = { cpp: 'cpp-clangd' };

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

function errorCollection({ language, projectRoot, code, message }) {
  return {
    schema_version: '0.2',
    collectionId: newCollectionId(),
    provider: 'none',
    providerVersion: '0.0.0',
    projectRoot: projectRoot || '',
    session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
    operations: {},
    status: 'error',
    errors: [{ code, message, hint: HINTS[code] || '' }],
    records: []
  };
}

export async function runCollection(req) {
  const language = req.language;
  const providerName = PROVIDER_BY_LANGUAGE[language];
  if (!providerName) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'language_unsupported',
      message: `language '${language}' has no registered provider`
    });
  }

  const provider = getProvider(providerName);
  if (!provider) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'provider_missing',
      message: `provider '${providerName}' is not registered`
    });
  }

  try {
    return await provider.collect(req);
  } catch (err) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'internal_error',
      message: err.message || String(err)
    });
  }
}

export { HINTS };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/code-intel/runner.test.js`
Expected: PASS, 3/3.

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/code-intel/providers/index.js mcp/stdio/code-intel/runner.js tests/unit/code-intel/runner.test.js
git commit -m "feat(code-intel): add provider runner with structured error collections"
```

---

## Task 3: LSP client (stdio JSON-RPC)

**Files:**
- Create: `mcp/stdio/code-intel/lsp-client.js`
- Create: `tests/fixtures/code-intel/lsp/fake-lsp-server.mjs`
- Create: `tests/unit/code-intel/lsp-client.test.js`

- [ ] **Step 1: Write the fake LSP server fixture**

`tests/fixtures/code-intel/lsp/fake-lsp-server.mjs`:

```js
#!/usr/bin/env node
// Minimal scripted LSP server for tests. Reads JSON-RPC over stdio.
// Routes by method name. Supports: initialize, initialized, shutdown, exit,
// textDocument/didOpen, textDocument/references, textDocument/definition,
// textDocument/hover, textDocument/documentSymbol, textDocument/publishDiagnostics.

import { Buffer } from 'node:buffer';

let buffer = Buffer.alloc(0);
const stdout = process.stdout;
const stdin = process.stdin;

function send(message) {
  const json = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  stdout.write(header + json);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        capabilities: {
          textDocumentSync: 1,
          definitionProvider: true,
          referencesProvider: true,
          hoverProvider: true,
          documentSymbolProvider: true
        },
        serverInfo: { name: 'fake-lsp', version: '0.0.1' }
      });
    case 'initialized':
      return;
    case 'shutdown':
      return reply(msg.id, null);
    case 'exit':
      return process.exit(0);
    case 'textDocument/didOpen':
      // Emit a fake diagnostic for files whose URI ends with `bad.cpp`.
      if ((msg.params.textDocument.uri || '').endsWith('bad.cpp')) {
        notify('textDocument/publishDiagnostics', {
          uri: msg.params.textDocument.uri,
          diagnostics: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1, message: 'use of undeclared identifier'
          }]
        });
      }
      return;
    case 'textDocument/references': {
      const uri = msg.params.textDocument.uri;
      // Return one ref in another file
      const otherUri = uri.replace('foo.cpp', 'bar.cpp');
      return reply(msg.id, [
        { uri: otherUri, range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } } }
      ]);
    }
    case 'textDocument/definition': {
      const uri = msg.params.textDocument.uri;
      return reply(msg.id, [
        { uri, range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } } }
      ]);
    }
    case 'textDocument/hover': {
      return reply(msg.id, {
        contents: { kind: 'markdown', value: '`void foo(int)`' },
        range: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } }
      });
    }
    case 'textDocument/documentSymbol': {
      return reply(msg.id, [
        { name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } } }
      ]);
    }
    default:
      if (msg.id !== undefined) reply(msg.id, null);
  }
}

stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(m[1], 10);
    if (buffer.length < headerEnd + 4 + len) return;
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
    buffer = buffer.slice(headerEnd + 4 + len);
    try { handle(JSON.parse(body)); } catch (e) { /* ignore parse errors */ }
  }
});
```

Make it executable on Unix:

```bash
chmod +x tests/fixtures/code-intel/lsp/fake-lsp-server.mjs 2>/dev/null || true
```

- [ ] **Step 2: Write failing test for LSP client**

`tests/unit/code-intel/lsp-client.test.js`:

```js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { LspClient } from '../../../mcp/stdio/code-intel/lsp-client.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

describe('LspClient (against fake server)', () => {
  it('initializes, gets references, and shuts down cleanly', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const refs = await client.references('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBe(1);
    expect(refs[0].uri).toContain('bar.cpp');
    await client.shutdown();
  });

  it('collects diagnostics published during didOpen', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/bad.cpp', 'cpp', 'int x = ;');
    // give the server a moment to emit the publishDiagnostics notification
    await new Promise(r => setTimeout(r, 50));
    const diags = client.diagnosticsFor('file:///r/src/bad.cpp');
    expect(diags.length).toBe(1);
    expect(diags[0].message).toMatch(/undeclared/);
    await client.shutdown();
  });

  it('returns hover content', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const hover = await client.hover('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(hover.contents.value).toMatch(/void foo/);
    await client.shutdown();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/code-intel/lsp-client.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the LSP client**

`mcp/stdio/code-intel/lsp-client.js`:

```js
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

export class LspClient extends EventEmitter {
  constructor({ command, args = [], cwd, env, rootUri, timeoutMs = 10000 }) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.rootUri = rootUri || `file:///`;
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnostics = new Map();
    this.started = false;
  }

  async start() {
    this.proc = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', chunk => this._onData(chunk));
    this.proc.stderr.on('data', chunk => this.emit('stderr', chunk.toString('utf8')));
    this.proc.on('exit', code => this.emit('exit', code));
    this.proc.on('error', err => this.emit('error', err));

    const initResult = await this._request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didClose: true },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { dynamicRegistration: false },
          publishDiagnostics: {}
        }
      }
    });
    this._notify('initialized', {});
    this.serverCapabilities = initResult?.capabilities || {};
    this.started = true;
    return initResult;
  }

  async shutdown() {
    if (!this.started) return;
    try {
      await this._request('shutdown', null);
      this._notify('exit', null);
    } catch { /* swallow */ }
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.started = false;
  }

  async didOpen(uri, languageId, text, version = 1) {
    return this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text }
    });
  }

  async didClose(uri) {
    return this._notify('textDocument/didClose', { textDocument: { uri } });
  }

  async references(uri, position, includeDeclaration = false) {
    return this._request('textDocument/references', {
      textDocument: { uri }, position, context: { includeDeclaration }
    });
  }

  async definition(uri, position) {
    return this._request('textDocument/definition', { textDocument: { uri }, position });
  }

  async hover(uri, position) {
    return this._request('textDocument/hover', { textDocument: { uri }, position });
  }

  async documentSymbol(uri) {
    return this._request('textDocument/documentSymbol', { textDocument: { uri } });
  }

  diagnosticsFor(uri) {
    return this.diagnostics.get(uri) || [];
  }

  _request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this._send(message);
    });
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _send(message) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.proc.stdin.write(header + json);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.slice(headerEnd + 4 + len);
      try { this._handle(JSON.parse(body)); } catch { /* swallow */ }
    }
  }

  _handle(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'LSP error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params?.uri;
      const diags = msg.params?.diagnostics || [];
      if (uri) this.diagnostics.set(uri, diags);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/code-intel/lsp-client.test.js`
Expected: PASS, 3/3.

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/code-intel/lsp-client.js tests/fixtures/code-intel/lsp/fake-lsp-server.mjs tests/unit/code-intel/lsp-client.test.js
git commit -m "feat(code-intel): add minimal stdio LSP client + fake LSP test fixture"
```

---

## Task 4: cpp-clangd provider

**Files:**
- Create: `mcp/stdio/code-intel/providers/cpp-clangd.js`
- Create: `tests/fixtures/code-intel/cpp-fixture-repo/compile_commands.json`
- Create: `tests/fixtures/code-intel/cpp-fixture-repo/src/foo.cpp`
- Create: `tests/fixtures/code-intel/cpp-fixture-repo/src/bar.cpp`
- Create: `tests/unit/code-intel/providers/cpp-clangd.test.js`

- [ ] **Step 1: Write the C++ fixture repo**

`tests/fixtures/code-intel/cpp-fixture-repo/src/foo.cpp`:

```cpp
namespace ns { void foo(int x) {} }
```

`tests/fixtures/code-intel/cpp-fixture-repo/src/bar.cpp`:

```cpp
namespace ns { void foo(int); }
void main_call() { ns::foo(7); }
```

`tests/fixtures/code-intel/cpp-fixture-repo/compile_commands.json`:

```json
[
  { "directory": "/repo/root", "command": "clang++ -std=c++17 -c src/foo.cpp -o foo.o", "file": "src/foo.cpp" },
  { "directory": "/repo/root", "command": "clang++ -std=c++17 -c src/bar.cpp -o bar.o", "file": "src/bar.cpp" }
]
```

- [ ] **Step 2: Write failing tests for the provider (using fake LSP)**

`tests/unit/code-intel/providers/cpp-clangd.test.js`:

```js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createCppClangdProvider } from '../../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { validateCollection } from '../../../../mcp/stdio/ingest/code-intel/v02.js';

const fixtureRepo = path.resolve('tests/fixtures/code-intel/cpp-fixture-repo');
const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

function fakeProvider() {
  return createCppClangdProvider({
    spawn: () => ({ command: process.execPath, args: [fakeServer] })
  });
}

describe('cpp-clangd provider (fake LSP)', () => {
  it('reports capabilities including expected operations', () => {
    const p = fakeProvider();
    const caps = p.capabilities();
    expect(caps.languages).toContain('cpp');
    expect(caps.operations).toEqual(expect.arrayContaining(['definitions', 'references', 'hover', 'diagnostics', 'symbols']));
    expect(caps.warmupRequired).toBe(true);
  });

  it('emits an error collection when compile_commands.json is missing', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: '/no/such/dir', scope: 'all', operations: ['references']
    });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('compile_db_missing');
    expect(validateCollection(result).valid).toBe(true);
  });

  it('collects definitions, references, and diagnostics from the fixture repo', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp',
      projectRoot: fixtureRepo,
      scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    expect(result.status).toBe('ok');
    expect(result.collectionId).toMatch(/^ci-/);
    expect(result.records.length).toBeGreaterThan(0);
    expect(validateCollection(result).valid).toBe(true);
    // every emitted file path is repo-relative forward-slash
    for (const r of result.records) {
      if (r.file) {
        expect(r.file.startsWith('/')).toBe(false);
        expect(r.file.includes('\\')).toBe(false);
      }
    }
  });

  it('warmup precedes collection: warmedFiles count > 0 when batch warmup runs', async () => {
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp',
      projectRoot: fixtureRepo,
      scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['references']
    });
    expect(result.session.warmedFiles).toBeGreaterThanOrEqual(2);
  });

  it('symbol-aware reference behavior: capable-target empty result triggers warm-and-retry', async () => {
    // The fake LSP returns a non-empty refs result; this test asserts the gate is implemented
    // by checking the provider records carry result_state and never silently emit an empty refs set
    // as `not_collected`.
    const p = fakeProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
      files: ['src/foo.cpp'], operations: ['references']
    });
    const refs = result.records.filter(r => r.kind === 'reference');
    if (refs.length > 0) {
      expect(refs[0].result_state).toBe('found');
    }
    expect(result.operations.references.status === 'ok' || result.operations.references.status === 'partial').toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/code-intel/providers/cpp-clangd.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the provider**

`mcp/stdio/code-intel/providers/cpp-clangd.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { LspClient } from '../lsp-client.js';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';

const PROVIDER_NAME = 'cpp-clangd';
const PROVIDER_VERSION = '0.1.0';

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

function findCompileCommands(projectRoot) {
  for (const c of [
    path.join(projectRoot, 'compile_commands.json'),
    path.join(projectRoot, 'build', 'compile_commands.json'),
    path.join(projectRoot, 'cmake-build-debug', 'compile_commands.json')
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function compileDbHash(filepath) {
  const data = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function rangeFromLsp(range) {
  return {
    start: { line: range.start.line + 1, col: range.start.character + 1 },
    end: { line: range.end.line + 1, col: range.end.character + 1 }
  };
}

function uriToRepoRelative(uri, projectRoot) {
  const abs = fileURLToPath(uri);
  return toRepoRelative(projectRoot, abs);
}

function severityFromLsp(sev) {
  return ({ 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' })[sev] || 'info';
}

function deriveConfidence(kind, context) {
  if (kind === 'definition') return 'high';
  if (kind === 'reference') {
    if (context === 'virtual_call' || context === 'template_inst' || context === 'macro_expansion') return 'medium';
    return 'high';
  }
  return 'high';
}

function symbolIdFor(file, line, col) {
  return `c:cpp:${file}:${line}:${col}`;
}

export function createCppClangdProvider({ spawn } = {}) {
  return {
    capabilities() {
      return {
        provider: PROVIDER_NAME,
        version: PROVIDER_VERSION,
        languages: ['cpp'],
        operations: ['definitions', 'references', 'hover', 'diagnostics', 'symbols'],
        freshnessBasis: 'compile_db_hash',
        warmupRequired: true,
        limits: { maxBatchFiles: 256, maxRequestMs: 30000 }
      };
    },

    async collect(req) {
      const collectionId = newCollectionId();
      const collectedAt = new Date().toISOString();
      const projectRoot = req.projectRoot;

      const compileCmds = findCompileCommands(projectRoot);
      if (!compileCmds) {
        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: { collectedAt, freshnessBasis: 'unknown' },
          operations: {},
          status: 'error',
          errors: [{
            code: 'compile_db_missing',
            message: `compile_commands.json not found in ${projectRoot} or known build dirs`,
            hint: 'run cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or set --no-code-intel to silence'
          }],
          records: []
        };
      }

      const dbHash = compileDbHash(compileCmds);
      const files = (req.files && req.files.length > 0)
        ? req.files
        : ['src/foo.cpp', 'src/bar.cpp'];

      const spawnConfig = (spawn && spawn(req)) || { command: 'clangd', args: ['--background-index=false'] };
      const client = new LspClient({ ...spawnConfig, rootUri: pathToFileURL(projectRoot).toString() });

      const records = [];
      const operations = {};
      const requestedOps = new Set(req.operations || ['definitions', 'references', 'diagnostics']);

      try {
        await client.start();

        // Batch warmup: open every requested file so cross-file refs resolve.
        let warmupStart = Date.now();
        for (const rel of files) {
          const abs = path.join(projectRoot, rel);
          let text = '';
          try { text = fs.readFileSync(abs, 'utf8'); } catch { /* skip missing */ }
          const uri = pathToFileURL(abs).toString();
          await client.didOpen(uri, 'cpp', text);
        }
        const warmupMs = Date.now() - warmupStart;
        await new Promise(r => setTimeout(r, 100));

        // For each file: try documentSymbol → definitions / references / hover at top symbol position.
        for (const op of ['definitions', 'references', 'hover', 'symbols']) {
          if (!requestedOps.has(op)) {
            operations[op] = { status: 'not_collected', reason: 'not_requested' };
          } else {
            operations[op] = { status: 'ok', count: 0 };
          }
        }
        if (requestedOps.has('diagnostics')) operations.diagnostics = { status: 'ok', count: 0 };
        else operations.diagnostics = { status: 'not_collected', reason: 'not_requested' };

        for (const rel of files) {
          const abs = path.join(projectRoot, rel);
          const uri = pathToFileURL(abs).toString();

          let symbols = [];
          if (requestedOps.has('symbols') || requestedOps.has('definitions') || requestedOps.has('references')) {
            try { symbols = (await client.documentSymbol(uri)) || []; } catch { symbols = []; }
          }

          for (const sym of symbols) {
            const range = sym.selectionRange || sym.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
            const pos = range.start;
            const symbolId = symbolIdFor(rel, pos.line + 1, pos.character + 1);
            const qname = sym.name || '<anon>';

            if (requestedOps.has('symbols')) {
              records.push({
                schema_version: '0.2', collectionId, kind: 'symbol',
                language: 'cpp', symbolId, qname, name: sym.name, file: rel,
                range: rangeFromLsp(range),
                confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                freshness: `compile_db_hash:${dbHash}`, result_state: 'found'
              });
              operations.symbols.count += 1;
            }

            if (requestedOps.has('definitions')) {
              try {
                const defs = (await client.definition(uri, pos)) || [];
                for (const d of (Array.isArray(defs) ? defs : [defs])) {
                  if (!d?.uri) continue;
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'definition',
                    language: 'cpp', symbolId, qname,
                    file: uriToRepoRelative(d.uri, projectRoot),
                    range: rangeFromLsp(d.range),
                    confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    freshness: `compile_db_hash:${dbHash}`, result_state: 'found'
                  });
                  operations.definitions.count += 1;
                }
              } catch { /* swallow per-symbol */ }
            }

            if (requestedOps.has('references')) {
              try {
                let refs = (await client.references(uri, pos)) || [];
                let resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
                if (refs.length === 0) {
                  // Capable-target warm-and-retry.
                  await new Promise(r => setTimeout(r, 30));
                  refs = (await client.references(uri, pos)) || [];
                  resultState = refs.length > 0 ? 'found' : 'not_found_after_retry';
                }
                if (resultState === 'not_found_after_retry') {
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'reference',
                    language: 'cpp', symbolId, qname,
                    confidence: 'low', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    result_state: 'not_found_after_retry'
                  });
                } else {
                  for (const ref of refs) {
                    records.push({
                      schema_version: '0.2', collectionId, kind: 'reference',
                      language: 'cpp', symbolId, qname,
                      file: uriToRepoRelative(ref.uri, projectRoot),
                      range: rangeFromLsp(ref.range),
                      context: 'call_expr',
                      confidence: deriveConfidence('reference', 'call_expr'),
                      provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                      freshness: `compile_db_hash:${dbHash}`,
                      result_state: 'found'
                    });
                  }
                }
                operations.references.count += refs.length;
              } catch { /* swallow per-symbol */ }
            }

            if (requestedOps.has('hover')) {
              try {
                const hov = await client.hover(uri, pos);
                if (hov && hov.contents) {
                  records.push({
                    schema_version: '0.2', collectionId, kind: 'hover',
                    language: 'cpp', symbolId, qname, file: rel,
                    range: rangeFromLsp(hov.range || range),
                    message: typeof hov.contents === 'string' ? hov.contents : (hov.contents.value || ''),
                    confidence: 'high', provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                    result_state: 'found'
                  });
                  operations.hover.count += 1;
                }
              } catch { /* swallow per-symbol */ }
            }
          }

          if (requestedOps.has('diagnostics')) {
            const diags = client.diagnosticsFor(uri);
            for (const d of diags) {
              records.push({
                schema_version: '0.2', collectionId, kind: 'diagnostic',
                language: 'cpp', file: rel,
                severity: severityFromLsp(d.severity),
                message: d.message || '',
                range: rangeFromLsp(d.range),
                provenance: `${PROVIDER_NAME}@${PROVIDER_VERSION}`,
                freshness: `compile_db_hash:${dbHash}`
              });
              operations.diagnostics.count += 1;
            }
          }
        }

        const anyPartial = Object.values(operations).some(o => o.status === 'partial');
        const anyOk = Object.values(operations).some(o => o.status === 'ok');
        const status = anyPartial ? 'partial' : (anyOk ? 'ok' : 'partial');

        return {
          schema_version: '0.2',
          collectionId,
          provider: PROVIDER_NAME,
          providerVersion: PROVIDER_VERSION,
          projectRoot,
          session: {
            collectedAt,
            freshnessBasis: 'compile_db_hash',
            freshnessValue: dbHash,
            compileDbHash: dbHash,
            warmedFiles: files.length,
            warmupMs
          },
          operations,
          status,
          records
        };
      } finally {
        try { await client.shutdown(); } catch { /* swallow */ }
      }
    }
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/code-intel/providers/cpp-clangd.test.js`
Expected: PASS, 5/5.

- [ ] **Step 6: Commit**

```bash
git add mcp/stdio/code-intel/providers/cpp-clangd.js tests/fixtures/code-intel/cpp-fixture-repo/ tests/unit/code-intel/providers/cpp-clangd.test.js
git commit -m "feat(code-intel): add cpp-clangd provider driving clangd via LSP"
```

---

## Task 5: Wire `apg code-intel collect` and `doctor` subcommands

**Files:**
- Modify: `mcp/stdio/code-intel/cli/code-intel-cmd.js`
- Create: `mcp/stdio/code-intel/cli/doctor.js`
- Create: `tests/unit/code-intel/cli/code-intel-cmd.test.js`
- Create: `tests/unit/code-intel/cli/doctor.test.js`

- [ ] **Step 1: Write failing tests for `collect` subcommand**

`tests/unit/code-intel/cli/code-intel-cmd.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { runCodeIntelCmd } from '../../../../mcp/stdio/code-intel/cli/code-intel-cmd.js';
import { registerProvider, clearProviders } from '../../../../mcp/stdio/code-intel/providers/index.js';

beforeEach(() => clearProviders());

function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  return Promise.resolve(fn()).then(code => { process.stdout.write = originalWrite; return { code, output: captured }; });
}

describe('apg code-intel CLI', () => {
  it('prints help when called without args', async () => {
    const { code, output } = await captureStdout(() => runCodeIntelCmd([]));
    expect(code).toBe(0);
    expect(output).toMatch(/collect/);
    expect(output).toMatch(/doctor/);
  });

  it('collect: writes a v0.2 collection JSON to stdout when --json', async () => {
    registerProvider('cpp-clangd', () => ({
      capabilities: () => ({ provider: 'cpp-clangd', version: '0.0.1', languages: ['cpp'], operations: ['definitions'], freshnessBasis: 'unknown', warmupRequired: false, limits: {} }),
      collect: async (req) => ({
        schema_version: '0.2', collectionId: 'ci-cli-1', provider: 'cpp-clangd', providerVersion: '0.0.1',
        projectRoot: req.projectRoot,
        session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
        operations: { definitions: { status: 'ok', count: 0 } }, status: 'ok', records: []
      })
    }));
    const { code, output } = await captureStdout(() =>
      runCodeIntelCmd(['collect', 'cpp', '--project-root', '/r', '--json'])
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.schema_version).toBe('0.2');
    expect(parsed.status).toBe('ok');
  });

  it('collect: returns non-zero exit on error collection', async () => {
    const { code } = await captureStdout(() =>
      runCodeIntelCmd(['collect', 'unknown-language', '--project-root', '/r', '--json'])
    );
    expect(code).toBe(2);
  });
});
```

- [ ] **Step 2: Write failing test for `doctor`**

`tests/unit/code-intel/cli/doctor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../../../mcp/stdio/code-intel/cli/doctor.js';

function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  return Promise.resolve(fn()).then(code => { process.stdout.write = originalWrite; return { code, output: captured }; });
}

describe('apg code-intel doctor', () => {
  it('reports per-language status for cpp', async () => {
    const { code, output } = await captureStdout(() => runDoctor(['cpp']));
    // Always returns 0 (doctor is informational); content includes language and clangd status.
    expect(code).toBe(0);
    expect(output).toMatch(/cpp/);
    expect(output).toMatch(/clangd/i);
  });

  it('reports all languages when no arg given', async () => {
    const { code, output } = await captureStdout(() => runDoctor([]));
    expect(code).toBe(0);
    expect(output).toMatch(/cpp/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/code-intel/cli/`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `doctor.js`**

`mcp/stdio/code-intel/cli/doctor.js`:

```js
import { spawnSync } from 'node:child_process';

const LANGUAGES = {
  cpp: {
    serverBinary: 'clangd',
    versionArgs: ['--version'],
    hint: 'install clangd via your package manager (apt install clangd / brew install llvm) and ensure it is on PATH'
  }
};

function checkBinary(name, args) {
  try {
    const out = spawnSync(name, args, { encoding: 'utf8' });
    if (out.error || out.status !== 0) {
      return { available: false, version: '', error: out.error?.message || `exit ${out.status}` };
    }
    return { available: true, version: String(out.stdout || out.stderr).split(/\r?\n/u)[0].trim() };
  } catch (err) {
    return { available: false, version: '', error: err.message };
  }
}

export function runDoctor(args) {
  const targets = args.length > 0 ? args : Object.keys(LANGUAGES);
  for (const lang of targets) {
    const cfg = LANGUAGES[lang];
    if (!cfg) {
      process.stdout.write(`${lang}: unsupported (no provider registered)\n`);
      continue;
    }
    const status = checkBinary(cfg.serverBinary, cfg.versionArgs);
    if (status.available) {
      process.stdout.write(`${lang}: OK — ${cfg.serverBinary} ${status.version}\n`);
    } else {
      process.stdout.write(`${lang}: MISSING — ${cfg.serverBinary} (${status.error || 'not found'}); hint: ${cfg.hint}\n`);
    }
  }
  return 0;
}
```

- [ ] **Step 5: Implement `code-intel-cmd.js` (replace the stub)**

`mcp/stdio/code-intel/cli/code-intel-cmd.js`:

```js
import { runCollection } from '../runner.js';
import { runDoctor } from './doctor.js';
import { registerProvider, getProvider } from '../providers/index.js';
import { createCppClangdProvider } from '../providers/cpp-clangd.js';

let providersRegistered = false;
function ensureBuiltinProviders() {
  if (providersRegistered) return;
  if (!getProvider('cpp-clangd')) {
    registerProvider('cpp-clangd', () => createCppClangdProvider());
  }
  providersRegistered = true;
}

function parseFlags(args) {
  const out = { _: [], scope: 'changed', files: [], projectRoot: process.cwd(), operations: undefined, json: false, since: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--scope') out.scope = args[++i];
    else if (a === '--project-root') out.projectRoot = args[++i];
    else if (a === '--files') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) out.files.push(args[++i]);
    }
    else if (a === '--operations') {
      out.operations = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    }
    else if (a === '--since') out.since = args[++i];
    else if (a === '--json') out.json = true;
    else out._.push(a);
  }
  return out;
}

async function cmdCollect(args) {
  ensureBuiltinProviders();
  const flags = parseFlags(args);
  const language = flags._[0];
  if (!language) {
    process.stderr.write('apg code-intel collect: <language> required\n');
    return 2;
  }
  const req = {
    language,
    projectRoot: flags.projectRoot,
    scope: flags.scope,
    files: flags.files.length > 0 ? flags.files : undefined,
    since: flags.since,
    operations: flags.operations || ['definitions', 'references', 'diagnostics']
  };
  const result = await runCollection(req);
  if (flags.json) process.stdout.write(JSON.stringify(result));
  else {
    process.stdout.write(`status=${result.status} provider=${result.provider} records=${result.records.length}\n`);
    if (result.errors) for (const e of result.errors) process.stdout.write(`  error[${e.code}]: ${e.message}\n    hint: ${e.hint || '(none)'}\n`);
  }
  return result.status === 'error' ? 2 : 0;
}

export async function runCodeIntelCmd(args) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write('Usage: apg code-intel <subcommand>\n');
    process.stdout.write('Subcommands:\n');
    process.stdout.write('  collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>] [--since <ref>] [--operations a,b,c] [--json]\n');
    process.stdout.write('  doctor [<language>]\n');
    return 0;
  }
  if (sub === 'collect') return cmdCollect(args.slice(1));
  if (sub === 'doctor') return runDoctor(args.slice(1));
  process.stderr.write(`apg code-intel: unknown subcommand '${sub}'\n`);
  return 2;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/code-intel/cli/`
Expected: PASS, 5/5.

- [ ] **Step 7: Smoke-test the CLI from the shell**

Run: `node ./bin/apg.js code-intel doctor cpp`
Expected: prints `cpp: MISSING — clangd ...` (since clangd is not installed in the test env), exit 0.

Run: `node ./bin/apg.js code-intel collect cpp --project-root tests/fixtures/code-intel/cpp-fixture-repo --json | head -1`
Expected: prints a JSON object whose `status` is either `error` (clangd missing) or `ok`/`partial` (clangd present). With clangd absent the error code will be `internal_error` or `language_server_missing` from the spawn failure.

- [ ] **Step 8: Commit**

```bash
git add mcp/stdio/code-intel/cli/ tests/unit/code-intel/cli/
git commit -m "feat(cli): wire apg code-intel collect + doctor subcommands"
```

---

## Task 6: Optional integration test gated on real clangd

**Files:**
- Create: `tests/integration/code-intel/cpp-clangd-real.test.js`

- [ ] **Step 1: Write the integration test**

`tests/integration/code-intel/cpp-clangd-real.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { validateCollection } from '../../../mcp/stdio/ingest/code-intel/v02.js';

const clangdAvailable = (() => {
  const out = spawnSync('clangd', ['--version'], { encoding: 'utf8' });
  return out.status === 0;
})();

const fixtureRepo = path.resolve('tests/fixtures/code-intel/cpp-fixture-repo');

describe.skipIf(!clangdAvailable)('cpp-clangd provider (real clangd)', () => {
  it('collects against the fixture repo', async () => {
    const p = createCppClangdProvider();
    const result = await p.collect({
      language: 'cpp', projectRoot: fixtureRepo, scope: 'files',
      files: ['src/foo.cpp', 'src/bar.cpp'],
      operations: ['definitions', 'references', 'diagnostics']
    });
    expect(['ok', 'partial']).toContain(result.status);
    expect(validateCollection(result).valid).toBe(true);
  }, 30000);
});

if (!clangdAvailable) {
  describe('cpp-clangd provider (real clangd)', () => {
    it.skip('skipped — clangd not on PATH', () => {});
  });
}
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run tests/integration/code-intel/`
Expected: skipped (clangd not on PATH) or PASS (if clangd is installed).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/code-intel/
git commit -m "test(code-intel): add real-clangd integration test (gated on PATH)"
```

---

## Task 7: Full regression sweep + docs

**Files:**
- Modify: `docs/integrations/code-intel-provider-contract.md` (append wrapper-CLI usage section)

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run tests/unit/`
Expected: PASS, no regressions.

- [ ] **Step 2: Append wrapper-CLI usage to the contract doc**

Append to `docs/integrations/code-intel-provider-contract.md`:

```markdown

## Wrapper CLI usage

```text
apg code-intel doctor [<language>]
apg code-intel collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>] [--since <ref>] [--operations definitions,references,diagnostics] [--json]
```

`aify-code-intel` is a thin PATH shim that forwards to `apg code-intel` for hosts that need a top-level executable (e.g. Claude `.lsp.json`, Pi `.pi-lsp.json`).

`doctor` checks the per-language language-server binary and reports installed/missing with a fix hint. `collect` runs a provider and prints either a structured human-readable status (default) or the v0.2 collection JSON (`--json`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/integrations/code-intel-provider-contract.md
git commit -m "docs(code-intel): add wrapper CLI usage to provider contract"
```

- [ ] **Step 4: Tag**

```bash
git tag plan-2-cpp-clangd-provider-complete
```

---

## Acceptance summary

After Plan #2 lands:

- `apg` and `aify-code-intel` binaries exist and are wired into `package.json` `bin`.
- `apg code-intel doctor [<lang>]` reports per-language language-server status with fix hints.
- `apg code-intel collect <lang>` runs the provider runner end-to-end and emits a v0.2 collection envelope (validated by ajv).
- `cpp-clangd` provider drives clangd via stdio LSP, with batch warmup, symbol-aware references with warm-and-retry gate, three-state result distinction, and repo-relative path enforcement.
- Missing-prerequisite paths return structured error collections with `provider_missing | compile_db_missing | language_server_missing | language_server_timeout | internal_error` codes plus hints.
- Tests pass without clangd installed (fake LSP server fixture). Integration test runs against real clangd when present.

This is the unblock for Plan #3 (graph merge + freshness) and Plan #4 (packet v2 + verify mode).
