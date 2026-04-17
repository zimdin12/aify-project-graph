import TypeScript from 'tree-sitter-typescript';
import { extractDecoratorReferences } from '../extractors/decorators.js';

function normalizeImportSource(text) {
  return text.replace(/^\.\/+|^\.\.\/+/u, '').replace(/\//g, '.');
}

function extractImportTargets({ node, source }) {
  const importClause = node.namedChildren.find((child) => child.type === 'import_clause');
  const sourceNode = node.namedChildren.find((child) => child.type === 'string');
  const sourceFragment = sourceNode?.namedChildren.find((child) => child.type === 'string_fragment');
  const importSource = normalizeImportSource(source.slice(sourceFragment?.startIndex ?? 0, sourceFragment?.endIndex ?? 0));

  if (!importClause || !importSource) return [importSource].filter(Boolean);

  const namedImports = importClause.namedChildren.find((child) => child.type === 'named_imports');
  if (namedImports) {
    return namedImports.namedChildren
      .filter((child) => child.type === 'import_specifier')
      .map((specifier) => specifier.namedChildren[0])
      .filter(Boolean)
      .map((nameNode) => `${importSource}.${source.slice(nameNode.startIndex, nameNode.endIndex)}`);
  }

  return [importSource];
}

function postExtractJavaScript({ tree, source, filePath, nodes }) {
  return extractDecoratorReferences({
    tree,
    source,
    filePath,
    nodes,
    language: 'javascript',
    ownerTypes: ['class_declaration', 'method_definition', 'public_field_definition'],
  });
}

export default {
  language: 'javascript',
  parser: TypeScript.tsx,
  postExtract: postExtractJavaScript,
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  testDetector: ({ label, resolvedType, filePath }) =>
    ['Function', 'Method'].includes(resolvedType)
    && (/\.test\./u.test(filePath) || /\.spec\./u.test(filePath) || filePath.includes('/__tests__/'))
    && /^test/u.test(label),
  confidence: {
    node: 0.9,
    import: 0.9,
    call: 0.9,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_declaration'], field: 'name' },
    { type: 'Function', nodeTypes: ['function_declaration', 'method_definition'], field: 'name', signatureFields: ['parameters'] },
  ],
  refs: {
    imports: [{ nodeTypes: ['import_statement'], extractTargets: extractImportTargets }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
    extends: [{ nodeTypes: ['extends_clause'], descendantTypes: ['identifier', 'type_identifier'] }],
  },
};
