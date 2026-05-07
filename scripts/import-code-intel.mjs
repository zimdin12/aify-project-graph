#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { openDb } from '../mcp/stdio/storage/db.js';
import { readCodeIntelJsonl } from '../mcp/stdio/ingest/code-intel/schema.js';
import { importCodeIntelRecords } from '../mcp/stdio/ingest/code-intel/importer.js';

function usage() {
  console.error('Usage: node scripts/import-code-intel.mjs <repoRoot> <records.jsonl>');
}

const [repoArg, recordsArg] = process.argv.slice(2);
if (!repoArg || !recordsArg) {
  usage();
  process.exit(2);
}

const repoRoot = resolve(repoArg);
const recordsPath = resolve(recordsArg);
const records = await readCodeIntelJsonl(recordsPath);
const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
try {
  const counts = importCodeIntelRecords(db, records);
  console.log(JSON.stringify({ ok: true, repoRoot, recordsPath, ...counts }, null, 2));
} finally {
  db.close();
}
