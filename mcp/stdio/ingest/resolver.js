import { createHash } from 'node:crypto';

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
  'CALLS', 'INVOKES', 'PASSES_THROUGH', 'EXTENDS', 'IMPLEMENTS', 'USES_TYPE', 'TESTS', 'REFERENCES',
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

const SYMBOLIC_CHAIN_RELATIONS = new Set(['PASSES_THROUGH', 'INVOKES']);
const INHERITED_MEMBER_RELATIONS = new Set(['CALLS', 'INVOKES', 'PASSES_THROUGH']);
const CLASSLIKE_TYPES = new Set(['Class', 'Interface', 'Type']);

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

function lookupCandidates(target, { dropExtension = true } = {}) {
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

  if (dropExtension) {
    const noExt = stripped.replace(/\.[^.]+$/, '');
    if (noExt && noExt !== stripped) candidates.add(noExt);
  }

  return [...candidates].filter(Boolean);
}

function pickSingleProximate(matches, sourceFile) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return preferProximate(matches, sourceFile);
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

  // Match by file_path suffix. For C++ `#include "core/Engine.h"` and
  // similar relative-include patterns, the raw target is a repo-relative
  // path fragment. The resolver needs to match that against nodes whose
  // file_path ends with the target — e.g. `core/Engine.h` should match
  // a File node at `engine/core/Engine.h`. Exact and LIKE '%/target' so
  // it won't match `engine/notcore/Engine.h` (would need a `/` boundary).
  const findByFilePathSuffix = db.raw.prepare(`
    SELECT *
    FROM nodes
    WHERE type IN ('File', 'Directory')
      AND (file_path = ? OR file_path LIKE ?)
  `);

  const findContainedMember = db.raw.prepare(`
    SELECT n.*
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.relation = 'CONTAINS'
      AND n.label = ?
      AND n.type IN ('Method', 'Function')
  `);

  const findExtendedParents = db.raw.prepare(`
    SELECT n.*
    FROM edges e
    JOIN nodes n ON n.id = e.to_id
    WHERE e.from_id = ?
      AND e.relation = 'EXTENDS'
      AND n.type IN ('Class', 'Interface', 'Type')
  `);

  const pendingNodes = [];
  const pendingByQname = new Map();
  const pendingByLabel = new Map();

  function registerPending(node) {
    const normalized = normalizeNode(node);
    pendingNodes.push(normalized);

    const qname = normalized.extra?.qname ?? '';
    if (qname) {
      const existing = pendingByQname.get(qname) ?? [];
      existing.push(normalized);
      pendingByQname.set(qname, existing);
    }

    const label = normalized.label ?? '';
    if (label) {
      const existing = pendingByLabel.get(label) ?? [];
      existing.push(normalized);
      pendingByLabel.set(label, existing);
    }
  }

  function mergeRows(dbRows = [], extraRows = []) {
    const out = [];
    const seen = new Set();
    for (const row of [...dbRows, ...extraRows]) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
    return out;
  }

  return {
    findByExactQname(candidate) {
      return mergeRows(
        normalizeRows(findByExactQname.all(candidate)),
        pendingByQname.get(candidate) ?? [],
      );
    },
    findByQnameSuffix(candidate) {
      const pending = pendingNodes.filter((node) => {
        const qname = node.extra?.qname ?? '';
        return qname === candidate || qname.endsWith(`.${candidate}`);
      });
      return mergeRows(
        normalizeRows(findByQnameSuffix.all(candidate, `%.${candidate}`)),
        pending,
      );
    },
    findByLabel(label) {
      return mergeRows(
        normalizeRows(findByLabel.all(label)),
        pendingByLabel.get(label) ?? [],
      );
    },
    findByFilePathSuffix(target) {
      // Mirror the pending-node case: nodes the ingest just added that
      // haven't been committed to SQLite yet.
      const pending = pendingNodes.filter((node) => {
        const fp = node.file_path ?? '';
        if (!fp) return false;
        if (node.type !== 'File' && node.type !== 'Directory') return false;
        return fp === target || fp.endsWith(`/${target}`);
      });
      return mergeRows(
        normalizeRows(findByFilePathSuffix.all(target, `%/${target}`)),
        pending,
      );
    },
    findContainedMember(ownerId, label) {
      return normalizeRows(findContainedMember.all(ownerId, label));
    },
    findExtendedParents(ownerId) {
      return normalizeRows(findExtendedParents.all(ownerId));
    },
    addNode(node) {
      registerPending(node);
    },
  };
}

function splitMemberTarget(target) {
  const normalized = normalizeExternalTarget(target);
  if (normalized.includes('/')) return null;
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === normalized.length - 1) return null;
  return {
    owner: normalized.slice(0, lastDot),
    member: normalized.slice(lastDot + 1),
  };
}

