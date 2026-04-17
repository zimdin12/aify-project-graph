import Php from 'tree-sitter-php';

function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

// Laravel-style facade map. Calls like `Cache::get('key')` are static-looking
// but at runtime resolve to a concrete manager class. We emit a REFERENCES
// edge from the source file to the underlying class so `graph_callers` on
// e.g. CacheManager shows up wherever Cache::* is used. Unresolved facade
// targets surface as External boundary nodes (item 2 / dev's Wave 2.2).
const FACADE_MAP = new Map([
  ['Cache', 'Illuminate\\Cache\\CacheManager'],
  ['DB', 'Illuminate\\Database\\DatabaseManager'],
  ['Log', 'Illuminate\\Log\\LogManager'],
  ['Route', 'Illuminate\\Routing\\Router'],
  ['Auth', 'Illuminate\\Auth\\AuthManager'],
  ['Session', 'Illuminate\\Session\\SessionManager'],
  ['Storage', 'Illuminate\\Filesystem\\FilesystemManager'],
  ['View', 'Illuminate\\View\\Factory'],
  ['Config', 'Illuminate\\Config\\Repository'],
  ['Event', 'Illuminate\\Events\\Dispatcher'],
  ['Queue', 'Illuminate\\Queue\\QueueManager'],
  ['Request', 'Illuminate\\Http\\Request'],
  ['Response', 'Illuminate\\Routing\\ResponseFactory'],
  ['Str', 'Illuminate\\Support\\Str'],
  ['Arr', 'Illuminate\\Support\\Arr'],
  ['Schema', 'Illuminate\\Database\\Schema\\Builder'],
  ['Artisan', 'Illuminate\\Console\\Application'],
  ['Hash', 'Illuminate\\Hashing\\HashManager'],
  ['Gate', 'Illuminate\\Auth\\Access\\Gate'],
  ['Mail', 'Illuminate\\Mail\\Mailer'],
]);

