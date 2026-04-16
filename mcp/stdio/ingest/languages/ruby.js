import Ruby from 'tree-sitter-ruby';

export default {
  language: 'ruby',
  parser: Ruby,
  extensions: ['.rb'],
  confidence: {
    node: 0.9,
    import: 0.9,
    call: 0.9,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class'], field: 'name' },
    { type: 'Function', nodeTypes: ['method'], field: 'name', signatureFields: ['parameters'] },
  ],
  refs: {
    imports: [{
      nodeTypes: ['call'],
      extractTargets: ({ node, source }) => {
        const identifierNode = node.namedChildren.find((child) => child.type === 'identifier');
        const name = identifierNode
          ? source.slice(identifierNode.startIndex, identifierNode.endIndex)
          : '';
        if (!['require', 'require_relative'].includes(name)) return [];

        const stringNode = node.namedChildren.find((child) => child.type === 'argument_list')
          ?.namedChildren.find((child) => child.type === 'string')
          ?.namedChildren.find((child) => child.type === 'string_content');

        return stringNode ? [source.slice(stringNode.startIndex, stringNode.endIndex)] : [];
      },
    }],
    calls: [{ nodeTypes: ['call', 'method_call'], descendantTypes: ['identifier'] }],
  },
};
