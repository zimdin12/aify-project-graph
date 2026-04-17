import Cpp from 'tree-sitter-cpp';

function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

function extractCppFunctionSymbol({ node, source }) {
  const declarator = node.childForFieldName('declarator');
  const declaratorText = nodeText(declarator, source);
  const qualifiedMatch = declaratorText.match(/(?:^|[\s*&])((?:[A-Za-z_][\w]*::)+)(~?[A-Za-z_]\w*)\s*\(/u);
  if (qualifiedMatch) {
    const scopeChain = qualifiedMatch[1].replace(/::$/u, '').split('::').filter(Boolean);
    const parentClass = scopeChain.at(-1) ?? '';
    return {
      name: qualifiedMatch[2],
      parentClass,
      parentClassQname: parentClass,
      type: 'Method',
    };
  }

  const nameMatch = declaratorText.match(/(~?[A-Za-z_]\w*)\s*\(/u);
  if (!nameMatch) return null;
  return { name: nameMatch[1] };
}

export default {
  language: 'cpp',
  parser: Cpp,
  extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.h'],
  confidence: {
    node: 0.6,
    import: 0.6,
    call: 0.6,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_specifier', 'struct_specifier'], field: 'name', confidence: 0.7 },
    {
      type: 'Function',
      nodeTypes: ['function_definition'],
      extractSymbolInfo: extractCppFunctionSymbol,
      signatureFields: ['declarator'],
      confidence: 0.6,
    },
    { type: 'Method', nodeTypes: ['function_definition'], parentTypes: ['class_specifier', 'struct_specifier', 'field_declaration_list'], descendantTypes: ['identifier'], confidence: 0.6 },
    { type: 'Type', nodeTypes: ['enum_specifier', 'type_alias_declaration'], field: 'name', confidence: 0.7 },
    { type: 'Module', nodeTypes: ['namespace_definition'], field: 'name', confidence: 0.7 },
  ],
  refs: {
    imports: [{ nodeTypes: ['preproc_include'], field: 'path', confidence: 0.6 }],
    calls: [{ nodeTypes: ['call_expression'], field: 'function', confidence: 0.6 }],
    extends: [{ nodeTypes: ['base_class_clause'], descendantTypes: ['type_identifier'], confidence: 0.6 }],
    references: [],
  },
};
