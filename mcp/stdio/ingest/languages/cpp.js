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

// Strip balanced template-argument lists (`<...>`) from a C++ name spelling so
// templated calls/scopes resolve to their base symbol (`foo<int>` → `foo`,
// `Mgr<int>::tick` → `Mgr::tick`). Operator-aware: an `operator<`, `operator<<`,
// `operator<=>`, `operator>>`, … spelling has `<`/`>` as part of the operator
// NAME, not template args, so those are preserved verbatim. A plain identifier
// that merely CONTAINS the substring "operator" (e.g. `operatorCount<int>`) is
// NOT an operator overload, so its template args ARE stripped — this is the fix
// for the substring-guard under-strip that re-dropped such caller edges.
const OPERATOR_SYMBOL_RE = /^(<=>|<<=?|>>=?|<=|>=|==|!=|&&|\|\||->\*?|\+\+|--|\(\)|\[\]|[-+*/%^&|~!=<>]=?|new\b|delete\b)/u;
function stripTemplateArgs(raw) {
  const s = String(raw ?? '');
  if (!s.includes('<')) return s;
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    // Preserve an `operator<…>`-style overload spelling verbatim at top level.
    if (depth === 0 && s.startsWith('operator', i) && (i === 0 || !/[A-Za-z0-9_]/u.test(s[i - 1]))) {
      let j = i + 'operator'.length;
      while (j < s.length && s[j] === ' ') j += 1;
      const opMatch = OPERATOR_SYMBOL_RE.exec(s.slice(j));
      if (opMatch) {
        out += s.slice(i, j) + opMatch[0];
        i = j + opMatch[0].length;
        continue;
      }
      // 'operator' is just a substring of an identifier — fall through so its
      // template args get stripped like any other name.
    }
    const ch = s[i];
    if (ch === '<') { depth += 1; i += 1; continue; }
    if (ch === '>') {
      // A `>` only closes a template list when we're inside one. At depth 0 it is
      // the arrow operator's `>` (`->`) or a stray `>`, and must be kept literal —
      // otherwise `p->get<T>` loses its `->` and resolves to garbage.
      if (depth > 0) { depth -= 1; i += 1; continue; }
      out += ch; i += 1; continue;
    }
    if (depth === 0) out += ch;
    i += 1;
  }
  return out;
}

