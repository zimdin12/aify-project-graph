import Python from 'tree-sitter-python';

export default {
  language: 'python',
  parser: Python,
  extensions: ['.py'],
  testDetector: ({ label, resolvedType }) =>
    ['Function', 'Method'].includes(resolvedType) && label.startsWith('test_'),
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
      { nodeTypes: ['import_statement'], descendantTypes: ['dotted_name'] },
      {
        nodeTypes: ['import_from_statement'],
        descendantTypes: ['dotted_name', 'relative_import'],
        prefixFirst: true,
        separator: '.',
      },
    ],
    calls: [
      { nodeTypes: ['call'], field: 'function' },
    ],
    extends: [
      { nodeTypes: ['argument_list'], parentTypes: ['class_definition'], descendantTypes: ['identifier'] },
    ],
    usesTypes: [
      { nodeTypes: ['type'], parentTypes: ['typed_parameter'], descendantTypes: ['identifier'] },
      { nodeTypes: ['type'], parentTypes: ['function_definition'], descendantTypes: ['identifier'] },
    ],
  },
};
