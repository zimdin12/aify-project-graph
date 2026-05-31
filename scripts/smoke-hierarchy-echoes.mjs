// L4 real-clangd smoke for code_intel_hierarchy, run against echoes_of_the_fallen.
//
// Mirrors scripts/smoke-fix-a-echoes.mjs but exercises the LIVE hierarchy verb
// through the same spine (getLiveSession singleton clangd + INDEXED-mode
// waitForIndexReady). Proves the verb returns a REAL caller TREE with file:line
// hops after index-ready, plus tries a type-hierarchy (subtypes) query on a
// base/virtual type.
//
//   (A) callers   ChunkManager::setVoxel (ChunkManager.cpp:581:20) depth=2
//   (B) subtypes  ISimDomain             (sim/ISimDomain.h:110:7)  depth=2
//
// Usage: node scripts/smoke-hierarchy-echoes.mjs

import { codeIntelHierarchy } from '../mcp/stdio/query/verbs/code_intel_hierarchy.js';
import { shutdownAllSessions } from '../mcp/stdio/code-intel/live.js';

const REPO = process.env.SMOKE_REPO || 'C:/Users/Administrator/echoes_of_the_fallen';

if (!process.env.APG_CLANGD && process.platform === 'win32') {
  process.env.APG_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
}
// INDEXED mode (default) so the tree is trustworthy. Give clangd a generous
// budget for the first cross-TU index warm on a large repo.
delete process.env.APG_CLANGD_MODE;
if (!process.env.APG_CLANGD_INDEX_WAIT_MS) process.env.APG_CLANGD_INDEX_WAIT_MS = '120000';

async function run(label, args) {
  const t0 = Date.now();
  const r = await codeIntelHierarchy({ repoRoot: REPO, ...args });
  const ms = Date.now() - t0;
  console.log(`\n===== ${label} (${ms} ms) =====`);
  if (r.status !== 'ok') {
    console.log(`ERROR ${r.errors?.[0]?.code}: ${r.errors?.[0]?.message}`);
    return;
  }
  console.log(`mode=${r.mode} indexReady=${r.indexReady} roots=${r.roots} nodes=${r.telemetry.nodes} indexWaitMs=${r.telemetry.indexWaitMs} (${r.telemetry.indexWaitReason})`);
  console.log(r.treeText);
  console.log(`evidence: exhaustive=${r.evidence.exhaustive} ready=${r.evidence.ready} cause=${r.evidence.cause}`);
}

try {
  await run('A) callers of ChunkManager::setVoxel', {
    file: 'engine/voxel/ChunkManager.cpp', line: 581, col: 20, kind: 'callers', depth: 2
  });
  await run('B) subtypes of ISimDomain', {
    file: 'engine/voxel/sim/ISimDomain.h', line: 110, col: 7, kind: 'subtypes', depth: 2
  });
} finally {
  await shutdownAllSessions();
}
