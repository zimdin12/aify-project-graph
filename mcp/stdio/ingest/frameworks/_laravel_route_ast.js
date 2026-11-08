// Read Laravel route registrations from a route file's syntax tree (#5).
//
// The plugin used to match one regex shape, `Route::verb('p', [Plain::class, 'm'])`. Measured on BookStack 0b6b667, a
// real Laravel application: it found 72 of 342 routes, because web.php names its controllers through namespace
// aliases (`[AccessControllers\LoginController::class, 'login']`) and wraps most of them in
// `Route::middleware('auth')->group(function () { ... })`, whose body the regex ended at the first nested `});`.
//
// Here every `Route::...->...` call chain is read as a chain. What a chain sets before `->group(closure)` (prefix,
// middleware, controller) is inherited by every route in the closure's body; a verb call is a route; what follows the
// verb (->middleware, ->name, ->where) belongs to that route. Anything this cannot read statically (a computed path,
// a variable action) is left out rather than guessed.
import { parseSource, nodeText } from '../walker.js';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any', 'view']);
// The conventional actions of `Route::resource` / `apiResource`, as Laravel registers them.
const RESOURCE_ACTIONS = [
  ['index', 'GET', ''], ['create', 'GET', '/create'], ['store', 'POST', ''], ['show', 'GET', '/{id}'],
  ['edit', 'GET', '/{id}/edit'], ['update', 'PUT', '/{id}'], ['destroy', 'DELETE', '/{id}'],
];
const API_ACTIONS = new Set(['index', 'store', 'show', 'update', 'destroy']);

/**
 * @returns {Array<{ method, path, controller: string|null, action: string|null, middleware: string[], line }>}
 *   `middleware` holds the raw tokens as written (quoted aliases, `X::class`), for the plugin to resolve.
 */
export function readRouteDefinitions({ source, config, middlewareTokens }) {
  const tree = parseSource({ source, config });
  const routes = [];
  walkStatements(tree.rootNode, { prefix: '', middleware: [], controller: null }, { source, routes, middlewareTokens });
  return routes;
}

function walkStatements(node, ctx, env) {
  for (const child of node.namedChildren) {
    if (child.type === 'expression_statement') {
      const chain = routeChain(child.namedChildren[0], env.source);
      if (chain) { readChain(chain, ctx, env); continue; }
    }
    if (!isFunction(child)) walkStatements(child, ctx, env);
  }
}

const isFunction = (node) => ['anonymous_function', 'anonymous_function_creation_expression', 'arrow_function', 'function_definition', 'class_declaration'].includes(node?.type);

/** `Route::a(...)->b(...)->c(...)` as [{ name, args, line }] from `a` outward, or null when it does not start at Route. */
function routeChain(expr, source) {
  if (!expr) return null;
  if (expr.type === 'scoped_call_expression') {
    const scope = nodeText(expr.childForFieldName('scope'), source).replace(/^\\+/u, '');
    return scope === 'Route' ? [callOf(expr, source)] : null;
  }
  if (expr.type === 'member_call_expression') {
    const inner = routeChain(expr.childForFieldName('object'), source);
    return inner ? [...inner, callOf(expr, source)] : null;
  }
  return null;
}

function callOf(node, source) {
  const args = (node.childForFieldName('arguments')?.namedChildren ?? [])
    .filter((a) => a.type === 'argument')
    .map((a) => a.namedChildren.at(-1));
  return { name: nodeText(node.childForFieldName('name'), source), args, line: node.startPosition.row + 1 };
}

