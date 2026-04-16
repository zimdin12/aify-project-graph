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
    imports: [{ nodeTypes: ['call'], descendantTypes: ['identifier'] }],
    calls: [{ nodeTypes: ['call', 'method_call'], descendantTypes: ['identifier'] }],
  },
};
