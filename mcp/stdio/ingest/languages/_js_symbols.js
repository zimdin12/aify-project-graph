// Shared JS/TS symbol-extraction helpers.
//
// Audit 2026-06-12 W3 (ingest #4): `const foo = () => {}` / `export const bar =
// function () {}` — the dominant modern function style — produced NO symbol node
// (extraction only covered function_declaration + method_definition), so every
// call to such a function fell straight into the short-name unresolved backlog.
// Emit a Function symbol for a variable_declarator whose value is an arrow or
// function expression. Plain data consts (`const x = 5`, `const c = cfg()`)
// return null → no symbol, so we don't pollute the graph with non-functions.

const FN_VALUE_TYPES = new Set([
  'arrow_function', 'function_expression', 'function', 'generator_function',
]);
// Only simple identifier bindings — skip destructuring patterns
// (`const { a } = …`, `const [x] = …`) which have no single symbol name.
const NAME_TYPES = new Set(['identifier', 'property_identifier']);

export function arrowFnSymbolInfo({ node, source }) {
  const value = node.childForFieldName('value');
  if (!value || !FN_VALUE_TYPES.has(value.type)) return null;
  const nameNode = node.childForFieldName('name');
  if (!nameNode || !NAME_TYPES.has(nameNode.type)) return null;
  const name = source.slice(nameNode.startIndex, nameNode.endIndex).trim();
  return name ? { name, type: 'Function' } : null;
}

const DEFAULT_DECL_TYPES = new Set([
  'class_declaration', 'abstract_class_declaration',
  'function_declaration', 'generator_function_declaration',
]);

// The NAME of a file's `export default …`, or null (anonymous / not found).
//   export default class Foo {}   → 'Foo'
//   export default function foo(){} → 'foo'
//   export default Foo            → 'Foo'  (identifier referring to a decl)
//   export default () => {}       → null   (anonymous; nothing to bind a name to)
function defaultExportName(exportNode, source) {
  for (const child of exportNode.namedChildren) {
    if (DEFAULT_DECL_TYPES.has(child.type)) {
      const nameNode = child.childForFieldName('name');
      if (nameNode) return source.slice(nameNode.startIndex, nameNode.endIndex);
    }
    if (child.type === 'identifier') {
      return source.slice(child.startIndex, child.endIndex);
    }
  }
  return null;
}

// Audit 2026-06-12 W3 (graphify 6dc23db): mark the symbol a file `export default`s
// so the resolver can bind a RENAMED default import (`import Bar from './foo'`,
// where the class is Foo) to it. Default-import resolution otherwise matched the
// local name and bailed. Mutates the matching node's `extra.isDefaultExport`.
export function markDefaultExport({ tree, source, nodes }) {
  if (!tree?.rootNode || !Array.isArray(nodes) || nodes.length === 0) return;
  let name = null;
  const stack = [tree.rootNode];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === 'export_statement' && n.children.some((c) => c.type === 'default')) {
      name = defaultExportName(n, source);
      if (name) break;
    }
    for (const c of n.namedChildren) stack.push(c);
  }
  if (!name) return;
  const match = nodes.find((nd) => nd.label === name && ['Class', 'Function', 'Type'].includes(nd.type));
  if (match) {
    match.extra = match.extra || {};
    match.extra.isDefaultExport = true;
  }
}
