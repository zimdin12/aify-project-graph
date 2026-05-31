// Real-clangd smoke for Code-Intel v2 FIX A/B/C, run against echoes_of_the_fallen.
//
// Collects ChunkManager::setVoxel's TU + two cross-TU caller TUs BOTH ways:
//   (1) BOUNDED  (APG_CLANGD_MODE=bounded) — no readiness wait (baseline).
//   (2) INDEXED  (default)                 — waits for background index idle.
// Reports per-run: indexReady, indexWaitMs, refs found/not-found symbol tallies,
// total reference records, and the count of LSP_VERIFIED CALLS edges that land
// on the setVoxel callee node after import. Also proves FIX C: the callee node
// for setVoxel is a Method/Function, not the enclosing Class.
//
// Usage: node scripts/smoke-fix-a-echoes.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareCompileDb } from '../mcp/stdio/code-intel/compile-db.js';
import { createCppClangdProvider } from '../mcp/stdio/code-intel/providers/cpp-clangd.js';
import { importCodeIntel } from '../mcp/stdio/ingest/code-intel/importer.js';
import { openDb } from '../mcp/stdio/storage/db.js';

const REPO = process.env.SMOKE_REPO || 'C:/Users/Administrator/echoes_of_the_fallen';
const TARGET_FILE = 'engine/voxel/ChunkManager.cpp';
const CALLER_FILES = [
  'engine/core/Engine_render.cpp',
  'engine/core/ConsoleCommandProcessor_WorldEdit.cpp',
];
const FILES = [TARGET_FILE, ...CALLER_FILES];
const TARGET_QNAME_LEAF = 'setVoxel';

if (!process.env.APG_CLANGD && process.platform === 'win32') {
  process.env.APG_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
}

async function runOnce(mode) {
  if (mode === 'bounded') process.env.APG_CLANGD_MODE = 'bounded';
  else delete process.env.APG_CLANGD_MODE;

  const provider = createCppClangdProvider();
  const t0 = Date.now();
  const envelope = await provider.collect({
    language: 'cpp',
    projectRoot: REPO,
    scope: 'files',
    files: FILES,
    operations: ['symbols', 'definitions', 'references'],
  });
  const collectMs = Date.now() - t0;

  // Import into a throwaway db so we can count synthesized LSP_VERIFIED edges.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `smoke-${mode}-`));
  // Seed from the real graph so tree-sitter nodes (the callee Method, callers)
  // exist for edge synthesis to land on.
  const realDb = path.join(REPO, '.aify-graph', 'graph.sqlite');
  const tmpDb = path.join(tmpDir, 'graph.sqlite');
  fs.copyFileSync(realDb, tmpDb);
  const env2 = path.join(tmpDir, 'collection.json');
  fs.writeFileSync(env2, JSON.stringify(envelope));
  const db = openDb(tmpDb);
  let importStats, calleeEdges, calleeNode;
  try {
    importStats = importCodeIntel(env2, db);
    // Find the setVoxel callee node + count LSP_VERIFIED CALLS edges into it.
    const calleeRow = db.get(
      `SELECT id, type, label, start_line, end_line FROM nodes
        WHERE file_path = $f AND label = $l
          AND type IN ('Method','Function','Class','Struct')
        ORDER BY CASE WHEN type IN ('Method','Function') THEN 0 ELSE 1 END, start_line
        LIMIT 1`,
      { f: TARGET_FILE, l: TARGET_QNAME_LEAF },
    );
    calleeNode = calleeRow || null;
    if (calleeRow) {
      const e = db.get(
        `SELECT count(*) AS c FROM edges WHERE to_id = $id AND relation='CALLS' AND provenance='LSP_VERIFIED'`,
        { id: calleeRow.id },
      );
      calleeEdges = e?.c ?? 0;
    } else {
      calleeEdges = 0;
    }
  } finally {
    db.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  const refRecords = (envelope.records || []).filter((r) => r.kind === 'reference');
  const refFoundRecords = refRecords.filter((r) => r.result_state === 'found');
  return {
    mode,
    collectMs,
    status: envelope.status,
    session: {
      mode: envelope.session?.mode,
      indexReady: envelope.session?.indexReady,
      indexWaitMs: envelope.session?.indexWaitMs,
      indexWaitReason: envelope.session?.indexWaitReason,
      refsFoundSymbols: envelope.session?.refsFoundSymbols,
      refsNotFoundSymbols: envelope.session?.refsNotFoundSymbols,
    },
    refRecordCount: refRecords.length,
    refFoundRecordCount: refFoundRecords.length,
    importEdgesCreated: importStats?.edgesCreated,
    calleeNode: calleeNode
      ? { id: calleeNode.id, type: calleeNode.type, label: calleeNode.label, lines: `${calleeNode.start_line}-${calleeNode.end_line}` }
      : null,
    calleeLspVerifiedCallers: calleeEdges,
  };
}

const out = {};
console.error('[smoke] BOUNDED run (no readiness wait)…');
out.bounded = await runOnce('bounded');
console.error('[smoke] INDEXED run (FIX A readiness wait)…');
out.indexed = await runOnce('indexed');

console.log(JSON.stringify(out, null, 2));
