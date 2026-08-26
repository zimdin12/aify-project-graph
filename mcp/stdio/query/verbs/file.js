import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { normalizePathArg } from '../../util/paths.js';
import { provenanceRankSql } from '../lsp-evidence.js';
// ⚠ Set-equal to what was written out by hand here; centralised so it cannot drift from
// graph_callers/graph_preflight the way preflight's copy did.
import { CALL_FAMILY } from '../../storage/taxonomy.js';
import { renderProvenanceTag } from '../renderer.js';

/**
 * Everything about one file in a single call.
 * Returns: the file node, all symbols it defines, all incoming calls to those
 * symbols, all outgoing calls from those symbols, and import edges.
 * One verb replaces: whereis + callers + callees for every symbol in the file.
 */
export async function graphFile({ repoRoot, path, top_k = 20 }) {
  if (!path || typeof path !== 'string') return 'ERROR: path parameter is required (e.g. graph_file(path="service/db.py"))';
  path = normalizePathArg(path); // accept Windows backslash paths (src\foo.cpp)
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_file' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    // Find the file node
    const fileNode = db.get(
      'SELECT * FROM nodes WHERE file_path = $path AND type = \'File\' LIMIT 1',
      { path }
    );
    if (!fileNode) {
      // Try partial match
      const partial = db.get(
        'SELECT * FROM nodes WHERE file_path LIKE $pattern AND type = \'File\' LIMIT 1',
        { pattern: `%${path}` }
      );
      if (!partial) return `NO FILE matching "${path}". Try graph_search(query="${path.split('/').pop()}") to find it.`;
      return prefixReadWarnings(graphFileInner(db, partial, top_k), freshness.warnings);
    }
    return prefixReadWarnings(graphFileInner(db, fileNode, top_k), freshness.warnings);
  } finally {
    db.close();
  }
}

function graphFileInner(db, fileNode, top_k) {
  const lines = [];

  // File info
  lines.push(`FILE ${fileNode.label} ${fileNode.file_path} ${fileNode.language || '?'}`);

  // What this file defines
  const defines = db.all(
    `SELECT n.* FROM nodes n
     WHERE n.file_path = $path AND n.type NOT IN ('File', 'Module', 'Directory')
     ORDER BY n.start_line LIMIT $limit`,
    { path: fileNode.file_path, limit: top_k }
  );
  if (defines.length > 0) {
    lines.push(`DEFINES ${defines.length} symbols:`);
    for (const d of defines) {
      lines.push(`  ${(d.type ?? 'unknown').toLowerCase()} ${d.label} :${d.start_line}`);
    }
  }

  // What this file imports
  const imports = db.all(
    `SELECT e.*, n.label AS to_label FROM edges e
     LEFT JOIN nodes n ON n.id = e.to_id
     WHERE e.source_file = $path AND e.relation = 'IMPORTS'
     LIMIT $limit`,
    { path: fileNode.file_path, limit: top_k }
  );
  if (imports.length > 0) {
    lines.push(`IMPORTS ${imports.length}:`);
    for (const i of imports) {
      lines.push(`  ${i.to_label ?? i.to_id}`);
    }
  }

  // Who calls INTO this file's symbols (incoming)
  const symbolIds = defines.map(d => d.id);
  if (symbolIds.length > 0) {
    const placeholders = symbolIds.map((_, i) => `$s${i}`).join(',');
    const params = { limit: top_k };
    symbolIds.forEach((id, i) => { params[`s${i}`] = id; });
    const incoming = db.all(
      `SELECT e.*, n.label AS from_label, n.file_path AS from_file, t.label AS to_label
       FROM edges e
       JOIN nodes n ON n.id = e.from_id
       JOIN nodes t ON t.id = e.to_id
       WHERE e.to_id IN (${placeholders}) AND e.relation IN (${CALL_FAMILY.map((r) => `'${r}'`).join(',')})
       AND n.file_path != $path
       ORDER BY ${provenanceRankSql('e.provenance')} DESC, e.confidence DESC LIMIT $limit`,
      { ...params, path: fileNode.file_path }
    );
    if (incoming.length > 0) {
      lines.push(`CALLED BY ${incoming.length} external edges:`);
      for (const e of incoming) {
        lines.push(`  ${e.from_label ?? '?'} -> ${e.to_label ?? '?'} ${e.relation} ${e.from_file}:${e.source_line} conf=${Number(e.confidence ?? 1).toFixed(2)}${renderProvenanceTag(e.provenance)}`);
      }
    }

    // What this file's symbols call OUT (outgoing)
    const outgoing = db.all(
      `SELECT e.*, n.label AS to_label, n.file_path AS to_file, t.label AS from_label
       FROM edges e
       JOIN nodes n ON n.id = e.to_id
       JOIN nodes t ON t.id = e.from_id
       WHERE e.from_id IN (${placeholders}) AND e.relation IN (${CALL_FAMILY.map((r) => `'${r}'`).join(',')})
       AND n.file_path != $path
       ORDER BY ${provenanceRankSql('e.provenance')} DESC, e.confidence DESC LIMIT $limit`,
      { ...params, path: fileNode.file_path }
    );
    if (outgoing.length > 0) {
      lines.push(`CALLS OUT ${outgoing.length} external edges:`);
      for (const e of outgoing) {
        lines.push(`  ${e.from_label ?? '?'} -> ${e.to_label ?? '?'} ${e.relation} ${e.to_file}:${e.source_line} conf=${Number(e.confidence ?? 1).toFixed(2)}${renderProvenanceTag(e.provenance)}`);
      }
    }
  }

  // Tests that cover this file
  const tests = db.all(
    `SELECT e.*, n.label AS from_label, n.file_path AS from_file
     FROM edges e JOIN nodes n ON n.id = e.from_id
     WHERE e.to_id IN (SELECT id FROM nodes WHERE file_path = $path)
     AND e.relation = 'TESTS' LIMIT 10`,
    { path: fileNode.file_path }
  );
  if (tests.length > 0) {
    lines.push(`TESTED BY ${tests.length}:`);
    for (const t of tests) {
      lines.push(`  ${t.from_label ?? '?'} ${t.from_file}`);
    }
  }

  return lines.join('\n');
}
