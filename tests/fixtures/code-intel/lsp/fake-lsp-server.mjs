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

// FAKE_LSP_COLD_PREPARE=1 simulates the real-clangd cold-parse race: a freshly
// didOpen'd file has no AST yet, so prepareCall/TypeHierarchy returns NO ROOT
// until clangd publishes its first diagnostics for the URI (the parse-complete
// signal). The verb's cold-retry waits on that publish and re-prepares.
const _parsedUris = new Set();

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
        // FAKE_LSP_INDEXING_FOREVER: begin indexing and never end it, so waitForIndexReady
        // genuinely times out and indexReady comes back FALSE. Added 2026-08-25 because the
        // fixture could not previously express a not-ready index at all — without progress the
        // client short-circuits to 'no_progress_signalled' ready, and with it the 20ms end
        // arrives before any realistic budget. A test asserting not-ready behaviour therefore
        // had an UNREACHABLE branch and passed by never running it (graph-senior-dev, review of
        // b396c0a). The state has to be constructible before a test of it can mean anything.
        if (process.env.FAKE_LSP_INDEXING_FOREVER !== '1') {
          setTimeout(() => notify('$/progress', { token: 'index', value: { kind: 'end', message: 'ready' } }), 20);
        }
      }
      return;
    case 'shutdown':
      return reply(msg.id, null);
    case 'exit':
      return process.exit(0);
    case 'textDocument/didOpen':
      // Cold-parse simulation: publish an (empty) diagnostics for the opened URI
      // shortly after open, then mark it parsed so the retried prepare resolves.
      if (process.env.FAKE_LSP_COLD_PREPARE === '1') {
        const u = msg.params.textDocument.uri;
        setTimeout(() => {
          _parsedUris.add(u);
          notify('textDocument/publishDiagnostics', { uri: u, diagnostics: [] });
        }, 30);
      }
      // Genuinely-rootless fixture models a REAL parsed file: clangd always
      // publishes (here empty) diagnostics after parsing, so publishCount>0 and
      // the verb's cold-prepare retry is correctly skipped (root stays empty).
      if (process.env.FAKE_LSP_HIERARCHY_EMPTY === '1') {
        notify('textDocument/publishDiagnostics', { uri: msg.params.textDocument.uri, diagnostics: [] });
      }
      // A file named `unresolved.<ext>` publishes an UNRESOLVED-INCLUDE diagnostic, in clangd's
      // exact phrasing. Added 2026-08-25 because the translationUnitFailed guard's FIRING half was
      // unprovable: the field test could not produce a TU that fails to compile, and this fixture
      // could only emit "use of undeclared identifier" — a severity-1 error the matcher correctly
      // IGNORES. So the guard was observed firing once by hand and pinned by nothing.
      //
      // Keeping `bad.<ext>` beside it is deliberate: it is the NEGATIVE control. A hard error that
      // is not an include failure must NOT trip the guard, or the flag means "something went
      // wrong" rather than "this TU has no AST".
      if (/unresolved\.\w+$/.test(msg.params.textDocument.uri || '')) {
        notify('textDocument/publishDiagnostics', {
          uri: msg.params.textDocument.uri,
          diagnostics: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1, message: "'cstddef' file not found"
          }]
        });
      }
      // Emit a fake diagnostic for any file named `bad.<ext>` (bad.cpp/bad.ts/bad.py)
      // so multi-language tests can exercise the diagnostics path.
      if (/bad\.\w+$/.test(msg.params.textDocument.uri || '')) {
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
      // FAKE_LSP_MANY_REFS: more references than MAX_REFS_PER_SYMBOL (2000), so the real
      // provider's per-symbol truncation actually fires and increments
      // refsTruncatedSymbols. Added because graph-senior-dev-hermes mutated that increment
      // to `+= 0` — leaving a `// refsTruncatedSymbols += 1` comment as a source-shaped
      // canary — and 20/20 tests stayed green: nothing in the suite had ever provoked a
      // symbol over the cap, so the counter's production was pinned only by a grep that a
      // COMMENT satisfied.
      if (process.env.FAKE_LSP_MANY_REFS === '1') {
        const n = Number(process.env.FAKE_LSP_MANY_REFS_COUNT || 2050);
        return reply(msg.id, Array.from({ length: n }, (_, i) => ({
          uri: otherUri,
          range: { start: { line: i, character: 2 }, end: { line: i, character: 5 } },
        })));
      }
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
      // FAKE_LSP_UNPLACEABLE: a NAMED symbol whose identifier does not appear in the
      // source text — the exact condition `positionGuessSkipped` counts. The name is
      // deliberately not anonymous, because the provider routes anonymous constructs to a
      // DIFFERENT counter (isAnonymousSymbolName), and conflating those two is the defect
      // that split was made to prevent.
      //
      // ⚠ Added so the REAL producer can be pinned. graph-senior-dev-hermes zeroed both
      // counters immediately before the provider's returned envelope, left every increment
      // site intact, and 14/14 tests stayed green — because every test in that journey
      // FABRICATED the session instead of provoking it.
      // ⚠ SymbolInformation shape (`location.range`), NOT DocumentSymbol. The provider
      // only has to GUESS a column on this shape — DocumentSymbol carries selectionRange,
      // which gives the identifier position directly and never sets posGuessed. My first
      // version of this fixture returned the hierarchical shape and the counter stayed 0:
      // the fixture reached the wrong branch, so the "unplaceable" case was measuring
      // nothing. Found by the test failing, not by reading the fixture.
      if (process.env.FAKE_LSP_UNPLACEABLE === '1') {
        return reply(msg.id, [
          {
            name: 'NoSuchIdentifierInSource',
            kind: 12,
            location: {
              uri: msg.params.textDocument.uri,
              range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
            },
          },
        ]);
      }
      return reply(msg.id, [
        { name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selectionRange: { start: { line: 0, character: 5 }, end: { line: 0, character: 8 } } }
      ]);
    }
    // ── L4: call hierarchy ───────────────────────────────────────
    case 'textDocument/prepareCallHierarchy': {
      if (process.env.FAKE_LSP_HIERARCHY_EMPTY === '1') return reply(msg.id, null);
      const uri = msg.params.textDocument.uri;
      if (process.env.FAKE_LSP_COLD_PREPARE === '1' && !_parsedUris.has(uri)) return reply(msg.id, null);
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
      if (process.env.FAKE_LSP_COLD_PREPARE === '1' && !_parsedUris.has(uri)) return reply(msg.id, null);
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
