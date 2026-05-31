// P0-1 real-clangd smoke: prove cold `graph_collect_code_intel` no longer
// blocks ~53s. Deletes the persisted clangd index cache to force a COLD index,
// runs a collect on a few echoes files with a SMALL total budget
// (APG_COLLECT_BUDGET_MS=5000), and asserts it returns status:'partial' +
// session.budgetExhausted:true + a resume note in WELL under 8s. Then runs
// AGAIN warm (cache now persisted) and shows it completes faster/fuller.
//
// Usage:
//   APG_COLLECT_BUDGET_MS=5000 node scripts/smoke-p0-1-budget-echoes.mjs
//   (defaults to 5000 if unset)

import fs from 'node:fs';
import path from 'node:path';
import { createCppClangdProvider } from '../mcp/stdio/code-intel/providers/cpp-clangd.js';

const REPO = process.env.SMOKE_REPO || 'C:/Users/Administrator/echoes_of_the_fallen';
const FILES = [
  'engine/voxel/ChunkManager.cpp',
  'engine/core/Engine_render.cpp',
  'engine/core/ConsoleCommandProcessor_WorldEdit.cpp',
];
// Small budget for the COLD proof (must return partial fast); generous budget
// for the WARM proof (index now persisted → completes). Both are total budgets.
const COLD_BUDGET_MS = Number(process.env.APG_COLLECT_BUDGET_MS) || 5000;
// The warm budget is large enough to let the (persisted) index drain on a big
// repo; the realistic agent flow re-runs collect until status flips to 'ok'.
const WARM_BUDGET_MS = Number(process.env.APG_WARM_BUDGET_MS) || 120000;

if (!process.env.APG_CLANGD && process.platform === 'win32') {
  process.env.APG_CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
}

const CACHE_DIR = path.join(REPO, '.aify-graph', 'code-intel', '.cache');

function deleteCache() {
  try {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error(`[smoke] failed to delete cache: ${e.message}`);
    return false;
  }
}

async function runOnce(label, budgetMs) {
  process.env.APG_COLLECT_BUDGET_MS = String(budgetMs);
  const provider = createCppClangdProvider();
  const t0 = Date.now();
  const env = await provider.collect({
    language: 'cpp',
    projectRoot: REPO,
    scope: 'files',
    files: FILES,
    operations: ['symbols', 'definitions', 'references'],
  });
  const elapsedMs = Date.now() - t0;
  const note = (env.notes || []).find((n) => n.code === 'budget_exhausted');
  return {
    label,
    elapsedMs,
    status: env.status,
    budgetMs: env.session?.budgetMs,
    budgetExhausted: env.session?.budgetExhausted,
    indexReady: env.session?.indexReady,
    indexWaitMs: env.session?.indexWaitMs,
    indexWaitReason: env.session?.indexWaitReason,
    filesProcessed: env.session?.filesProcessed,
    filesTotal: env.session?.filesTotal,
    refsFoundSymbols: env.session?.refsFoundSymbols,
    records: (env.records || []).length,
    resumeNote: note ? note.message : null,
  };
}

const out = {};

console.error('[smoke] COLD: deleting persisted clangd index cache to force a cold index…');
out.cacheDeleted = deleteCache();

console.error(`[smoke] COLD run (budget=${COLD_BUDGET_MS}ms)…`);
out.cold = await runOnce('cold', COLD_BUDGET_MS);

// The realistic agent flow re-runs collect until it completes. On a big repo
// the persisted background index may need more than one warm pass to fully
// drain; loop (bounded) until status flips to 'ok' or we run out of passes.
console.error(`[smoke] WARM runs (budget=${WARM_BUDGET_MS}ms, repeat until ok, max 3)…`);
out.warmPasses = [];
let warm = null;
for (let i = 1; i <= 3; i++) {
  warm = await runOnce(`warm-${i}`, WARM_BUDGET_MS);
  out.warmPasses.push(warm);
  console.error(`[smoke]   warm pass ${i}: status=${warm.status} indexReady=${warm.indexReady} records=${warm.records} ${warm.elapsedMs}ms`);
  if (warm.status === 'ok') break;
}
out.warm = warm;

// Assertions for the P0-1 acceptance criteria.
const cold = out.cold;
out.assertions = {
  cold_partial: cold.status === 'partial',
  cold_budgetExhausted: cold.budgetExhausted === true,
  cold_has_resume_note: typeof cold.resumeNote === 'string' && /run graph_collect_code_intel again/.test(cold.resumeNote),
  cold_under_8s: cold.elapsedMs < 8000,
  // Warm flow eventually completes (status ok, real records) within the budget.
  warm_completes_ok: out.warm && out.warm.status === 'ok' && out.warm.records > 0,
};
out.pass = Object.values(out.assertions).every(Boolean);

console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
