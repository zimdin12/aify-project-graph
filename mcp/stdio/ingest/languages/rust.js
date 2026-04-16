import Rust from 'tree-sitter-rust';

export default {
  language: 'rust',
  parser: Rust,
  extensions: ['.rs'],
  confidence: {
    node: 0.75,
    import: 0.75,
    call: 0.75,
  },
  symbols: [
    { type: 'Function', nodeTypes: ['function_item'], field: 'name', signatureFields: ['parameters'] },
    { type: 'Class', nodeTypes: ['struct_item', 'enum_item', 'trait_item', 'impl_item'], field: 'name' },
  ],
  refs: {
    imports: [{ nodeTypes: ['use_declaration'], descendantTypes: ['scoped_identifier', 'identifier'] }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
  },
};
