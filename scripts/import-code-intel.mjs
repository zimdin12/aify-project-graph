#!/usr/bin/env node
// Import a code-intel collection into a repo's graph.
//
//   node scripts/import-code-intel.mjs <repoRoot> <file>
//
// <file> is either the v0.2 collection envelope `apg code-intel collect <lang> --json` prints, or v0.1 JSONL (one
// record per line). This script used to read only v0.1, so the documented collect-then-import path refused every
// envelope with "record.kind must be a non-empty string" (#19). A v0.2 envelope goes through importCodeIntel, which
// validates it; everything else keeps the v0.1 reader, which validates every record.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../mcp/stdio/storage/db.js';
import { readCodeIntelJsonl, detectSchemaVersion } from '../mcp/stdio/ingest/code-intel/schema.js';
import { importCodeIntel, importCodeIntelRecords } from '../mcp/stdio/ingest/code-intel/importer.js';

function usage() {
  console.error('Usage: node scripts/import-code-intel.mjs <repoRoot> <collection.json | records.jsonl>');
}

function isV02Envelope(path) {
  try { return detectSchemaVersion(JSON.parse(readFileSync(path, 'utf8'))) === '0.2'; } catch { return false; }
}

const [repoArg, recordsArg] = process.argv.slice(2);
if (!repoArg || !recordsArg) {
  usage();
  process.exit(2);
}

const repoRoot = resolve(repoArg);
const recordsPath = resolve(recordsArg);
const v02 = isV02Envelope(recordsPath);
const records = v02 ? null : await readCodeIntelJsonl(recordsPath);
const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
try {
  const counts = v02 ? importCodeIntel(recordsPath, db) : importCodeIntelRecords(db, records);
  console.log(JSON.stringify({ ok: true, repoRoot, recordsPath, ...counts }, null, 2));
} finally {
  db.close();
}
