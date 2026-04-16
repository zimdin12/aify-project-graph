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

function loadNodes(db) {
  return db.all('SELECT * FROM nodes').map((node) => ({
    ...node,
    extra: parseExtra(node),
  }));
}

function buildIndex(nodes) {
  const byLabel = new Map();
  const byQname = new Map();
  const byQnameSuffix = new Map();

  for (const node of nodes) {
    const qname = node.extra?.qname ?? '';
    if (!byLabel.has(node.label)) byLabel.set(node.label, []);
    byLabel.get(node.label).push(node);

    if (qname) {
      byQname.set(qname, node);

      const parts = qname.split('.');
      for (let i = 0; i < parts.length; i += 1) {
        const suffix = parts.slice(i).join('.');
        if (!byQnameSuffix.has(suffix)) byQnameSuffix.set(suffix, []);
        byQnameSuffix.get(suffix).push(node);
      }
    }
  }

  return { byLabel, byQname, byQnameSuffix };
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

function uniqueOrNull(matches = []) {
  return matches.length === 1 ? matches[0] : null;
}

function preferProximate(matches, sourceFile) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Same file wins
  const sameFile = matches.filter(m => m.file_path === sourceFile);
  if (sameFile.length === 1) return sameFile[0];

  // Same directory wins
  const sourceDir = sourceFile.includes('/') ? sourceFile.slice(0, sourceFile.lastIndexOf('/')) : '';
  if (sourceDir) {
    const sameDir = matches.filter(m => m.file_path.startsWith(sourceDir + '/'));
    if (sameDir.length === 1) return sameDir[0];
  }

  // Too ambiguous — don't resolve
  return null;
}

function resolveTarget(ref, index) {
  // Exact qname always wins
  if (index.byQname.has(ref.target)) {
    return index.byQname.get(ref.target);
  }

  // Qname suffix match (e.g. "HomeController.index")
  if (/[.\\]/u.test(ref.target)) {
    const suffixMatches = index.byQnameSuffix.get(ref.target) ?? [];
    const suffixMatch = preferProximate(suffixMatches, ref.source_file);
    if (suffixMatch) return suffixMatch;
  }

  // Label match — but skip common names to avoid false global magnets
  const labelMatches = index.byLabel.get(ref.target) ?? [];
  if (COMMON_NAMES.has(ref.target)) {
    // For common names, ONLY resolve if same-file match
    const sameFile = labelMatches.filter(m => m.file_path === ref.source_file);
    if (sameFile.length === 1) return sameFile[0];
    return null;
  }

  // Non-common names: prefer proximate, fall back to unique global
  const proximate = preferProximate(labelMatches, ref.source_file);
  if (proximate) return proximate;

  return null;
}

export function resolveRefs({ db, refs }) {
  const nodes = loadNodes(db);
  const index = buildIndex(nodes);
  const edges = [];
  const unresolved = [];

  for (const ref of refs) {
    const targetNode = resolveTarget(ref, index);
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
