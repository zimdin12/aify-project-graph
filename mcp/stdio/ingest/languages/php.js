import Php from 'tree-sitter-php';

export default {
  language: 'php',
  parser: Php.php ?? Php,
  extensions: ['.php'],
  confidence: {
    node: 0.75,
    import: 0.75,
    call: 0.75,
  },
  symbols: [
    {
      type: 'Class',
      nodeTypes: ['class_declaration'],
      field: 'name',
    },
    {
      type: 'Function',
      nodeTypes: ['function_definition', 'method_declaration'],
      field: 'name',
      signatureFields: ['parameters'],
    },
  ],
  refs: {
    imports: [
      {
        nodeTypes: ['namespace_use_declaration'],
        descendantTypes: ['qualified_name'],
      },
    ],
    calls: [
      { nodeTypes: ['function_call_expression'], field: 'function' },
    ],
  },
};
