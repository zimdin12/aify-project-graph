import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { SEARCH_TYPES } from './whereis.js';

function formatLocation(filePath, line) {
  return `${filePath}:${line ?? 0}`;
}

// Parse a qualified symbol like `Class::method`, `Class.method`, or a C++
// constructor `Class::Class` into parent/last components. Returns null for
// bare names. Both `::` (C++/PHP) and `.` (Python) are treated as separators
// so callers don't need to know the source language.
function parseQualified(symbol) {
  const dotted = symbol.replace(/::/g, '.');
  const parts = dotted.split('.');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  return { dotted, parent, last, dottedSuffix: `%.${dotted}` };
}

export async function graphLookup({ repoRoot, symbol, limit = 5 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_lookup' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const typeList = SEARCH_TYPES.map(t => `'${t}'`).join(',');
  try {
    let hits = db.all(
      `SELECT file_path, start_line
       FROM nodes
       WHERE label = $label AND type IN (${typeList})
       ORDER BY confidence DESC, file_path ASC, start_line ASC
       LIMIT $limit`,
      { label: symbol, limit }
    );

    if (hits.length === 0) {
      const q = parseQualified(symbol);
      if (q) {
        // Fallback 1: qname match (stored as dotted path like "mem0.memory.main.Memory.add")
        hits = db.all(
          `SELECT file_path, start_line
           FROM nodes
           WHERE (
             json_extract(extra, '$.qname') = $qname
             OR json_extract(extra, '$.qname') LIKE $qnameSuffix
           )
             AND type IN (${typeList})
           ORDER BY confidence DESC, file_path ASC, start_line ASC
           LIMIT $limit`,
          { qname: q.dotted, qnameSuffix: q.dottedSuffix, limit }
        );

        // Fallback 2: parent_class match on the trailing segment. Handles
        // C++ ctor `A::A` (label=A, parent_class=A) and Python/PHP method
        // `A.method` (label=method, parent_class=A) when qname isn't populated.
        if (hits.length === 0) {
          hits = db.all(
            `SELECT file_path, start_line
             FROM nodes
             WHERE label = $last
               AND json_extract(extra, '$.parent_class') = $parent
               AND type IN (${typeList})
             ORDER BY confidence DESC, file_path ASC, start_line ASC
             LIMIT $limit`,
            { last: q.last, parent: q.parent, limit }
          );
        }
      }
    }

    if (hits.length === 0) {
      return `NO MATCH for "${symbol}".`;
    }

    return prefixReadWarnings(
      hits.map((hit) => formatLocation(hit.file_path, hit.start_line)).join('\n'),
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
