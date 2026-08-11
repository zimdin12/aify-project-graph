// graph_explore (Code-Intel v2 / P1-3) — multi-symbol verbatim-source bundler.
//
// Input is a BAG of symbol/file names (NOT a question). Resolve each to a node,
// group by file, and return their verbatim source in ONE budget-capped call via
// the shared source-bundle helper — `cat -n` line numbers, "treat as already
// Read" framing. This kills the Read-spiral: an agent asking "show me the
// source of these N symbols" gets Read-equivalent source in a single call and
// should NOT re-open the shown files.
//
// Caps number of files/symbols (repo-size scaled); emits a "TRUNCATED — N more
// (narrow your list)" tail when over budget. On large tiers, appends a compact
// RELATIONSHIPS section (callers/callees AMONG the requested symbols only) so
// the agent also sees how the requested set connects.
//
// Reuses: symbol_lookup (resolveSymbol + selectBestRoot via path.js),
// source-bundle (rendering + budget + framing), read_freshness (snapshot guard).

import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbol } from './symbol_lookup.js';
import { selectBestRoot } from './path.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import {
  countGraphNodes,
  getSourceBundleBudget,
  renderSourceBundle,
  manifestIndexedAtMs,
} from '../source-bundle.js';
import { EXECUTION_FAMILY } from '../../storage/taxonomy.js';

// The execution edge family (registry EXECUTION_FAMILY) — same set the other
// traversal verbs walk; imported rather than re-declared (cohesion review R2).
const CALL_RELATIONS = EXECUTION_FAMILY;

// Resolve one requested name to its best node. Accepts a symbol OR a file path.
// For a file, returns a File-typed node so the whole-file group is anchored.
function resolveOne(db, name) {
  // File path? (contains a slash or a known source extension) — anchor on the
  // File node so its source is bundled whole.
  if (/[\\/]/.test(name) || /\.[a-z0-9]+$/i.test(name)) {
    const fileNode = db.get(
      `SELECT id, label, type, file_path, start_line, end_line FROM nodes
       WHERE file_path = $fp AND type = 'File' LIMIT 1`,
      { fp: name.replace(/\\/g, '/') },
    );
    if (fileNode) return { node: fileNode, requested: name, isFile: true };
  }
  const nodes = resolveSymbol(db, name);
  if (nodes.length === 0) return { node: null, requested: name, isFile: false };
  return { node: selectBestRoot(nodes), requested: name, isFile: false };
}