function resolveViaInheritance(ref, resolvers) {
  if (!INHERITED_MEMBER_RELATIONS.has(ref.relation)) return null;
  const memberTarget = splitMemberTarget(ref.target);
  if (!memberTarget) return null;

  const ownerCandidates = lookupCandidates(memberTarget.owner, { dropExtension: false }).flatMap((candidate) => [
    ...resolvers.findByExactQname(candidate),
    ...resolvers.findByQnameSuffix(candidate),
  ]);
  const ownerMatches = filterByLanguageFamily(
    ownerCandidates.filter((node) => CLASSLIKE_TYPES.has(node.type)),
    ref,
  );
  const owner = pickSingleProximate(ownerMatches, ref.source_file);
  if (!owner) return null;

  const visited = new Set();
  const queue = [owner];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current?.id || visited.has(current.id)) continue;
    visited.add(current.id);

    const inheritedMembers = filterByLanguageFamily(
      resolvers.findContainedMember(current.id, memberTarget.member),
      ref,
    );
    const member = pickSingleProximate(inheritedMembers, ref.source_file);
    if (member) return { node: member, provenance: 'INFERRED' };

    queue.push(...filterByLanguageFamily(resolvers.findExtendedParents(current.id), ref));
  }

  return null;
}

function pickProvenance(matches, fallback = 'EXTRACTED') {
  if (!matches || matches.length <= 1) return fallback;
  return 'AMBIGUOUS';
}

function resolveTarget(ref, resolvers) {
  const memberTarget = splitMemberTarget(ref.target);
  const targetCandidates = lookupCandidates(ref.target, {
    dropExtension: !(memberTarget && INHERITED_MEMBER_RELATIONS.has(ref.relation)),
  });

  for (const candidate of targetCandidates) {
    const exactRaw = resolvers.findByExactQname(candidate);
    const exactMatches = filterByLanguageFamily(exactRaw, ref);
    const exactMatch = preferProximate(exactMatches, ref.source_file);
    if (exactMatch) {
      return { node: exactMatch, provenance: pickProvenance(exactMatches, 'EXTRACTED') };
    }
  }

  if (/[.\\/]/u.test(ref.target)) {
    for (const candidate of targetCandidates) {
      const suffixRaw = resolvers.findByQnameSuffix(candidate);
      const suffixMatches = filterByLanguageFamily(suffixRaw, ref);
      const suffixMatch = preferProximate(suffixMatches, ref.source_file);
      if (suffixMatch) return { node: suffixMatch, provenance: pickProvenance(suffixMatches, 'INFERRED') };
    }
  }

  // File-path suffix matching for import-like refs whose target is a
  // path fragment (e.g. C++ `#include "core/Engine.h"`, Python relative
  // imports). The qname-suffix pass above doesn't match File nodes
  // because File qnames are normalized differently. Covers the biggest
  // unresolved bucket on echoes (63% of sampled refs).
  if (ref.relation === 'IMPORTS' && /[\\/]/u.test(ref.target)) {
    const filePathMatches = resolvers.findByFilePathSuffix(ref.target);
    const filePathMatch = preferProximate(filePathMatches, ref.source_file);
    if (filePathMatch) return { node: filePathMatch, provenance: pickProvenance(filePathMatches, 'INFERRED') };
  }

  const labelRaw = resolvers.findByLabel(ref.target);
  const labelMatches = filterByLanguageFamily(labelRaw, ref);
  if (COMMON_NAMES.has(ref.target)) {
    const sameFile = labelMatches.filter((m) => m.file_path === ref.source_file);
    if (sameFile.length === 1) return { node: sameFile[0], provenance: 'INFERRED' };
    return null;
  }

  const labelMatch = preferProximate(labelMatches, ref.source_file);
  if (labelMatch) return { node: labelMatch, provenance: pickProvenance(labelMatches, 'EXTRACTED') };

  return resolveViaInheritance(ref, resolvers);
}

