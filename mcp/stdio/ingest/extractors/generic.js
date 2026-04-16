import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { nodeText, parseSource } from '../walker.js';

function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

function lineNumber(node) {
  return node ? node.startPosition.row + 1 : 0;
}

function endLineNumber(node) {
  return node ? node.endPosition.row + 1 : 0;
}

function moduleNameForPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const withoutExt = normalized.slice(0, normalized.length - extname(normalized).length);
  return withoutExt
    .replace(/\/__(init|main)$/u, '')
    .replace(/\/index$/u, '')
    .replace(/\//g, '.');
}

function normalizeImportTarget(text) {
  return text.trim().replace(/^["'<]+|[>"']+$/g, '');
}

function normalizeCallTarget(text) {
  const raw = text.trim();
  const stripped = raw.split(/\s+/u)[0];
  const parts = stripped.split(/::|->|\./u);
  return parts[parts.length - 1] ?? raw;
}

function extractTextFromRule(node, source, rule) {
  if (rule.field) {
    return nodeText(node.childForFieldName(rule.field), source);
  }

  if (rule.descendantTypes?.length) {
    const queue = [...node.namedChildren];
    while (queue.length) {
      const current = queue.shift();
      if (rule.descendantTypes.includes(current.type)) {
        return nodeText(current, source);
      }
      queue.push(...current.namedChildren);
    }
  }

  return '';
}

function buildSignature(node, source, rule) {
  const parts = [];
  if (rule.signatureFields?.length) {
    for (const field of rule.signatureFields) {
      const text = nodeText(node.childForFieldName(field), source).trim();
      if (text) parts.push(text);
    }
  }
  return parts.join(' ').trim();
}

function matchRule(node, rules = []) {
  return rules.find((rule) => rule.nodeTypes.includes(node.type));
}

function makeBaseNode({
  type,
  label,
  filePath,
  startLine,
  endLine,
  language,
  confidence,
  extra,
}) {
  const qname = extra.qname ?? `${language}:${filePath}:${label}`;
  return {
    id: stableId([type, filePath, qname]),
    type,
    label,
    file_path: filePath,
    start_line: startLine,
    end_line: endLine,
    language,
    confidence,
    structural_fp: '',
    dependency_fp: '',
    extra,
  };
}

function finalizeFingerprints(node, deps) {
  const structuralInput = {
    qname: node.extra.qname,
    signature: node.extra.signature ?? '',
    decorators: node.extra.decorators ?? [],
    parentClass: node.extra.parent_class ?? '',
    nodeType: node.type,
  };

  const dependencyInput = {
    calls: deps.calls,
    references: deps.references,
    usesTypes: deps.usesTypes,
    imports: deps.imports,
  };

  node.structural_fp = structuralFingerprint(structuralInput);
  node.dependency_fp = dependencyFingerprint(dependencyInput);
}

export function extractFile({ filePath, source, config }) {
  const tree = parseSource({ source, config });
  const nodes = [];
  const edges = [];
  const refs = [];
  const lineCount = source.length === 0 ? 0 : source.split('\n').length;
  const moduleLabel = moduleNameForPath(filePath);
  const fileLabel = basename(filePath);
  const symbolDeps = new Map();

  const fileNode = makeBaseNode({
    type: 'File',
    label: fileLabel,
    filePath,
    startLine: lineCount > 0 ? 1 : 0,
    endLine: lineCount,
    language: config.language,
    confidence: config.confidence?.node ?? 1.0,
    extra: { qname: filePath.replace(/\\/g, '/'), signature: '', decorators: [] },
  });

  const moduleNode = makeBaseNode({
    type: 'Module',
    label: moduleLabel,
    filePath,
    startLine: 1,
    endLine: lineCount,
    language: config.language,
    confidence: config.confidence?.node ?? 1.0,
    extra: { qname: moduleLabel, signature: '', decorators: [] },
  });

  nodes.push(fileNode, moduleNode);
  edges.push({
    relation: 'CONTAINS',
    from_id: moduleNode.id,
    to_id: fileNode.id,
    from_label: moduleNode.label,
    to_label: fileNode.label,
    source_file: filePath,
    source_line: 1,
    confidence: config.confidence?.node ?? 1.0,
    extractor: config.language,
  });

  const visit = (node, owner = null, parentClass = null) => {
    const symbolRule = matchRule(node, config.symbols);
    let nextOwner = owner;
    let nextParentClass = parentClass;

    if (symbolRule) {
      const name = extractTextFromRule(node, source, symbolRule).trim();
      if (name) {
        const explicitType = symbolRule.type;
        const resolvedType = explicitType === 'Function' && parentClass ? 'Method' : explicitType;
        const qname = parentClass
          ? `${parentClass.extra.qname}.${name}`
          : `${moduleLabel}.${name}`;
        const signature = buildSignature(node, source, symbolRule);
        const createdNode = makeBaseNode({
          type: resolvedType,
          label: name,
          filePath,
          startLine: lineNumber(node),
          endLine: endLineNumber(node),
          language: config.language,
          confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
          extra: {
            qname,
            signature,
            decorators: [],
            parent_class: parentClass?.label ?? '',
          },
        });

        nodes.push(createdNode);
        symbolDeps.set(createdNode.id, {
          calls: [],
          references: [],
          usesTypes: [],
          imports: [],
        });

        const parentNode = parentClass ?? fileNode;
        edges.push({
          relation: parentClass ? 'CONTAINS' : 'DEFINES',
          from_id: parentNode.id,
          to_id: createdNode.id,
          from_label: parentNode.label,
          to_label: createdNode.label,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
          extractor: config.language,
        });

        nextOwner = createdNode;
        nextParentClass = resolvedType === 'Class' ? createdNode : parentClass;
      }
    }

    const importRule = matchRule(node, config.refs?.imports);
    if (importRule) {
      const target = normalizeImportTarget(extractTextFromRule(node, source, importRule));
      if (target) {
        refs.push({
          from_id: fileNode.id,
          from_label: fileNode.label,
          relation: 'IMPORTS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: importRule.confidence ?? config.confidence?.import ?? config.confidence?.node ?? 1.0,
          extractor: config.language,
        });
      }
    }

    const callRule = matchRule(node, config.refs?.calls);
    if (callRule && nextOwner) {
      const target = normalizeCallTarget(extractTextFromRule(node, source, callRule));
      if (target) {
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'CALLS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: callRule.confidence ?? config.confidence?.call ?? config.confidence?.node ?? 1.0,
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.calls.push(target);
      }
    }

    for (const child of node.namedChildren) {
      visit(child, nextOwner, nextParentClass);
    }
  };

  visit(tree.rootNode, null, null);

  finalizeFingerprints(fileNode, {
    calls: [],
    references: [],
    usesTypes: [],
    imports: refs.filter((ref) => ref.relation === 'IMPORTS').map((ref) => ref.target),
  });
  finalizeFingerprints(moduleNode, {
    calls: [],
    references: [],
    usesTypes: [],
    imports: [],
  });

  for (const node of nodes) {
    if (!symbolDeps.has(node.id)) continue;
    finalizeFingerprints(node, symbolDeps.get(node.id));
  }

  return { nodes, edges, refs };
}