export async function graphExplore({ repoRoot, symbols = [], max_files }) {
  const requested = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
  if (requested.length === 0) return 'ERROR: symbols[] is required (a bag of symbol/file names).';

  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_explore' });
  if (freshness.blocker) return freshness.blocker;

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const nodeCount = countGraphNodes(db);
    const budget = getSourceBundleBudget(nodeCount);
    // max_files caps the number of FILE groups; default to the tier's block cap.
    const fileCap = Math.min(
      Number.isFinite(max_files) && max_files > 0 ? Number(max_files) : budget.maxBlocks,
      budget.maxBlocks,
    );

    const resolved = [];
    const notFound = [];
    for (const name of requested) {
      const r = resolveOne(db, name);
      if (!r.node) { notFound.push(name); continue; }
      resolved.push(r);
    }

    if (resolved.length === 0) {
      return prefixReadWarnings(
        `NO MATCH for any of: ${requested.join(', ')}. Try graph_search(query="…") to find similar names.`,
        freshness.warnings,
      );
    }

    // Group resolved nodes by file (preserve first-seen file order).
    const groups = new Map(); // file_path -> { file, blocks: [{symbol,startLine,endLine}] }
    for (const r of resolved) {
      const fp = r.node.file_path || '(unknown)';
      if (!groups.has(fp)) groups.set(fp, { file: fp, nodes: [] });
      groups.get(fp).nodes.push(r.node);
    }

    // Flatten into source-bundle blocks, file-group at a time, applying the
    // file cap. Symbols within a file are ordered by start_line.
    const allFiles = [...groups.values()];
    const keptFiles = allFiles.slice(0, fileCap);
    const droppedFiles = allFiles.length - keptFiles.length;

    const blocks = [];
    for (const g of keptFiles) {
      const sorted = [...g.nodes].sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));
      for (const n of sorted) {
        blocks.push({
          symbol: n.label,
          filePath: n.file_path,
          startLine: n.start_line,
          endLine: n.end_line || n.start_line,
          // ★ A FILE BLOCK'S "SYMBOL" IS ITS FILENAME, AND A FILE NEED NOT CONTAIN ITS
          // OWN NAME. Passing `n.label` as the thing to look for made the drift proof
          // report PROVEN OFFSET DRIFT on a perfectly fresh index — graph-senior-dev
          // reproduced it live on `bin/apg.js`.
          //
          // That is the worst possible failure for this check: a false ⛔ on the loudest
          // warning we emit, on a correct repo. A warning that fires when nothing is
          // wrong trains readers to ignore it, which costs more than never having built
          // it — the same argument that killed the filler suggestion and the permanent
          // caveat. Filename absence proves nothing, so file blocks are not drift-proved
          // at all; the staleness check still covers them.
          verifiable: n.type !== 'File' && n.type !== 'Directory',
        });
      }
    }

    const { text: bundle, dropped: droppedBlocks, unverified } = renderSourceBundle({
      blocks,
      repoRoot,
      budget,
      indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    const lines = [];
    lines.push(`EXPLORE — ${resolved.length} symbol${resolved.length === 1 ? '' : 's'} across ${keptFiles.length} file${keptFiles.length === 1 ? '' : 's'} (tier=${budget.name}).`);
    // ★ THE PROMISE IS NOW CONDITIONAL, AND IT IS THE PROMISE THAT MADE THE BUG SERIOUS.
    //
    // "Do NOT re-Read the files shown below" is an instruction to stop verifying. Issued
    // unconditionally, it converted a stale-offset window from something a careful reader
    // would catch into something they were told not to check. The line offsets come from
    // the index; the bytes come from now; nothing reconciled them.
    //
    // So the banner is withdrawn for exactly the blocks that could not be verified, and
    // the withdrawal names them — a blanket "some blocks may be stale" would leave the
    // reader unable to act on it.
    if (unverified.length === 0) {
      lines.push('Returned source is Read-equivalent — do NOT re-Read the files shown below.');
    } else {
      // `unverified` is one entry PER BLOCK — it used to be one per warning, which
      // rendered "NOT Read-equivalent for 2 of 1 block(s)" as soon as a block raised
      // both kinds. In production both kinds always co-occur, because a real edit
      // changes content and mtime together.
      const drifted = unverified.filter((u) => u.kinds.includes('offset_drift'));
      lines.push(`⛔ NOT Read-equivalent for ${unverified.length} of ${blocks.length} block(s) — re-Read those files before citing them. The rest are verbatim.`);
      if (drifted.length > 0) {
        lines.push(`⛔ ${drifted.length} of those show PROVEN offset drift (the symbol is absent from its own body): ${drifted.map((d) => `${d.symbol} @ ${d.filePath}`).join(', ')}. Run graph_index.`);
      }
    }
    lines.push('');
    lines.push(bundle);

    // TRUNCATED tail — count both file-cap drops and budget-line drops.
    const totalDropped = droppedFiles + droppedBlocks;
    if (totalDropped > 0) {
      lines.push('');
      lines.push(`TRUNCATED — ${totalDropped} more symbol/file group(s) not shown (narrow your list, or call graph_explore again with the remainder).`);
    }

    if (notFound.length) {
      lines.push('');
      lines.push(`NOT FOUND: ${notFound.join(', ')} — try graph_search for these.`);
    }

    // RELATIONSHIPS — only on large tiers (large/huge), and only edges AMONG the
    // requested symbols so the section stays compact and on-topic.
    if (budget.name === 'large' || budget.name === 'huge') {
      const rel = renderRelationships(db, resolved);
      if (rel) {
        lines.push('');
        lines.push(rel);
      }
    }

    return prefixReadWarnings(lines.join('\n'), freshness.warnings);
  } finally {
    db.close();
  }
}

// Compact callers/callees AMONG the requested set only. Returns a string or
// null when no intra-set edges exist.
function renderRelationships(db, resolved) {
  const idToLabel = new Map(resolved.map((r) => [r.node.id, r.node.label]));
  const ids = [...idToLabel.keys()];
  if (ids.length < 2) return null;
  const placeholders = ids.map((_, i) => `$i${i}`).join(',');
  const params = {};
  ids.forEach((id, i) => { params[`i${i}`] = id; });
  const relFilter = CALL_RELATIONS.map((r) => `'${r}'`).join(',');

  const edges = db.all(
    `SELECT e.from_id, e.to_id FROM edges e
     WHERE e.from_id IN (${placeholders}) AND e.to_id IN (${placeholders})
       AND e.relation IN (${relFilter})
     LIMIT 50`,
    params,
  );
  if (edges.length === 0) return null;
  const seen = new Set();
  const out = ['RELATIONSHIPS (among requested symbols):'];
  for (const e of edges) {
    const key = `${e.from_id}->${e.to_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`  ${idToLabel.get(e.from_id)} → ${idToLabel.get(e.to_id)}`);
  }
  return out.length > 1 ? out.join('\n') : null;
}
