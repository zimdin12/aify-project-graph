#!/usr/bin/env node
// A fake clangd that speaks LSP over stdio and replays frames captured from a real run.
//
// ⚠ WHY A PROCESS AND NOT A STUBBED FUNCTION. The obligation under test is that APG never converts
// an internally incoherent Location into a normal definition record. Stubbing the provider's
// client would skip LspClient's decode path, which is exactly one of the layers the boundary
// capture had to rule out. Replaying through a real stdio process exercises framing, decode and
// admission together.
//
// Frames are DERIVED from docs/evidence/m1a-step-c/receipts/boundary-capture.jsonl (immutable);
// lineage lives in wire-frames.json beside this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = JSON.parse(fs.readFileSync(path.join(HERE, 'wire-frames.json'), 'utf8'));

// Which definition payload to serve, chosen by the harness.
const MODE = process.env.APG_FAKE_CLANGD_MODE || 'invalid_directory';

// ⛔ THE MIXED FRAME'S *VALID* SIBLING MUST POINT AT A FILE THE HARNESS CREATED.
//
// As captured, that entry carried a hardcoded absolute URI:
//   file:///C:/Users/ADMINI~1/AppData/Local/Temp/apg-clangd-qual/src/callers.cpp
// Nothing creates that path. The test passed on this machine ONLY because a LEAKED temp directory
// from some earlier run happened to still be there — and it went red the moment that leak was
// cleaned up (2026-09-02, during the %TEMP% purge). On a fresh machine or in CI it would ALWAYS
// have failed: `location-coherence.js` classifies an unreadable path as `unreadable` and refuses
// the location, so "the valid sibling survives" was asserting against a file that did not exist.
//
// ⚠ The sibling case above was already fixed for exactly this reason — its comment records that an
// earlier version pointed at this host's MSVC install and was environment-dependent. The `mixed`
// case was left behind. One fix is not a sweep.
//
// The INVALID entry keeps its captured directory URI: that one is the artefact under test, its
// wrongness is the point, and it must stay byte-identical to what the real provider sent.
function mixedFrame() {
  const frame = FRAMES.references_id6_MIXED_valid_and_invalid;
  const validUri = process.env.APG_FAKE_VALID_URI;
  if (!validUri) return frame;
  return frame.map((entry, index) => (index === 0 ? { ...entry, uri: validUri } : entry));
}

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
}

function resultFor(method) {
  if (method === 'initialize') {
    return { capabilities: { documentSymbolProvider: true, definitionProvider: true, referencesProvider: true } };
  }
  if (method === 'textDocument/documentSymbol') return FRAMES.documentSymbol_id2;
  if (method === 'textDocument/definition') {
    // ⚠ The external control points at a file the HARNESS created, not at this host's MSVC
    // install. An earlier version used `.../include/vector`: it passed here and would have been
    // environment-dependent elsewhere, and under the completed contract it could not satisfy
    // token correspondence at all — a control that proves nothing about a valid external location.
    if (MODE === 'external_readable_file') {
      const uri = process.env.APG_FAKE_EXTERNAL_URI;
      const line = Number(process.env.APG_FAKE_EXTERNAL_LINE ?? 0);
      return [{ uri, range: { start: { line, character: 5 }, end: { line, character: 16 } } }];
    }
    if (MODE === 'mixed') return mixedFrame();
    return FRAMES.definition_id3_INVALID_directory_uri;
  }
  if (method === 'textDocument/references') {
    if (MODE === 'mixed') return mixedFrame();
    return [];
  }
  if (method === 'shutdown') return null;
  return null;
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = Number(match[1]);
    if (buffer.length < headerEnd + 4 + len) return;
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
    buffer = buffer.slice(headerEnd + 4 + len);
    let msg;
    try { msg = JSON.parse(body); } catch { continue; }
    if (msg.id === undefined) {
      if (msg.method === 'exit') process.exit(0);
      continue; // notification
    }
    send({ jsonrpc: '2.0', id: msg.id, result: resultFor(msg.method) });
    if (msg.method === 'shutdown') setTimeout(() => process.exit(0), 50);
  }
});
