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

export async function graphCollectCodeIntel({ repoRoot, language, scope = 'changed', files, since, operations }) {
  if (!repoRoot) return { schema_version: '0.2', status: 'error', errors: [{ code: 'internal_error', message: 'repoRoot required' }], records: [] };
  if (!language) return { schema_version: '0.2', status: 'error', errors: [{ code: 'language_unsupported', message: 'language required' }], records: [] };

  ensureBuiltinProviders();

  const result = await runCollection({
    language,
    projectRoot: repoRoot,
    scope,
    files: Array.isArray(files) && files.length > 0 ? files : undefined,
    since,
    operations: operations || ['definitions', 'references', 'diagnostics']
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

  return result;
}
