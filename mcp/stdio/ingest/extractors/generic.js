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

function buildImportTargets(node, source, rule, filePath) {
  const rawTargets = rule.extractTargets
    ? rule.extractTargets({ node, source, filePath })
    : extractTextsFromRule(node, source, rule);
  const normalized = rawTargets
    .map((target) => normalizeImportTarget(target))
    .filter(Boolean);

  if (rule.prefixFirst && normalized.length > 1) {
    const [prefix, ...rest] = normalized;
    return rest.map((target) => `${prefix}${rule.separator ?? '.'}${target}`);
  }

  return normalized;
}

function normalizeCallTarget(text) {
  const raw = text.trim();
  const stripped = raw.split(/\s+/u)[0];
  const parts = stripped.split(/::|->|\./u);
  return parts[parts.length - 1] ?? raw;
}

function normalizeReferenceTarget(text) {
  const raw = text.trim();
  const parts = raw.split(/::|->|\./u);
  return parts[parts.length - 1] ?? raw;
}

function extractTextsFromRule(node, source, rule) {
  if (!rule.field && !rule.descendantTypes?.length) {
    const text = nodeText(node, source);
    return text ? [text] : [];
  }

  if (rule.field) {
    const text = nodeText(node.childForFieldName(rule.field), source);
    return text ? [text] : [];
  }

  if (rule.descendantTypes?.length) {
    const matches = [];
    const queue = [...node.namedChildren];
    while (queue.length) {
      const current = queue.shift();
      if (rule.descendantTypes.includes(current.type)) {
        const text = nodeText(current, source);
        if (text) matches.push(text);
      }
      queue.push(...current.namedChildren);
    }
    return matches;
  }

  return [];
}

function extractTextFromRule(node, source, rule) {
  return extractTextsFromRule(node, source, rule)[0] ?? '';
}

function extractNameFromRule(node, source, rule) {
  if (typeof rule.extractName === 'function') {
    return rule.extractName({ node, source });
  }

  return extractTextFromRule(node, source, rule);
}

