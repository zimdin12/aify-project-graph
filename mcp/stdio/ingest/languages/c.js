import C from 'tree-sitter-c';

export default {
  language: 'c',
  parser: C,
  extensions: ['.c'],  // .h now handled by C++ config (most modern projects are C++)
  confidence: {
    node: 0.75,
    import: 0.75,
    call: 0.75,
  },
  symbols: [
    {
      type: 'Function',
      nodeTypes: ['function_definition'],
      descendantTypes: ['identifier'],
      signatureFields: ['declarator'],
      confidence: 0.75,
    },
  ],
  refs: {
    imports: [
      { nodeTypes: ['preproc_include'], field: 'path', confidence: 0.75 },
    ],
    calls: [
      { nodeTypes: ['call_expression'], field: 'function', confidence: 0.75 },
    ],
  },
};
