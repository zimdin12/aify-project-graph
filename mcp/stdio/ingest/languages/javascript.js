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

function postExtractJavaScript({ tree, source, filePath, nodes, refs, fileNode }) {
  const decorators = extractDecoratorReferences({
    tree,
    source,
    filePath,
    nodes,
    language: 'javascript',
    ownerTypes: ['class_declaration', 'method_definition', 'public_field_definition'],
  });
  // P3-1 (require() CJS coverage) + P3-2 (import-evidence map). Mutates the
  // existing CALLS/REFERENCES refs in place to attach the per-file import map,
  // and returns extra IMPORTS refs for require() specifiers tree-sitter misses.
  const extraImportRefs = augmentJsImports({ source, filePath, refs, extractor: 'javascript', fileNode });
  markDefaultExport({ tree, source, nodes });
  return { refs: [...(decorators?.refs ?? []), ...extraImportRefs] };
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
    // Arrow / function-expression consts AND class fields: `const foo = () => {}`,
    // `handleSubmit = () => {}` (a class field → becomes a Method of its class).
    // classify-by-value: only fields whose VALUE is an arrow/fn expr (audit W3 #4
    // + borrow codegraph 38eb4e6 — a data field must NOT become a method).
    { type: 'Function', nodeTypes: ['variable_declarator', 'public_field_definition', 'field_definition'], extractSymbolInfo: arrowFnSymbolInfo },
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
  },
};
