// graph_collect_code_intel — public action verb agents and bridge call to
// run a code-intel collection. Public per superplan invariant #6: APG owns
// artifacts; bridge triggers the same verb agents call. Returns the v0.2
// collection envelope (status, errors, records).
//
// Side effect on success: when the response is `ok` or `partial`, the
// collection is also imported into the local APG graph DB so it's
// immediately visible to graph_health.codeIntel, graph_pull's code_intel
// layer, graph_change_plan ranking, and packet evidence blocks.

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { runCollection } from '../../code-intel/runner.js';
import { registerProvider, getProvider } from '../../code-intel/providers/index.js';
import { createCppClangdProvider } from '../../code-intel/providers/cpp-clangd.js';
import { openDb, openExistingDb } from '../../storage/db.js';
import { importCodeIntel } from '../../ingest/code-intel/importer.js';

let providersRegistered = false;
function ensureBuiltinProviders() {
  if (providersRegistered) return;
  if (!getProvider('cpp-clangd')) {
    registerProvider('cpp-clangd', () => createCppClangdProvider());
  }
  providersRegistered = true;
}

export async function graphCollectCodeIntel({ repoRoot, language, scope = 'changed', files, since, operations, budgetMs }) {
  if (!repoRoot) return { schema_version: '0.2', status: 'error', errors: [{ code: 'internal_error', message: 'repoRoot required' }], records: [] };
  if (!language) return { schema_version: '0.2', status: 'error', errors: [{ code: 'language_unsupported', message: 'language required' }], records: [] };

  ensureBuiltinProviders();

  // P0-1: thread the optional total time budget down to the provider so the
  // collect ALWAYS returns inside it (default ~40s via APG_COLLECT_BUDGET_MS),
  // never blocking past the MCP host's tool-call timeout on a cold index.
  const result = await runCollection({
    language,
    projectRoot: repoRoot,
    scope,
    files: Array.isArray(files) && files.length > 0 ? files : undefined,
    since,
    operations: operations || ['definitions', 'references', 'diagnostics'],
    ...(Number.isFinite(Number(budgetMs)) ? { budgetMs: Number(budgetMs) } : {})
  });

  // Import into local graph if useful records were produced.
  if (result.status !== 'error') {
    try {
      const graphDir = join(repoRoot, '.aify-graph');
      mkdirSync(graphDir, { recursive: true });
      const dbPath = join(graphDir, 'graph.sqlite');
      if (!existsSync(dbPath)) {
        const db = openDb(dbPath);
        db.close();
      }
      const tmpPath = join(graphDir, `code-intel-${result.collectionId}.json`);
      writeFileSync(tmpPath, JSON.stringify(result));
      const db = openExistingDb(dbPath, { readonly: false });
      try { importCodeIntel(tmpPath, db); } finally { db.close(); }
    } catch (err) {
      result.errors = result.errors || [];
      result.errors.push({ code: 'internal_error', message: `import failed: ${err.message}`, hint: 'collection succeeded but local import failed; re-run or import manually' });
    }
  }

  // P0-1: when the provider hit the time budget, surface the resume note in the
  // envelope errors[] too (alongside notes[]), so MCP hosts/agents that only
  // render errors still get the "run again to complete" signal. Keep it a
  // non-error, structured note item — status stays 'partial', not 'error'.
  if (result.session && result.session.budgetExhausted) {
    const note = Array.isArray(result.notes)
      ? result.notes.find(n => n.code === 'budget_exhausted')
      : null;
    if (note) {
      result.errors = result.errors || [];
      if (!result.errors.some(e => e.code === 'budget_exhausted')) {
        result.errors.push({
          code: 'budget_exhausted',
          message: note.message,
          hint: 'partial result is already imported; re-run graph_collect_code_intel (warm) to continue/complete'
        });
      }
    }
  }

  return result;
}
