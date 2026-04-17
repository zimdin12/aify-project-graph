import Cpp from 'tree-sitter-cpp';

function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

// Flecs (and other ECS-style libs) register systems via a lambda attached
// to `.each(...)` / `.iter(...)` / `.run(...)` chained off a system query.
// The C++ walker already attributes CALLS inside the lambda body to the
// enclosing free function, but the component types declared as lambda
// parameters (Transform&, CameraTarget&, etc.) are completely invisible.
// This postExtract emits USES_TYPE refs from the enclosing function to each
// component type.
// Common ECS query terminators where a lambda declares the component types.
// - flecs: .each / .iter / .run
// - entt: .view<T...>().each / .for_each
// - EnTT / bevy_ecs ports: .for_each
// The detection fires on method+lambda shape (not library-specific), so
// new ECS libraries with a similar API join automatically.
const ECS_TERMINATOR_FIELDS = new Set(['each', 'iter', 'run', 'for_each']);

function normalizeTypeName(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/\bconst\b/g, '').replace(/[&*]/g, '').trim();
  if (!cleaned) return '';
  const parts = cleaned.split('::').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? '';
}

function paramTypes(paramList, source) {
  const out = [];
  if (!paramList) return out;
  for (const p of paramList.namedChildren) {
    if (p.type !== 'parameter_declaration') continue;
    const typeNode = p.childForFieldName('type');
    if (!typeNode) continue;
    out.push(normalizeTypeName(nodeText(typeNode, source)));
  }
  return out.filter(Boolean);
}

function findEnclosingFunctionLabel(fnDef, source) {
  let inner = fnDef.childForFieldName('declarator');
  while (inner) {
    if (inner.type === 'identifier' || inner.type === 'field_identifier') {
      return nodeText(inner, source);
    }
    if (inner.type === 'qualified_identifier') {
      const name = inner.childForFieldName('name');
      if (name) return nodeText(name, source);
    }
    inner = inner.childForFieldName?.('declarator') ?? inner.namedChildren?.[0];
  }
  return '';
}

function postExtractCpp({ tree, source, filePath, nodes }) {
  const refs = [];
  const functionsInFile = nodes.filter(
    (n) => (n.type === 'Function' || n.type === 'Method') && n.file_path === filePath,
  );

  function nodeForEnclosing(fnDef) {
    const label = findEnclosingFunctionLabel(fnDef, source);
    if (!label) return null;
    const startLine = fnDef.startPosition.row + 1;
    const candidates = functionsInFile.filter((n) => n.label === label);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    return candidates.reduce((best, n) =>
      Math.abs(n.start_line - startLine) < Math.abs(best.start_line - startLine) ? n : best,
    );
  }

  function walk(node, ancestors = []) {
    if (node.type === 'call_expression') {
      const fnExpr = node.childForFieldName('function');
      if (fnExpr?.type === 'field_expression') {
        const field = fnExpr.childForFieldName('field');
        const fieldName = nodeText(field, source);
        if (ECS_TERMINATOR_FIELDS.has(fieldName)) {
          const args = node.childForFieldName('arguments');
          if (args) {
            for (const argChild of args.namedChildren) {
              if (argChild.type !== 'lambda_expression') continue;
              const lambdaDecl = argChild.childForFieldName('declarator');
              const plist = lambdaDecl?.childForFieldName?.('parameters')
                ?? lambdaDecl?.namedChildren?.find?.((c) => c.type === 'parameter_list');
              const types = paramTypes(plist, source);
              if (types.length === 0) continue;
              let enclosing = null;
              for (let i = ancestors.length - 1; i >= 0; i -= 1) {
                if (ancestors[i].type === 'function_definition') {
                  enclosing = ancestors[i];
                  break;
                }
              }
              if (!enclosing) continue;
              const ownerNode = nodeForEnclosing(enclosing);
              if (!ownerNode) continue;
              for (const t of types) {
                if (t === 'entity') continue;  // flecs entity handle, not a user type
                refs.push({
                  from_id: ownerNode.id,
                  from_label: ownerNode.label,
                  relation: 'USES_TYPE',
                  target: t,
                  source_file: filePath,
                  source_line: argChild.startPosition.row + 1,
                  confidence: 0.7,
                  extractor: 'cpp',
                });
              }
            }
          }
        }
      }
    }
    for (const c of node.namedChildren) walk(c, [...ancestors, node]);
  }

  walk(tree.rootNode);
  return { refs };
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
  postExtract: postExtractCpp,
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
