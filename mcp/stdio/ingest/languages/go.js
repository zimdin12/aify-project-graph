import Go from 'tree-sitter-go';

export default {
  language: 'go',
  parser: Go,
  extensions: ['.go'],
  confidence: {
    node: 0.9,
    import: 0.9,
    call: 0.9,
  },
  symbols: [
    { type: 'Function', nodeTypes: ['function_declaration', 'method_declaration'], field: 'name', signatureFields: ['parameters', 'result'] },
    { type: 'Type', nodeTypes: ['type_spec'], field: 'name' },
  ],
  refs: {
    imports: [{ nodeTypes: ['import_spec'], field: 'path' }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
  },
};
