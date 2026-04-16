import Java from 'tree-sitter-java';

export default {
  language: 'java',
  parser: Java,
  extensions: ['.java'],
  confidence: {
    node: 0.9,
    import: 0.9,
    call: 0.9,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_declaration', 'interface_declaration', 'enum_declaration'], field: 'name' },
    { type: 'Function', nodeTypes: ['method_declaration'], field: 'name', signatureFields: ['parameters'] },
  ],
  refs: {
    imports: [{ nodeTypes: ['import_declaration'], field: 'path' }],
    calls: [{ nodeTypes: ['method_invocation'], field: 'name' }],
  },
};
