#!/usr/bin/env node
// What does `tools/list` cost, per verb, on every session that connects?
//
// WHY THIS EXISTS. `tools/list` is the ALWAYS-PAID surface: every session that connects pays for
// it before doing any work, whether or not it ever calls a graph verb. Measured 2026-08-25:
// 36.4% of sessions here call a verb at all, so the majority pay this and use none of it. That
// makes it the one surface where "reduces token usage" is directly actionable.
//
// ⛔ IT ALSO CORRECTS A BELIEF I HAD BEEN REASONING FROM. My own note said "80% of tools/list is
// schema", and the guidance derived from it was to put detail in descriptions because schema
// dominates anyway. MEASURED, IT IS 50/50 — descriptions are half the served bytes, and they are
// the half we author directly. The note was wrong and the advice built on it was too.
//
// ⚠ THIS REPORTS BYTES, NOT TOKENS. There is no tokenizer here, and chars/4 is a guess dressed as
// a measurement. Bytes are what can be counted exactly, so bytes are what this claims. Naming the
// noun is the whole discipline.
//
// ⚠ AND IT IS REPORT-ONLY. Descriptions carry the doubt clauses that a contract test enforces
// (`tools/list carries the facts an agent needs to choose and to doubt`) — the biggest ones are
// often the most load-bearing. A size ranking is a decision surface, never a cut list.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// pathToFileURL: on Windows a bare absolute path is not a valid ESM specifier.
const { TOOLS } = await import(pathToFileURL(path.join(ROOT, 'mcp/stdio/tools/schema.js')).href);

// The served set is whatever server.js lists by default. Read it from source rather than
// duplicating the list here — a second copy is how the compile-DB allowlists drifted apart.
function defaultToolNames() {
  const src = fs.readFileSync(path.join(ROOT, 'mcp/stdio/server.js'), 'utf8');
  const start = src.indexOf('const DEFAULT_TOOL_NAMES');
  if (start < 0) throw new Error('DEFAULT_TOOL_NAMES not found in server.js — the shape changed');
  const block = src.slice(start, src.indexOf(']', start));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// The bytes actually put on the wire for one tool, in MCP's tools/list shape.
const wireBytes = (t) => JSON.stringify({ name: t.name, description: t.description, inputSchema: t.schema }).length;
const descBytes = (t) => (t.description || '').length;

const names = defaultToolNames();
const served = TOOLS.filter((t) => names.includes(t.name));

// POSITIVE CONTROL: the listing must be non-empty and every name must resolve to a definition.
// A silent mismatch here would report a small, reassuring number for the wrong reason.
const unmatched = names.filter((n) => !TOOLS.some((t) => t.name === n));
const controlsPassed = served.length > 0 && unmatched.length === 0;

const rows = served
  .map((t) => ({ name: t.name, bytes: wireBytes(t), description: descBytes(t), schema: wireBytes(t) - descBytes(t) }))
  .sort((a, b) => b.bytes - a.bytes);

const servedBytes = rows.reduce((s, r) => s + r.bytes, 0);
const servedDesc = rows.reduce((s, r) => s + r.description, 0);
const unservedBytes = TOOLS.filter((t) => !names.includes(t.name)).reduce((s, t) => s + wireBytes(t), 0);

console.log(JSON.stringify({
  what: 'Bytes on the wire for tools/list — the surface every session pays before doing any work.',
  unit: 'BYTES, not tokens. No tokenizer here; chars/4 would be a guess dressed as a measurement.',
  controls: {
    servedToolsResolved: served.length,
    namesInDefaultList: names.length,
    unmatchedNames: unmatched,
    passed: controlsPassed,
  },
  served: {
    tools: served.length,
    bytes: servedBytes,
    descriptionBytes: servedDesc,
    schemaAndEnvelopeBytes: servedBytes - servedDesc,
    descriptionShare: servedBytes ? Number((servedDesc / servedBytes).toFixed(3)) : null,
  },
  notServed: { tools: TOOLS.length - served.length, bytes: unservedBytes },
  perTool: rows,
}, null, 2));

// Report-only: never gate anything on a size ranking.
process.exit(controlsPassed ? 0 : 1);
