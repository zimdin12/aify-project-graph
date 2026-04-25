import { posix } from 'node:path';
import TypeScript from 'tree-sitter-typescript';
import { extractDecoratorReferences } from '../extractors/decorators.js';

function normalizeImportSource(text, filePath) {
  const raw = text.trim();
  if (!raw) return '';
  if (raw.startsWith('.')) {
    const resolved = posix.normalize(posix.join(posix.dirname(filePath), raw));
    return resolved.replace(/^\.\//u, '');
  }
  return raw;
}

function extractImportTargets({ node, source, filePath }) {
  const importClause = node.namedChildren.find((child) => child.type === 'import_clause');
  const sourceNode = node.namedChildren.find((child) => child.type === 'string');
  const sourceFragment = sourceNode?.namedChildren.find((child) => child.type === 'string_fragment');
  const importSource = normalizeImportSource(
    source.slice(sourceFragment?.startIndex ?? 0, sourceFragment?.endIndex ?? 0),
    filePath,
  );

  if (!importSource) return [];
  // Always emit the source itself so file-level IMPORTS edges resolve. Named
  // imports get additional source.member targets for finer-grained matching
  // when a same-named symbol exists, but the source-only target is what
  // actually reaches the importee file node (resolver can't match compound
  // `path.member` labels otherwise).
  const targets = [importSource];
  if (!importClause) return targets;

  const namedImports = importClause.namedChildren.find((child) => child.type === 'named_imports');
  if (namedImports) {
    for (const nameNode of namedImports.namedChildren
      .filter((child) => child.type === 'import_specifier')
      .map((specifier) => specifier.namedChildren[0])
      .filter(Boolean)) {
      targets.push(`${importSource}.${source.slice(nameNode.startIndex, nameNode.endIndex)}`);
    }
  }
  return targets;
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