function readChain(chain, ctx, env) {
  const local = { ...ctx, middleware: [...ctx.middleware] };
  let made = [];
  for (const call of chain) {
    if (VERBS.has(call.name) || call.name === 'match') {
      made = [verbRoute(call, local, env.source)].filter(Boolean);
      env.routes.push(...made);
    } else if (call.name === 'resource' || call.name === 'apiResource') {
      made = resourceRoutes(call, local, env.source);
      env.routes.push(...made);
    } else if (call.name === 'only' || call.name === 'except') {
      const named = new Set(stringsIn(call.args[0], env.source));
      const drop = made.filter((r) => (call.name === 'only') !== named.has(r.resourceAction));
      for (const r of drop) env.routes.splice(env.routes.indexOf(r), 1);
      made = made.filter((r) => !drop.includes(r));
    } else if (call.name === 'middleware') {
      const tokens = env.middlewareTokens(call.args.map((a) => nodeText(a, env.source)).join(','));
      if (made.length) for (const r of made) r.middleware.push(...tokens);
      else local.middleware.push(...tokens);
    } else if (call.name === 'prefix') {
      local.prefix = joinPath(local.prefix, stringOf(call.args[0], env.source) ?? '');
    } else if (call.name === 'controller') {
      local.controller = classOf(call.args[0], env.source);
    } else if (call.name === 'group') {
      const body = call.args.find(isFunction)?.childForFieldName('body');
      if (body) walkStatements(body, local, env);
    }
  }
}

function verbRoute(call, ctx, source) {
  const isMatch = call.name === 'match';
  const path = stringOf(call.args[isMatch ? 1 : 0], source);
  if (path === null) return null;
  const method = isMatch ? stringsIn(call.args[0], source).map((m) => m.toUpperCase()).join('|') : (call.name === 'view' ? 'GET' : call.name.toUpperCase());
  const target = call.name === 'view' ? { controller: null, action: null } : actionOf(call.args[isMatch ? 2 : 1], ctx, source);
  return { method, path: joinPath(ctx.prefix, path), ...target, middleware: [...ctx.middleware], line: call.line };
}

function resourceRoutes(call, ctx, source) {
  const name = stringOf(call.args[0], source);
  const controller = classOf(call.args[1], source);
  if (name === null || controller === null) return [];
  return RESOURCE_ACTIONS
    .filter(([action]) => call.name === 'resource' || API_ACTIONS.has(action))
    .map(([action, method, suffix]) => ({
      method, path: joinPath(ctx.prefix, `${name}${suffix}`), controller, action,
      middleware: [...ctx.middleware], line: call.line, resourceAction: action,
    }));
}

/** [X::class, 'm'], 'C@m', an invokable X::class, or 'm' under Route::controller(X). A closure has no controller. */
function actionOf(node, ctx, source) {
  if (!node) return { controller: null, action: null };
  if (node.type === 'array_creation_expression') {
    const [cls, method] = node.namedChildren.map((el) => el.namedChildren.at(-1));
    const controller = classOf(cls, source);
    const action = stringOf(method, source);
    return controller && action ? { controller, action } : { controller: null, action: null };
  }
  if (node.type === 'class_constant_access_expression') return { controller: classOf(node, source), action: '__invoke' };
  const text = stringOf(node, source);
  if (text?.includes('@')) { const [c, m] = text.split('@'); return { controller: baseName(c), action: m }; }
  if (text && ctx.controller) return { controller: ctx.controller, action: text };
  return { controller: null, action: null };
}

/** The class a `Foo::class` (or 'Foo' string) names, as its base name: aliases and namespaces are path, not identity. */
function classOf(node, source) {
  if (node?.type === 'class_constant_access_expression') return baseName(nodeText(node.namedChildren[0], source));
  const text = stringOf(node, source);
  return text ? baseName(text) : null;
}

const baseName = (name) => String(name).replace(/^\\+/u, '').split('\\').pop() || null;

function stringOf(node, source) {
  if (!node || !['string', 'encapsed_string'].includes(node.type)) return null;
  if (node.namedChildren.some((c) => !['string_content', 'string_value', 'escape_sequence'].includes(c.type))) return null; // interpolated
  return nodeText(node, source).slice(1, -1);
}

function stringsIn(node, source) {
  if (node?.type !== 'array_creation_expression') return [stringOf(node, source)].filter((s) => s !== null);
  return node.namedChildren.map((el) => stringOf(el.namedChildren.at(-1), source)).filter((s) => s !== null);
}

function joinPath(prefix, path) {
  if (!prefix) return path;
  const joined = [prefix, path].map((p) => p.replace(/^\/+|\/+$/gu, '')).filter(Boolean).join('/');
  return joined || '/';
}
