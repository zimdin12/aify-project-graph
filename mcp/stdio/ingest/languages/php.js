import Php from 'tree-sitter-php';

// PHP's module identity is its `namespace` directive, not its file path. So
// `app/Models/User.php` with `namespace App\Models;` has module qname
// `App.Models.User` — matching what `use App\Models\User;` in another file
// normalizes to. Without this hook the path-based default gives lowercase
// `app.Models.User` and imports never resolve.
function moduleFromAst({ tree, source, filePath, defaultLabel }) {
  const root = tree.rootNode;
  const ns = root.namedChildren.find((c) => c.type === 'namespace_definition');
  if (!ns) return defaultLabel;
  const nameNode = ns.childForFieldName('name') || ns.namedChildren.find((c) => c.type === 'namespace_name');
  if (!nameNode) return defaultLabel;
  const namespace = source.slice(nameNode.startIndex, nameNode.endIndex).trim();
  if (!namespace) return defaultLabel;
  // Take the file's basename (without .php) as the final segment, matching
  // PHP's convention that class Foo lives in Foo.php under the namespace.
  const base = filePath.replace(/\\/g, '/').split('/').pop().replace(/\.php$/i, '');
  return `${namespace.replace(/\\/g, '.')}.${base}`;
}

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
  moduleFromAst,
  testDetector: ({ label, resolvedType }) =>
    ['Function', 'Method'].includes(resolvedType) && /^test/u.test(label),
  confidence: {
    node: 0.75,
    import: 0.75,
    call: 0.75,
  },
  symbols: [
    // class, trait, enum all define a named container with methods.
    // Keeping them as type: 'Class' avoids a schema change while still
    // routing methods into them as parentClass via the generic walker.
    {
      type: 'Class',
      nodeTypes: ['class_declaration', 'trait_declaration', 'enum_declaration', 'interface_declaration'],
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
    implements: [
      { nodeTypes: ['class_interface_clause'], descendantTypes: ['name'] },
      // `use SomeTrait;` inside a class body → treat as IMPLEMENTS (composition
      // of behavior). Scoped to declaration_list parent so we don't catch the
      // top-of-file `namespace use` imports.
      { nodeTypes: ['use_declaration'], parentTypes: ['declaration_list'], descendantTypes: ['name'] },
    ],
  },
};
