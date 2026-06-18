import { posix } from 'node:path';
import TypeScript from 'tree-sitter-typescript';
import { extractDecoratorReferences } from '../extractors/decorators.js';
import { augmentJsImports } from '../js-import-evidence.js';
import { arrowFnSymbolInfo, markDefaultExport } from './_js_symbols.js';

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

function postExtractTypeScript({ tree, source, filePath, nodes, refs, fileNode }) {
  const decorators = extractDecoratorReferences({
    tree,
    source,
    filePath,
    nodes,
    language: 'typescript',
    ownerTypes: ['class_declaration', 'method_definition', 'public_field_definition'],
  });
  const extraImportRefs = augmentJsImports({ source, filePath, refs, extractor: 'typescript', fileNode });
  markDefaultExport({ tree, source, nodes });
  return { refs: [...(decorators?.refs ?? []), ...extraImportRefs] };
}

export default {
  language: 'typescript',
  parser: TypeScript.typescript,
  postExtract: postExtractTypeScript,
  extensions: ['.ts', '.tsx'],
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
    { type: 'Class', nodeTypes: ['class_declaration', 'abstract_class_declaration'], field: 'name' },
    { type: 'Function', nodeTypes: ['function_declaration', 'method_definition'], field: 'name', signatureFields: ['parameters'] },
    // Arrow / function-expression consts: `export const foo = () => {}` (audit W3 #4).
    { type: 'Function', nodeTypes: ['variable_declarator'], extractSymbolInfo: arrowFnSymbolInfo },
    { type: 'Type', nodeTypes: ['interface_declaration', 'type_alias_declaration', 'enum_declaration'], field: 'name' },
  ],
  refs: {
    imports: [{ nodeTypes: ['import_statement'], extractTargets: extractImportTargets }],
    // `new Foo()` is a call site too — capture the constructor so graph_callers
    // on a class surfaces its instantiation sites (audit W3, codegraph d0e6499).
    calls: [
      { nodeTypes: ['call_expression'], field: 'function' },
      { nodeTypes: ['new_expression'], field: 'constructor' },
    ],
    extends: [{ nodeTypes: ['extends_clause'], descendantTypes: ['identifier', 'type_identifier'] }],
    implements: [{ nodeTypes: ['implements_clause'], descendantTypes: ['identifier', 'type_identifier'] }],
    usesTypes: [{ nodeTypes: ['type_annotation'], descendantTypes: ['type_identifier'] }],
  },
};
