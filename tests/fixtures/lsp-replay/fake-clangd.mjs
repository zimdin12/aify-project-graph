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
    if (MODE === 'external_system_file') return FRAMES.definition_EXTERNAL_SYSTEM_FILE_must_stay_admissible;
    if (MODE === 'mixed') return FRAMES.references_id6_MIXED_valid_and_invalid;
    return FRAMES.definition_id3_INVALID_directory_uri;
  }
  if (method === 'textDocument/references') {
    if (MODE === 'mixed') return FRAMES.references_id6_MIXED_valid_and_invalid;
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
