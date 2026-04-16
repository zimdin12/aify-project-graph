import Python from 'tree-sitter-python';

export default {
  language: 'python',
  parser: Python,
  extensions: ['.py'],
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
      { nodeTypes: ['import_statement'], field: 'name' },
      { nodeTypes: ['import_from_statement'], field: 'module_name' },
    ],
    calls: [
      { nodeTypes: ['call'], field: 'function' },
    ],
  },
};
