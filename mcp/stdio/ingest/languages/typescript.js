import TypeScript from 'tree-sitter-typescript';

export default {
  language: 'typescript',
  parser: TypeScript.typescript,
  extensions: ['.ts', '.tsx'],
  confidence: {
    node: 0.9,
    import: 0.9,
    call: 0.9,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_declaration'], field: 'name' },
    { type: 'Function', nodeTypes: ['function_declaration', 'method_definition'], field: 'name', signatureFields: ['parameters'] },
    { type: 'Type', nodeTypes: ['interface_declaration', 'type_alias_declaration'], field: 'name' },
  ],
  refs: {
    imports: [{ nodeTypes: ['import_statement'], field: 'source' }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
  },
};