function normalizeExternalTarget(target) {
  return String(target ?? '')
    .trim()
    .replace(/^["'<]+|[>"']+$/g, '');
}

// Decide whether an unresolved ref should be materialized as an External
// terminal node or left in dirtyEdges. Dev's rule (from design discussion):
//  - CALLS: always materialize. Terminal hop in trace output.
//  - PASSES_THROUGH: always materialize. Middleware / framework hops are part
//    of the execution story even when the implementation lives outside repo.
//  - USES_TYPE: always materialize. High-signal; DI targets, facade classes,
//    etc. are real dependencies even if the framework source is excluded.
//  - REFERENCES: materialize only when target is clearly type-like to avoid
//    flooding with bare-name noise. "Type-like" = has a namespace/class
//    separator (\, ., ::) or starts with an uppercase segment.
//  - Other relations: leave dirty.
// Also skips COMMON_NAMES (close/open/get/etc.) to prevent hundreds of
// External nodes all labeled "get".
function shouldMaterializeExternal(ref) {
  if (!ref.from_id || !ref.target) return false;
  const label = normalizeExternalTarget(ref.target);
  if (!label) return false;
  if (COMMON_NAMES.has(label)) return false;
  if (ref.relation === 'CALLS') return true;
  if (ref.relation === 'PASSES_THROUGH') return true;
  if (ref.relation === 'USES_TYPE') return true;
  if (ref.relation === 'REFERENCES') {
    if (/[\\.]|::/.test(label)) return true;
    const firstSeg = label.split(/[\\.::]/)[0] ?? '';
    if (firstSeg && firstSeg[0] >= 'A' && firstSeg[0] <= 'Z') return true;
    return false;
  }
  return false;
}

function createExternalNode(ref, rawTarget = ref.target) {
  const label = normalizeExternalTarget(rawTarget);
  const family = languageFamily(ref.extractor);
  const id = `external:${createHash('sha1').update(`${family}:${label}`).digest('hex').slice(0, 16)}`;
  return {
    id,
    type: 'External',
    label,
    file_path: '',
    start_line: 0,
    end_line: 0,
    language: family === 'unknown' ? '' : family,
    confidence: ref.confidence ?? 0.5,
    structural_fp: '',
    dependency_fp: '',
    extra: {
      external: true,
      sourceExtractor: ref.extractor ?? '',
      sourceRelation: ref.relation ?? '',
    },
  };
}

export function resolveRefs({ db, refs }) {
  const resolvers = buildResolvers(db);
  const nodes = [];
  const seenNodeIds = new Set();
  const edges = [];
  const unresolved = [];

  function resolveOwner(ref) {
    if (!ref.from_target) return null;
    return resolveTarget({
      target: ref.from_target,
      source_file: ref.source_file,
      relation: ref.relation,
      extractor: ref.extractor,
    }, resolvers);
  }

  function registerNode(node) {
    if (seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    nodes.push(node);
    resolvers.addNode(node);
  }

  for (const ref of refs) {
    const symbolicChain = Boolean(ref.from_target) && !ref.to_id;
    if (symbolicChain && !SYMBOLIC_CHAIN_RELATIONS.has(ref.relation)) {
      unresolved.push(ref);
      continue;
    }

    let fromId = ref.from_id;
    if (ref.from_target) {
      const ownerNode = resolveOwner(ref);
      if (!ownerNode) {
        if (!symbolicChain) {
          unresolved.push(ref);
          continue;
        }
        const sourceExternal = createExternalNode(ref, ref.from_target);
        registerNode(sourceExternal);
        fromId = sourceExternal.id;
      } else {
        fromId = ownerNode.node.id;
      }
    }

    if (ref.to_id) {
      edges.push({
        from_id: fromId,
        to_id: ref.to_id,
        relation: ref.relation,
        source_file: ref.source_file,
        source_line: ref.source_line,
        confidence: ref.confidence,
        provenance: ref.provenance ?? 'EXTRACTED',
        extractor: ref.extractor,
      });
      continue;
    }

    const targetNode = resolveTarget(ref, resolvers);
    if (!targetNode) {
      if (symbolicChain || shouldMaterializeExternal(ref)) {
        const externalNode = createExternalNode(ref);
        registerNode(externalNode);
        edges.push({
          from_id: fromId,
          to_id: externalNode.id,
          relation: ref.relation,
          source_file: ref.source_file,
          source_line: ref.source_line,
          confidence: ref.confidence,
          provenance: 'AMBIGUOUS',
          extractor: ref.extractor,
        });
        continue;
      }
      // Local-scope REFERENCES filter: bare lowercase single-token targets
      // whose label doesn't exist anywhere in the graph are almost certainly
      // local variables / parameters, not cross-scope references. They'd be
      // dropped from edges by the materialization guard above anyway — we
      // just also skip adding them to unresolved so they don't inflate the
      // trust=weak / unresolved-edges count with noise that will never be
      // fixable. Measured on lc-api: 425/500 unresolved refs were this
      // shape; on apg: 60/500. Dropping them honestly reports what's
      // actually actionable.
      if (
        ref.relation === 'REFERENCES'
        && /^[a-z][a-zA-Z0-9_]*$/.test(ref.target ?? '')
        && resolvers.findByLabel(ref.target).length === 0
      ) {
        continue;
      }
      unresolved.push(ref);
      continue;
    }

    edges.push({
      from_id: fromId,
      to_id: targetNode.node.id,
      relation: ref.relation,
      source_file: ref.source_file,
      source_line: ref.source_line,
      confidence: ref.confidence,
      provenance: ref.provenance ?? targetNode.provenance ?? 'EXTRACTED',
      extractor: ref.extractor,
    });
  }

  return { nodes, edges, unresolved };
}
