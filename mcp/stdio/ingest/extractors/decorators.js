function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

function unwrapDecoratorTarget(node) {
  if (!node) return null;
  if (node.type === 'call_expression') {
    return unwrapDecoratorTarget(node.childForFieldName('function'));
  }
  return node;
}

function decoratorTargetText(decoratorNode, source) {
  const targetNode = unwrapDecoratorTarget(decoratorNode.namedChildren[0] ?? null);
  return nodeText(targetNode, source).trim();
}

function smallestContainingSymbol(symbols, ownerNode) {
  let best = null;
  for (const symbol of symbols) {
    if (symbol.start_line > ownerNode.startPosition.row + 1 || symbol.end_line < ownerNode.endPosition.row + 1) {
      continue;
    }
    if (!best || (symbol.end_line - symbol.start_line) < (best.end_line - best.start_line)) {
      best = symbol;
    }
  }
  return best;
}

function findDecoratedOwner(decoratorNode, parentNode, ownerTypes) {
  if (parentNode && ownerTypes.has(parentNode.type)) return parentNode;
  const sibling = decoratorNode.nextNamedSibling;
  if (sibling && ownerTypes.has(sibling.type)) return sibling;
  return null;
}

export function extractDecoratorReferences({
  tree,
  source,
  filePath,
  nodes,
  language,
  ownerTypes,
}) {
  const refs = [];
  const inFileSymbols = nodes.filter((node) =>
    !['File', 'Module', 'External'].includes(node.type) && node.file_path === filePath,
  );
  const ownerTypeSet = new Set(ownerTypes);

  function walk(node, parentNode = null) {
    if (node.type === 'decorator') {
      const ownerNode = findDecoratedOwner(node, parentNode, ownerTypeSet);
      const ownerSymbol = ownerNode ? smallestContainingSymbol(inFileSymbols, ownerNode) : null;
      const target = decoratorTargetText(node, source);
      if (ownerSymbol && target) {
        refs.push({
          from_id: ownerSymbol.id,
          from_label: ownerSymbol.label,
          relation: 'REFERENCES',
          target,
          source_file: filePath,
          source_line: node.startPosition.row + 1,
          confidence: 0.75,
          extractor: language,
        });
      }
    }

    for (const child of node.namedChildren) {
      walk(child, node);
    }
  }

  walk(tree.rootNode);
  return { refs };
}