function normalizeCppScope(raw) {
  return stripTemplateArgs(raw)
    .split('::')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('.');
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

function extractQualifiedScopeSegments(node, source) {
  if (!node) return [];
  if (node.type === 'qualified_identifier') {
    return [
      ...extractQualifiedScopeSegments(node.childForFieldName('scope'), source),
      ...extractQualifiedScopeSegments(node.childForFieldName('name'), source),
    ];
  }
  if (node.type === 'template_type') {
    return extractQualifiedScopeSegments(node.childForFieldName('name'), source);
  }
  const text = nodeText(node, source).trim();
  return text ? [text] : [];
}

// Strip balanced template-argument lists (`<...>`) from a call target spelling
// so templated calls resolve to their base symbol. WHY (eval finding #3, weak
// C++ caller coverage): game code is template-heavy (ECS, containers), and a
// call like `foo<int>()`, `Type::method<T>()` or `World::Mgr<int>::tick()` left
// the leaf name with `<...>` attached — which matches NONE of the parse regexes
// below, so the edge fell through to the verbatim spelling and never resolved to
// the `foo` / `method` / `tick` node. That silently dropped real caller edges.
// Guarded: skip when the spelling contains `operator` (operator<, operator<<,
// operator<=> would be mangled) and bail on unbalanced brackets (never truncate
// a real name). Scope-level template args were already handled by
// normalizeCppScope; this also covers the leaf and bare-function cases.
function normalizeCppCallTarget({ text, owner }) {
  // Drop a `->template` / `.template` / `::template` disambiguator keyword
  // (`p->template get<T>()` spells the function field as `p->template get`), so
  // the leaf `get` survives the whitespace split below instead of yielding
  // garbage like `p-template`. Then strip template args (operator-aware).
  const detemplated = String(text ?? '').trim().replace(/(^|->|\.|::)\s*template\s+/u, '$1');
  const stripped = stripTemplateArgs(detemplated);
  // A leading `::foo` (explicit global scope) carries no scope before `::`, so it
  // would fall through unresolved; drop the leading `::` to recover the base name.
  const raw = (stripped.split(/\s+/u)[0] ?? '').replace(/^::/u, '');
  if (!raw) return '';

  const qualified = raw.match(/^(.+)::(~?[A-Za-z_]\w*)$/u);
  if (qualified) {
    const scope = normalizeCppScope(qualified[1]);
    return scope ? `${scope}.${qualified[2]}` : qualified[2];
  }

  const thisCall = raw.match(/^this(?:->|\.)((?:~)?[A-Za-z_]\w*)$/u);
  if (thisCall) {
    const parentClass = owner?.extra?.parent_class ?? '';
    return parentClass ? `${parentClass}.${thisCall[1]}` : thisCall[1];
  }

  // Keep object.member() calls bare: without type information the receiver
  // could be any class, so class-qualifying would overclaim.
  if (raw.includes('->') || raw.includes('.')) {
    const parts = raw.split(/->|\./u);
    return parts.at(-1) ?? raw;
  }

  const bare = raw.match(/^(~?[A-Za-z_]\w*)$/u);
  return bare?.[1] ?? raw;
}

function findCppNamedDeclarator(node) {
  if (!node) return null;
  if (['identifier', 'field_identifier', 'qualified_identifier'].includes(node.type)) return node;
  const direct = node.childForFieldName?.('declarator');
  if (direct) return findCppNamedDeclarator(direct);
  for (const child of node.namedChildren ?? []) {
    const found = findCppNamedDeclarator(child);
    if (found) return found;
  }
  return null;
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

// Extract a Method symbol from an in-class method *declaration* (no body) —
// `field_declaration` whose declarator is a `function_declarator`. This covers
// pure-virtual interface methods (`virtual T m() const = 0;`), other virtual
// declarations, and ordinary declared-but-defined-elsewhere member functions.
//
// WHY (P0-5): tree-sitter only emits Method nodes for `function_definition`
// (methods with a `{ ... }` body). Game-engine interfaces (echoes `ISimDomain`
// and its 15 pure-virtuals) declare their virtuals with `= 0` and NO body, so
// the base virtuals were invisible to the graph. Without a base Method node,
// the virtual-override synthesizer has nothing to link FROM. Capturing these
// declarations makes base virtuals first-class nodes — which also helps
// hierarchy/search verbs, not just override synthesis.
//
// Returns null for member-variable `field_declaration`s (declarator is a plain
// `field_identifier`, not a `function_declarator`) so we don't turn fields into
// methods. Returns null for declarations that also have a body — those are
// already captured by the function_definition rule (avoids a duplicate node).
function extractCppMethodDeclSymbol({ node, source }) {
  const declarator = node.childForFieldName('declarator');
  if (!declarator || declarator.type !== 'function_declarator') return null;
  // A function_declarator inside a field_declaration is a declaration-only
  // method (interface/virtual/prototype). The name is the field_identifier (or
  // a destructor_name / operator) inside the function_declarator.
  let nameNode = declarator.childForFieldName('declarator');
  if (!nameNode) {
    nameNode = declarator.namedChildren.find((c) =>
      ['field_identifier', 'identifier', 'destructor_name', 'operator_name', 'qualified_identifier'].includes(c.type));
  }
  const name = nameNode ? nodeText(nameNode, source).trim() : '';
  if (!name) return null;
  return { name, type: 'Method' };
}

// Extract a Class/struct symbol ONLY from a real definition (has a body).
// Audit 2026-06-12 (echoes measurement): a forward declaration `class Foo;` is a
// class_specifier with a name but no body. Extracting it as a full Class node
// spawned duplicate same-named classes across headers, which made out-of-line
// method owner resolution ambiguous — 1072 unresolved `CONTAINS "undefined"`
// edges (the single largest non-denylisted bucket). Skip body-less specifiers;
// if the real definition isn't in the repo, the name is honestly external.
function extractCppClassSymbol({ node, source }) {
  const body = node.childForFieldName('body')
    ?? node.namedChildren.find((c) => c.type === 'field_declaration_list');
  if (!body) return null;
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nodeText(nameNode, source).trim() : '';
  return name ? { name } : null;
}

function extractCppFunctionSymbol({ node, source }) {
  const declarator = node.childForFieldName('declarator');
  const namedDeclarator = findCppNamedDeclarator(declarator);
  if (namedDeclarator?.type === 'qualified_identifier') {
    const scopeChain = extractQualifiedScopeSegments(namedDeclarator.childForFieldName('scope'), source);
    const name = nodeText(namedDeclarator.childForFieldName('name'), source).trim();
    const parentClass = scopeChain.at(-1) ?? '';
    const parentClassQname = scopeChain.join('.');
    if (name && parentClass) {
      return {
        name,
        parentClass,
        parentClassQname,
        type: 'Method',
      };
    }
  }

  const declaratorText = nodeText(declarator, source);
  const qualifiedMatch = declaratorText.match(/(?:^|[\s*&])((?:[A-Za-z_][\w]*::)+)(~?[A-Za-z_]\w*)\s*\(/u);
  if (qualifiedMatch) {
    const scopeChain = qualifiedMatch[1].replace(/::$/u, '').split('::').filter(Boolean);
    const parentClass = scopeChain.at(-1) ?? '';
    return {
      name: qualifiedMatch[2],
      parentClass,
      parentClassQname: scopeChain.join('.'),
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
  normalizeCallTarget: normalizeCppCallTarget,
  // Attribute file-scope / static-initializer calls to the File node (the C++
  // self-registration idiom: `static Registrar r = Factory::add(...);`).
  fileScopeCalls: true,
  extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.h'],
  confidence: {
    node: 0.6,
    import: 0.6,
    call: 0.6,
  },
  symbols: [
    { type: 'Class', nodeTypes: ['class_specifier', 'struct_specifier'], extractSymbolInfo: extractCppClassSymbol, confidence: 0.7 },
    {
      type: 'Function',
      nodeTypes: ['function_definition'],
      extractSymbolInfo: extractCppFunctionSymbol,
      signatureFields: ['declarator'],
      confidence: 0.6,
    },
    { type: 'Method', nodeTypes: ['function_definition'], parentTypes: ['class_specifier', 'struct_specifier', 'field_declaration_list'], descendantTypes: ['identifier'], confidence: 0.6 },
    // P0-5: in-class method *declarations* (pure-virtual + prototypes). Only
    // fires for field_declarations whose declarator is a function_declarator
    // (extractCppMethodDeclSymbol returns null otherwise), so member variables
    // stay out. Lower confidence (0.55) than a defined method — it's a
    // declaration, the definition may live elsewhere.
    {
      type: 'Method',
      nodeTypes: ['field_declaration'],
      parentTypes: ['field_declaration_list'],
      extractSymbolInfo: extractCppMethodDeclSymbol,
      signatureFields: ['declarator'],
      confidence: 0.55,
    },
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