function extractSymbolInfo(node, source, rule) {
  if (typeof rule.extractSymbolInfo === 'function') {
    return rule.extractSymbolInfo({ node, source }) ?? null;
  }

  const name = extractNameFromRule(node, source, rule).trim();
  return name ? { name } : null;
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

function matchRule(node, rules = [], parent = null) {
  return rules.find((rule) =>
    rule.nodeTypes.includes(node.type)
    && (!rule.parentTypes?.length || (parent && rule.parentTypes.includes(parent.type)))
  );
}

function nodeWithin(candidate, container) {
  return Boolean(
    candidate
      && container
      && candidate.startIndex >= container.startIndex
      && candidate.endIndex <= container.endIndex
  );
}

function matchesAncestorField(node, ancestors, rules = [], source, fieldPredicate = () => true) {
  for (const ancestor of ancestors) {
    const rule = matchRule(ancestor, rules);
    if (!rule || !fieldPredicate(rule)) continue;

    if (rule.field) {
      const fieldNode = ancestor.childForFieldName(rule.field);
      if (nodeWithin(node, fieldNode)) {
        return true;
      }
    }

    if (rule.descendantTypes?.length) {
      const queue = [...ancestor.namedChildren];
      while (queue.length) {
        const current = queue.shift();
        if (rule.descendantTypes.includes(current.type) && nodeWithin(node, current)) {
          return true;
        }
        queue.push(...current.namedChildren);
      }
    }
  }

  return false;
}

function isInsideParameterList(ancestors) {
  const PARAMETER_TYPES = new Set([
    'parameters',
    'formal_parameters',
    'parameter_list',
    'typed_parameter',
    'simple_parameter',
    'required_parameter',
    'optional_parameter',
    'default_parameter',
    'variadic_parameter',
    'typed_default_parameter',
    'receiver',
  ]);

  return ancestors.some((ancestor) => PARAMETER_TYPES.has(ancestor.type));
}

function isInsideTypeAnnotation(ancestors) {
  const TYPE_ANNOTATION_TYPES = new Set([
    'type',
    'type_annotation',
    'predefined_type',
    'type_parameters',
    'generic_type',
  ]);

  return ancestors.some((ancestor) => TYPE_ANNOTATION_TYPES.has(ancestor.type));
}

function isReferenceCandidate({ node, owner, ancestors, config, source }) {
  if (!owner) return false;

  const target = normalizeReferenceTarget(nodeText(node, source));
  if (!target) return false;
  if (['self', 'this', 'cls', 'super', 'class'].includes(target)) return false;
  if (isInsideParameterList(ancestors)) return false;
  if (isInsideTypeAnnotation(ancestors)) return false;

  if (matchesAncestorField(
    node,
    ancestors,
    config.symbols,
    source,
    (rule) => Boolean(rule.field) || Boolean(rule.descendantTypes?.length),
  )) {
    return false;
  }

  if (matchesAncestorField(node, ancestors, config.refs?.imports ?? [], source, (rule) => Boolean(rule.field) || Boolean(rule.descendantTypes?.length))) {
    return false;
  }

  if (matchesAncestorField(node, ancestors, config.refs?.calls ?? [], source, (rule) => Boolean(rule.field))) {
    return false;
  }

  return true;
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

function pushUniqueEdge(edges, edge) {
  const exists = edges.some((candidate) =>
    candidate.relation === edge.relation
    && candidate.from_id === edge.from_id
    && candidate.to_id === edge.to_id
  );

  if (!exists) {
    edges.push(edge);
  }
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
    outgoing: {
      calls: deps.calls,
      references: deps.references,
      usesTypes: deps.usesTypes,
      imports: deps.imports,
    },
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
  const pathBasedLabel = moduleNameForPath(filePath);
  // Language configs may override the module identity (e.g. PHP derives it
  // from the `namespace` directive so imports like `use App\Models\User`
  // actually resolve to the right module).
  const moduleLabel = typeof config.moduleFromAst === 'function'
    ? (config.moduleFromAst({ tree, source, filePath, defaultLabel: pathBasedLabel }) || pathBasedLabel)
    : pathBasedLabel;
  const fileLabel = basename(filePath);
  const symbolDeps = new Map();
  const symbolsById = new Map();

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
  pushUniqueEdge(edges, {
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

  const MAX_VISIT_DEPTH = 80;
  const referenceRules = config.refs?.references ?? [
    { nodeTypes: ['identifier', 'type_identifier', 'name'] },
  ];

  const visit = (node, owner = null, parentClass = null, depth = 0, ancestors = []) => {
    if (depth > MAX_VISIT_DEPTH) return;
    const parentNode = ancestors[ancestors.length - 1] ?? null;
    const symbolRule = matchRule(node, config.symbols, parentNode);
    let nextOwner = owner;
    let nextParentClass = parentClass;

    if (symbolRule) {
      const symbolInfo = extractSymbolInfo(node, source, symbolRule);
      const name = symbolInfo?.name?.trim() ?? '';
      if (name) {
        const parentClassLabel = symbolInfo?.parentClass ?? parentClass?.label ?? '';
        const parentClassQname = symbolInfo?.parentClassQname ?? parentClass?.extra?.qname ?? parentClassLabel;
        const syntheticOwnerTarget = symbolInfo?.parentClass ?? '';
        const explicitType = symbolInfo?.type ?? symbolRule.type;
        const resolvedType = explicitType === 'Function' && parentClassLabel ? 'Method' : explicitType;
        const detectedType = config.testDetector?.({
          label: name,
          filePath,
          node,
          resolvedType,
          parentClass: parentClassLabel,
        }) ? 'Test' : resolvedType;
        const qname = parentClassQname
          ? `${parentClassQname}.${name}`
          : `${moduleLabel}.${name}`;
        const signature = buildSignature(node, source, symbolRule);
        const createdNode = makeBaseNode({
          type: detectedType,
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
            parent_class: parentClassLabel,
          },
        });

        const existingNode = symbolsById.get(createdNode.id);
        const activeNode = existingNode ?? createdNode;
        if (!existingNode) {
          nodes.push(createdNode);
          symbolsById.set(createdNode.id, createdNode);
          symbolDeps.set(createdNode.id, {
            calls: [],
            references: [],
            usesTypes: [],
            imports: [],
          });
        }

        const parentNode = parentClass ?? fileNode;
        pushUniqueEdge(edges, {
          relation: parentClass ? 'CONTAINS' : 'DEFINES',
          from_id: parentNode.id,
          to_id: activeNode.id,
          from_label: parentNode.label,
          to_label: activeNode.label,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });

        if (!parentClass && syntheticOwnerTarget && detectedType === 'Method') {
          refs.push({
            from_target: syntheticOwnerTarget,
            to_id: activeNode.id,
            relation: 'CONTAINS',
            source_file: filePath,
            source_line: lineNumber(node),
            confidence: symbolRule.confidence ?? config.confidence?.node ?? 1.0,
            provenance: 'EXTRACTED',
            extractor: config.language,
          });
        }

        nextOwner = activeNode;
        nextParentClass = resolvedType === 'Class' ? activeNode : parentClass;
      }
    }

    const importRule = matchRule(node, config.refs?.imports, parentNode);
    if (importRule) {
      for (const target of buildImportTargets(node, source, importRule, filePath)) {
        refs.push({
          from_id: fileNode.id,
          from_label: fileNode.label,
          relation: 'IMPORTS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: importRule.confidence ?? config.confidence?.import ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
      }
    }

    const callRule = matchRule(node, config.refs?.calls, parentNode);
    if (callRule && nextOwner) {
      const target = normalizeCallTarget(extractTextFromRule(node, source, callRule));
      if (target) {
        const baseRef = {
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: callRule.confidence ?? config.confidence?.call ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        };

        refs.push({
          ...baseRef,
          relation: 'CALLS',
        });

        if (nextOwner.type === 'Test') {
          refs.push({
            ...baseRef,
            relation: 'TESTS',
          });
        }
        symbolDeps.get(nextOwner.id)?.calls.push(target);
      }
    }

    const referenceRule = matchRule(node, referenceRules, parentNode);
    if (referenceRule && isReferenceCandidate({ node, owner: nextOwner, ancestors, config, source })) {
      const target = normalizeReferenceTarget(extractTextFromRule(node, source, referenceRule));
      if (target) {
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'REFERENCES',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: referenceRule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.extends ?? []) {
      if (!nextOwner || nextOwner.type !== 'Class') continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'EXTENDS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.implements ?? []) {
      if (!nextOwner || nextOwner.type !== 'Class') continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'IMPLEMENTS',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.references.push(target);
      }
    }

    for (const rule of config.refs?.usesTypes ?? []) {
      if (!nextOwner) continue;
      if (!matchRule(node, [rule], parentNode)) continue;

      for (const targetText of extractTextsFromRule(node, source, rule)) {
        const target = normalizeReferenceTarget(targetText);
        if (!target) continue;
        refs.push({
          from_id: nextOwner.id,
          from_label: nextOwner.label,
          relation: 'USES_TYPE',
          target,
          source_file: filePath,
          source_line: lineNumber(node),
          confidence: rule.confidence ?? config.confidence?.reference ?? config.confidence?.node ?? 1.0,
          provenance: 'EXTRACTED',
          extractor: config.language,
        });
        symbolDeps.get(nextOwner.id)?.usesTypes.push(target);
      }
    }

    for (const child of node.namedChildren) {
      visit(child, nextOwner, nextParentClass, depth + 1, [...ancestors, node]);
    }
  };

  visit(tree.rootNode, null, null, 0, []);

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

  // Language configs may append more refs/edges after the main walker. Used
  // for framework-specific patterns (e.g. PHP detects app(Foo::class),
  // facades, constructor injection) that don't fit the per-node rule shape.
  if (typeof config.postExtract === 'function') {
    const extra = config.postExtract({
      tree, source, filePath, nodes, edges, refs, fileNode, moduleNode, symbolsById,
    });
    if (extra?.refs) refs.push(...extra.refs);
    if (extra?.edges) edges.push(...extra.edges);
  }

  return { nodes, edges, refs };
}
