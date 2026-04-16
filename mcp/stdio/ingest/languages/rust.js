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
    { type: 'Class', nodeTypes: ['struct_item', 'enum_item', 'trait_item'], descendantTypes: ['type_identifier'] },
    {
      type: 'Class',
      nodeTypes: ['impl_item'],
      extractName: ({ node, source }) => {
        const typeNodes = node.namedChildren.filter((child) => child.type === 'type_identifier');
        const target = typeNodes[typeNodes.length - 1];
        return target ? source.slice(target.startIndex, target.endIndex) : '';
      },
    },
  ],
  refs: {
    imports: [{ nodeTypes: ['use_declaration'], descendantTypes: ['scoped_identifier', 'identifier'] }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function' }],
    references: [{ nodeTypes: ['identifier'] }],
  },
};
