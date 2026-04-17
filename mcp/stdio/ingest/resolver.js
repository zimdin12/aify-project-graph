function parseExtra(node) {
  if (!node?.extra) return {};
  if (typeof node.extra === 'string') {
    try {
      return JSON.parse(node.extra);
    } catch {
      return {};
    }
  }
  return node.extra;
}

function normalizeNode(row) {
  if (!row) return null;
  return {
    ...row,
    extra: parseExtra(row),
  };
}

function normalizeRows(rows = []) {
  return rows.map(normalizeNode);
}

// Language-family groupings. Candidates in the same family are preferred over
// candidates in another family when resolving code-like relations (CALLS,
// EXTENDS, etc.). Keeps PHP `DB::table()` from resolving to a CSS `.table`
// selector, C++ method calls from resolving to a Python function of the same
// name, and so on.
const LANGUAGE_FAMILY = new Map([
  ['php', 'php'],
  ['laravel', 'php'],  // Laravel plugin emits routes as PHP
  ['javascript', 'js_ts'],
  ['typescript', 'js_ts'],
  ['c', 'c_cpp'],
  ['cpp', 'c_cpp'],
  ['glsl', 'glsl'],    // GLSL borrows from C but runs in a different address space
  ['css', 'css'],
  ['python', 'python'],
  ['rust', 'rust'],
  ['go', 'go'],
  ['ruby', 'ruby'],
  ['java', 'java'],
]);

function languageFamily(lang) {
  if (!lang) return 'unknown';
  return LANGUAGE_FAMILY.get(lang) ?? lang;
}

// Relations that must stay inside the same language family. A PHP CALLS
// ref should never resolve to a CSS node. Import-style relations (and the
// synthetic CONTAINS ownership emitted for out-of-class methods, where the
// owner is guaranteed same-language) are allowed to fall through to cross-
// family matches — that's how `#include "Engine.h"` can point at a File
// node whose language bucket doesn't match.
const HARD_GATED_RELATIONS = new Set([
  'CALLS', 'INVOKES', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE', 'TESTS', 'REFERENCES',
]);

function filterByLanguageFamily(matches, ref) {
  if (!matches || matches.length === 0) return matches;
  const refFamily = languageFamily(ref.extractor);
  if (refFamily === 'unknown') return matches;
  const sameFamily = matches.filter((m) => languageFamily(m.language) === refFamily);
  if (sameFamily.length > 0) return sameFamily;
  // No same-family candidates. If the relation is hard-gated, treat as
  // unresolved rather than crossing families.
  if (HARD_GATED_RELATIONS.has(ref.relation)) return [];
  return matches;
}

// Common names that should NOT match globally — too ambiguous
const COMMON_NAMES = new Set([
  'close', 'open', 'read', 'write', 'get', 'set', 'put', 'delete', 'update',
  'create', 'init', 'start', 'stop', 'run', 'main', 'test', 'log', 'print',
  'send', 'receive', 'connect', 'disconnect', 'load', 'save', 'parse', 'format',
  'json', 'str', 'int', 'len', 'map', 'filter', 'sort', 'find', 'index',
  'push', 'pop', 'append', 'remove', 'clear', 'reset', 'error', 'warn',
  'info', 'debug', 'toString', 'valueOf', 'hasOwnProperty', 'constructor',
  'raise_for_status', 'status_code', 'text', 'content', 'data', 'result',
  'request', 'response', 'handler', 'callback', 'resolve', 'reject',
  '__init__', '__str__', '__repr__', 'self', 'this', 'cls', 'super',
]);

function preferProximate(matches, sourceFile) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sameFile = matches.filter((m) => m.file_path === sourceFile);
  if (sameFile.length === 1) return sameFile[0];

  const sourceDir = sourceFile.includes('/') ? sourceFile.slice(0, sourceFile.lastIndexOf('/')) : '';
  if (sourceDir) {
    const sameDir = matches.filter((m) => m.file_path.startsWith(`${sourceDir}/`));
    if (sameDir.length === 1) return sameDir[0];
  }

  return null;
}

function lookupCandidates(target) {
  const stripped = target.replace(/^["'<]+|[>"']+$/g, '').trim();
  const candidates = new Set([target, stripped]);

  const dotted = stripped
    .replace(/\\/g, '.')
    .replace(/\//g, '.')
    .replace(/^\.+/u, '')
    .replace(/\.{2,}/g, '.');
  if (dotted) candidates.add(dotted);

  const basename = stripped.includes('/') ? stripped.split('/').pop() : null;
  if (basename) candidates.add(basename);

  const noExt = stripped.replace(/\.[^.]+$/, '');
  if (noExt && noExt !== stripped) candidates.add(noExt);

  return [...candidates].filter(Boolean);
}

function buildResolvers(db) {
  const findByExactQname = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE json_extract(extra, '$.qname') = ?
  `);

  const findByQnameSuffix = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE json_extract(extra, '$.qname') = ?
       OR json_extract(extra, '$.qname') LIKE ?
  `);

  const findByLabel = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE label = ?
  `);

  return {
    findByExactQname(candidate) {
      return normalizeRows(findByExactQname.all(candidate));
    },
    findByQnameSuffix(candidate) {
      return normalizeRows(findByQnameSuffix.all(candidate, `%.${candidate}`));
    },
    findByLabel(label) {
      return normalizeRows(findByLabel.all(label));
    },
  };
}

function resolveTarget(ref, resolvers) {
  for (const candidate of lookupCandidates(ref.target)) {
    const exactRaw = resolvers.findByExactQname(candidate);
    const exactMatch = preferProximate(filterByLanguageFamily(exactRaw, ref), ref.source_file);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (/[.\\/]/u.test(ref.target)) {
    for (const candidate of lookupCandidates(ref.target)) {
      const suffixRaw = resolvers.findByQnameSuffix(candidate);
      const suffixMatch = preferProximate(filterByLanguageFamily(suffixRaw, ref), ref.source_file);
      if (suffixMatch) return suffixMatch;
    }
  }

  const labelRaw = resolvers.findByLabel(ref.target);
  const labelMatches = filterByLanguageFamily(labelRaw, ref);
  if (COMMON_NAMES.has(ref.target)) {
    const sameFile = labelMatches.filter((m) => m.file_path === ref.source_file);
    if (sameFile.length === 1) return sameFile[0];
    return null;
  }

  return preferProximate(labelMatches, ref.source_file);
}

export function resolveRefs({ db, refs }) {
  const resolvers = buildResolvers(db);
  const edges = [];
  const unresolved = [];

  for (const ref of refs) {
    if (ref.from_target && ref.to_id) {
      const ownerNode = resolveTarget({
        target: ref.from_target,
        source_file: ref.source_file,
      }, resolvers);
      if (!ownerNode) {
        unresolved.push(ref);
        continue;
      }

      edges.push({
        from_id: ownerNode.id,
        to_id: ref.to_id,
        relation: ref.relation,
        source_file: ref.source_file,
        source_line: ref.source_line,
        confidence: ref.confidence,
        extractor: ref.extractor,
      });
      continue;
    }

    const targetNode = resolveTarget(ref, resolvers);
    if (!targetNode) {
      unresolved.push(ref);
      continue;
    }

    edges.push({
      from_id: ref.from_id,
      to_id: targetNode.id,
      relation: ref.relation,
      source_file: ref.source_file,
      source_line: ref.source_line,
      confidence: ref.confidence,
      extractor: ref.extractor,
    });
  }

  return { edges, unresolved };
}
