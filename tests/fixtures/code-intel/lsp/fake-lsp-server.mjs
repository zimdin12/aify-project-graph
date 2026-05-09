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
