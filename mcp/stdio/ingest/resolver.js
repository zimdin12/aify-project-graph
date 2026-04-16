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

function uniqueOrNull(matches = []) {
  return matches.length === 1 ? matches[0] : null;
}

function resolveTarget(ref, index) {
  if (index.byQname.has(ref.target)) {
    return index.byQname.get(ref.target);
  }

  const suffixMatch = uniqueOrNull(index.byQnameSuffix.get(ref.target) ?? []);
  if (suffixMatch) {
    return suffixMatch;
  }

  const labelMatch = uniqueOrNull(index.byLabel.get(ref.target) ?? []);
  if (labelMatch) {
    return labelMatch;
  }

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
