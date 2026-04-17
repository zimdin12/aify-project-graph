import Python from 'tree-sitter-python';

function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

// Decorators carry real dependency information in Python (framework routing,
// pytest fixtures, SQLAlchemy mappers, Flask/FastAPI route registration,
// property/staticmethod/classmethod idioms). The generic walker extracts
// them as identifiers which become noisy REFERENCES at best; this
// postExtract adds a focused edge from the decorated function/class to the
// decorator's root callable. `@property`, `@staticmethod`, `@classmethod`
// and `@pytest.fixture` style all produce useful REFERENCES to the
// decorator identity (`property`, `staticmethod`, `pytest.fixture`).
function postExtractPython({ tree, source, filePath, nodes }) {
  const refs = [];
  const inFileSymbols = nodes.filter((n) =>
    ['Function', 'Method', 'Class', 'Test'].includes(n.type) && n.file_path === filePath,
  );

  function symbolAtLine(line) {
    let best = null;
    for (const s of inFileSymbols) {
      if (s.start_line <= line && line <= s.end_line) {
        if (!best || (s.end_line - s.start_line) < (best.end_line - best.start_line)) {
          best = s;
        }
      }
    }
    return best;
  }

  function decoratorRootName(decoratorNode) {
    // decorator's named children can be identifier | attribute | call (with attribute inside)
    for (const child of decoratorNode.namedChildren) {
      if (child.type === 'identifier') return nodeText(child, source);
      if (child.type === 'attribute') return nodeText(child, source);
      if (child.type === 'call') {
        const fn = child.childForFieldName('function');
        if (fn) return nodeText(fn, source);
      }
    }
    return '';
  }

  function walk(node) {
    if (node.type === 'decorated_definition') {
      const inner = node.childForFieldName('definition');
      if (inner) {
        const innerLine = inner.startPosition.row + 1;
        const owner = symbolAtLine(innerLine);
        if (owner) {
          for (const c of node.namedChildren) {
            if (c.type !== 'decorator') continue;
            const name = decoratorRootName(c);
            if (!name) continue;
            refs.push({
              from_id: owner.id,
              from_label: owner.label,
              relation: 'REFERENCES',
              target: name,
              source_file: filePath,
              source_line: c.startPosition.row + 1,
              confidence: 0.75,
              extractor: 'python',
            });
          }
        }
      }
    }
    for (const c of node.namedChildren) walk(c);
  }

  walk(tree.rootNode);
  return { refs };
}

export default {
  language: 'python',
  parser: Python,
  postExtract: postExtractPython,
  extensions: ['.py'],
  testDetector: ({ label, resolvedType }) =>
    ['Function', 'Method'].includes(resolvedType) && label.startsWith('test_'),
  confidence: {
    node: 0.95,
    import: 0.95,
    call: 0.95,
  },
  symbols: [
    {
      type: 'Class',
      nodeTypes: ['class_definition'],
      field: 'name',
    },
    {
      type: 'Function',
      nodeTypes: ['function_definition'],
      field: 'name',
      signatureFields: ['parameters'],
    },
  ],
  refs: {
    imports: [
      { nodeTypes: ['import_statement'], descendantTypes: ['dotted_name'] },
      {
        nodeTypes: ['import_from_statement'],
        descendantTypes: ['dotted_name', 'relative_import'],
        prefixFirst: true,
        separator: '.',
      },
    ],
    calls: [
      { nodeTypes: ['call'], field: 'function' },
    ],
    extends: [
      { nodeTypes: ['argument_list'], parentTypes: ['class_definition'], descendantTypes: ['identifier'] },
    ],
    usesTypes: [
      { nodeTypes: ['type'], parentTypes: ['typed_parameter'], descendantTypes: ['identifier'] },
      { nodeTypes: ['type'], parentTypes: ['function_definition'], descendantTypes: ['identifier'] },
    ],
  },
};