// Post-extract: adds refs for three Laravel/PHP dynamic-dispatch patterns
// that don't fit the per-node rule system cleanly.
//   (a) app(Foo::class) / resolve(Foo::class) → REFERENCES to Foo
//   (b) Facade::method() where Facade is in FACADE_MAP → REFERENCES to the
//       underlying manager class (noisy if many facades; lets agents still
//       find "what uses Cache?")
//   (c) Constructor injection: public function __construct(UserService $svc)
//       → USES_TYPE from the enclosing class to UserService
// All three are static, conservative, and Laravel-neutral (rules fire on
// pattern shape, not project type — false positives are rare because the
// shapes are specific).
function postExtractPhp({ tree, source, filePath, fileNode, nodes, symbolsById }) {
  const refs = [];
  // Map class nodes in this file by the class's start line so we can attach
  // constructor-injection USES_TYPE to the right Class.
  const classesInFile = nodes.filter((n) => n.type === 'Class' && n.file_path === filePath);

  function classAtLine(line) {
    // Class whose start_line <= line <= end_line (pick the innermost by
    // tightest range, handles nested class in interface).
    let best = null;
    for (const c of classesInFile) {
      if (c.start_line <= line && line <= c.end_line) {
        if (!best || (c.end_line - c.start_line) < (best.end_line - best.start_line)) {
          best = c;
        }
      }
    }
    return best;
  }

  function extractClassNameFromConstAccess(node) {
    // class_constant_access_expression shape: Foo::class
    // Children: [class, ::, identifier("class")]. Class is either `name` or
    // a qualified_name.
    const scope = node.namedChildren.find((c) => c.type === 'name' || c.type === 'qualified_name');
    if (!scope) return '';
    return nodeText(scope, source).trim();
  }

  function walk(node) {
    // (a) app(Foo::class) or resolve(Foo::class)
    if (node.type === 'function_call_expression') {
      const fnNode = node.childForFieldName('function');
      const fnName = nodeText(fnNode, source).trim();
      if (fnName === 'app' || fnName === 'resolve' || fnName === 'make') {
        const args = node.childForFieldName('arguments');
        if (args) {
          for (const arg of args.namedChildren) {
            // arg is `argument`, inner is the actual expression
            const inner = arg.namedChildren[0] ?? arg;
            if (inner?.type === 'class_constant_access_expression') {
              const target = extractClassNameFromConstAccess(inner);
              if (target) {
                refs.push({
                  from_id: fileNode.id,
                  from_label: fileNode.label,
                  relation: 'REFERENCES',
                  target,
                  source_file: filePath,
                  source_line: node.startPosition.row + 1,
                  confidence: 0.7,
                  extractor: 'php',
                });
              }
            }
          }
        }
      }
    }

    // (b) Facade::method() — scoped_call_expression with scope matching FACADE_MAP.
    // Strip the leading `\` that tree-sitter-php preserves for root-namespaced
    // facade calls like `\DB::select(...)` and `\Log::error(...)` — lc-api
    // writes facades this way consistently and we were missing 481 calls.
    if (node.type === 'scoped_call_expression') {
      const scopeNode = node.childForFieldName('scope');
      const rawScope = nodeText(scopeNode, source).trim();
      const scopeText = rawScope.replace(/^\\+/, '');
      if (FACADE_MAP.has(scopeText)) {
        const realClass = FACADE_MAP.get(scopeText);
        refs.push({
          from_id: fileNode.id,
          from_label: fileNode.label,
          relation: 'REFERENCES',
          target: realClass,
          source_file: filePath,
          source_line: node.startPosition.row + 1,
          confidence: 0.65,
          extractor: 'php',
        });
      }
    }

    // (c) Method parameters with type hints → USES_TYPE from enclosing class.
    // Originally __construct only (classic DI); extended to all methods since
    // typed parameters on any method are real class-level dependencies
    // (e.g. public function store(UserService $svc, Request $req)). Same
    // primitive skip list, same confidence.
    if (node.type === 'method_declaration') {
      const params = node.childForFieldName('parameters');
      const methodLine = node.startPosition.row + 1;
      const ownerClass = classAtLine(methodLine);
      if (params && ownerClass) {
        for (const p of params.namedChildren) {
          // simple_parameter or property_promotion_parameter — both can have a type.
          const typeNode = p.childForFieldName('type');
          if (!typeNode) continue;
          // Named type — can be a union/intersection/simple. Walk for `name` / `qualified_name`.
          const names = [];
          const queue = [typeNode];
          while (queue.length) {
            const cur = queue.shift();
            if (cur.type === 'name' || cur.type === 'qualified_name' || cur.type === 'named_type') {
              if (cur.type === 'named_type') {
                queue.push(...cur.namedChildren);
              } else {
                names.push(nodeText(cur, source).trim());
              }
            } else {
              queue.push(...cur.namedChildren);
            }
          }
          for (const typeName of names) {
            if (!typeName) continue;
            if (['string', 'int', 'float', 'bool', 'array', 'object', 'mixed', 'void', 'null', 'iterable', 'callable', 'self', 'static', 'parent'].includes(typeName.toLowerCase())) continue;
            refs.push({
              from_id: ownerClass.id,
              from_label: ownerClass.label,
              relation: 'USES_TYPE',
              target: typeName,
              source_file: filePath,
              source_line: methodLine,
              confidence: 0.8,
              extractor: 'php',
            });
          }
        }
      }
    }

    for (const child of node.namedChildren) walk(child);
  }

  walk(tree.rootNode);
  return { refs };
}


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
  postExtract: postExtractPhp,
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
      // `use SomeTrait;` inside a class body. Semantically this is trait
      // composition (mixin), not interface implementation. We reuse the
      // IMPLEMENTS edge as an intentional approximation to avoid a schema
      // change; if/when we introduce a USES_TRAIT relation, this rule should
      // switch to it. Scoped to parentTypes=['declaration_list'] so we do not
      // catch the top-of-file `namespace_use_declaration` (the import form).
      { nodeTypes: ['use_declaration'], parentTypes: ['declaration_list'], descendantTypes: ['name'] },
    ],
  },
};
