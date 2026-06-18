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
