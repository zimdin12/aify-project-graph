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

// L4 hierarchy item builders. line is 0-based (LSP). selectionRange points at
// the name token; range spans the decl.
function chItem(name, uri, line) {
  return {
    name, kind: 12, uri,
    detail: `void ${name}()`,
    range: { start: { line, character: 0 }, end: { line: line + 2, character: 0 } },
    selectionRange: { start: { line, character: 5 }, end: { line, character: 5 + name.length } },
  };
}
function thItem(name, uri, line) {
  return {
    name, kind: 5, uri,
    detail: `class ${name}`,
    range: { start: { line, character: 0 }, end: { line: line + 3, character: 0 } },
    selectionRange: { start: { line, character: 6 }, end: { line, character: 6 + name.length } },
  };
}
function incoming(item) { return { from: item, fromRanges: [item.selectionRange] }; }
function outgoing(item) { return { to: item, fromRanges: [item.selectionRange] }; }

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return reply(msg.id, {
        capabilities: {
          textDocumentSync: 1,
          definitionProvider: true,
          referencesProvider: true,
          hoverProvider: true,
          documentSymbolProvider: true,
          // L4: advertise call/type hierarchy unless explicitly suppressed
          // (FAKE_LSP_NO_HIERARCHY=1 lets a test exercise hierarchy_unsupported).
          ...(process.env.FAKE_LSP_NO_HIERARCHY === '1' ? {} : { callHierarchyProvider: true, typeHierarchyProvider: true }),
          ...(process.env.FAKE_LSP_PULL_DIAGNOSTICS === '1' ? { diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } : {})
        },
        serverInfo: { name: 'fake-lsp', version: '0.0.1' }
      });
    case 'initialized':
      if (process.env.FAKE_LSP_PROGRESS === '1') {
        notify('$/progress', { token: 'index', value: { kind: 'begin', title: 'indexing' } });
        setTimeout(() => notify('$/progress', { token: 'index', value: { kind: 'end', message: 'ready' } }), 20);
      }
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
    case 'textDocument/diagnostic':
      return reply(msg.id, {
        kind: 'full',
        items: [{
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
          severity: 2,
          source: 'fake-pull',
          message: 'pull diagnostic warning'
        }]
      });
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
    // ── L4: call hierarchy ───────────────────────────────────────
    case 'textDocument/prepareCallHierarchy': {
      if (process.env.FAKE_LSP_HIERARCHY_EMPTY === '1') return reply(msg.id, null);
      const uri = msg.params.textDocument.uri;
      // HIGH-1 repro: a root that RESOLVES (index-ready) but whose incoming/
      // outgoing calls come back EMPTY ('lonely' is unknown to the call handlers
      // below, which reply []). This is the false-exhaustive trap — index-ready
      // + 0 callers must NOT report exhaustive=true.
      if (process.env.FAKE_LSP_HIERARCHY_ROOT_ONLY === '1') return reply(msg.id, [chItem('lonely', uri, 0)]);
      return reply(msg.id, [chItem('foo', uri, 0)]);
    }
    case 'callHierarchy/incomingCalls': {
      const uri = msg.params.item.uri;
      const name = msg.params.item.name;
      // foo ← caller_a (bar.cpp), caller_b (baz.cpp); caller_a ← top (qux.cpp)
      if (name === 'foo') {
        return reply(msg.id, [
          incoming(chItem('caller_a', uri.replace(/foo\.cpp$/, 'bar.cpp'), 10)),
          incoming(chItem('caller_b', uri.replace(/foo\.cpp$/, 'baz.cpp'), 20)),
        ]);
      }
      if (name === 'caller_a') {
        return reply(msg.id, [
          incoming(chItem('top', uri.replace(/bar\.cpp$/, 'qux.cpp'), 30)),
        ]);
      }
      return reply(msg.id, []);
    }
    case 'callHierarchy/outgoingCalls': {
      const uri = msg.params.item.uri;
      const name = msg.params.item.name;
      if (name === 'foo') {
        return reply(msg.id, [
          outgoing(chItem('callee_x', uri.replace(/foo\.cpp$/, 'bar.cpp'), 40)),
          outgoing(chItem('callee_y', uri.replace(/foo\.cpp$/, 'baz.cpp'), 50)),
        ]);
      }
      if (name === 'callee_x') {
        return reply(msg.id, [
          outgoing(chItem('deep_z', uri.replace(/bar\.cpp$/, 'qux.cpp'), 60)),
        ]);
      }
      return reply(msg.id, []);
    }
    // ── L4: type hierarchy ───────────────────────────────────────
    case 'textDocument/prepareTypeHierarchy': {
      if (process.env.FAKE_LSP_HIERARCHY_EMPTY === '1') return reply(msg.id, null);
      const uri = msg.params.textDocument.uri;
      return reply(msg.id, [thItem('Base', uri, 0)]);
    }
    case 'typeHierarchy/subtypes': {
      const uri = msg.params.item.uri;
      const name = msg.params.item.name;
      if (name === 'Base') {
        return reply(msg.id, [
          thItem('DerivedA', uri.replace(/foo\.cpp$/, 'bar.cpp'), 12),
          thItem('DerivedB', uri.replace(/foo\.cpp$/, 'baz.cpp'), 24),
        ]);
      }
      if (name === 'DerivedA') {
        return reply(msg.id, [thItem('LeafA', uri.replace(/bar\.cpp$/, 'qux.cpp'), 36)]);
      }
      return reply(msg.id, []);
    }
    case 'typeHierarchy/supertypes': {
      const name = msg.params.item.name;
      const uri = msg.params.item.uri;
      if (name === 'Base') {
        return reply(msg.id, [thItem('GrandBase', uri.replace(/foo\.cpp$/, 'bar.cpp'), 5)]);
      }
      return reply(msg.id, []);
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
