import TypeScript from 'tree-sitter-typescript';

export default {
  language: 'javascript',
  parser: TypeScript.tsx,
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
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
    imports: [{ nodeTypes: ['import_statement'], field: 'source' }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
  },
};
