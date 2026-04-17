import Php from 'tree-sitter-php';

function extractImportTargets({ node, source }) {
  const clause = node.namedChildren.find((child) => child.type === 'namespace_use_clause');
  if (clause) {
    return [source.slice(clause.startIndex, clause.endIndex)];
  }

  const baseNode = node.namedChildren.find((child) => child.type === 'namespace_name');
  const groupNode = node.namedChildren.find((child) => child.type === 'namespace_use_group');
  if (!baseNode || !groupNode) return [];

  const base = source.slice(baseNode.startIndex, baseNode.endIndex);
  return groupNode.namedChildren
    .filter((child) => child.type === 'namespace_use_clause')
    .map((child) => `${base}\\${source.slice(child.startIndex, child.endIndex)}`);
}

export default {
  language: 'php',
  parser: Php.php ?? Php,
  extensions: ['.php'],
  testDetector: ({ label, resolvedType }) =>
    ['Function', 'Method'].includes(resolvedType) && /^test/u.test(label),
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
        extractTargets: extractImportTargets,
      },
    ],
    calls: [
      { nodeTypes: ['function_call_expression'], field: 'function' },
      // Method call on an object: $obj->method(), $this->service->doThing()
      { nodeTypes: ['member_call_expression'], field: 'name' },
      // Static method / class constant call: Class::method(), Facade::get()
      { nodeTypes: ['scoped_call_expression'], field: 'name' },
      // Nullsafe method call (PHP 8+): $obj?->method()
      { nodeTypes: ['nullsafe_member_call_expression'], field: 'name' },
    ],
    extends: [{ nodeTypes: ['base_clause'], descendantTypes: ['name'] }],
    implements: [{ nodeTypes: ['class_interface_clause'], descendantTypes: ['name'] }],
  },
};
