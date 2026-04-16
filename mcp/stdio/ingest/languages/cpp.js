import Cpp from 'tree-sitter-cpp';

export default {
  language: 'cpp',
  parser: Cpp,
  extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
  confidence: {
    node: 0.5,
    import: 0.5,
    call: 0.5,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_specifier', 'struct_specifier'], field: 'name' },
    { type: 'Function', nodeTypes: ['function_definition'], descendantTypes: ['identifier'], signatureFields: ['declarator'], confidence: 0.5 },
  ],
  refs: {
    imports: [{ nodeTypes: ['preproc_include'], field: 'path', confidence: 0.5 }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function', confidence: 0.5 }],
  },
};
