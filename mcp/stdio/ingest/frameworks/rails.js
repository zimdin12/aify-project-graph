// Rails plugin: config/routes.rb → Route nodes + INVOKES edges to
// controller actions. Supports the common shapes:
//
//   get '/users' => 'users#index'
//   post '/users', to: 'users#create'
//   resources :posts                    # expands to 7 standard routes
//   resources :posts, only: [:index]    # filtered
//   namespace :api do ... end           # prefixes nested routes
//
// We don't try to be a full parser — Rails routing is Turing-complete
// at the DSL level. We cover the 90% shapes seen in real apps.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

const STANDARD_RESOURCE_ACTIONS = [
  { method: 'GET',    suffix: '',          action: 'index'  },
  { method: 'GET',    suffix: '/new',      action: 'new'    },
  { method: 'POST',   suffix: '',          action: 'create' },
  { method: 'GET',    suffix: '/:id',      action: 'show'   },
  { method: 'GET',    suffix: '/:id/edit', action: 'edit'   },
  { method: 'PATCH',  suffix: '/:id',      action: 'update' },
  { method: 'PUT',    suffix: '/:id',      action: 'update' },
  { method: 'DELETE', suffix: '/:id',      action: 'destroy' },
];

// `articles` -> `ArticlesController`; `admin/users` -> `UsersController`. Rails names the class after
// the resource, so the qualified target the resolver needs is derivable rather than guessable.
// ⚠ The namespace segment is dropped on purpose: the resolver matches a qname SUFFIX, and
// `UsersController.index` is already specific enough to beat the denylist.
function controllerClassName(controller) {
  const last = String(controller ?? '').split('/').pop() ?? '';
  const camel = last.split('_').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  return camel ? `${camel}Controller` : '';
}

// ⛔ `#` IS A COMMENT MARKER IN RUBY *AND* THE CONTROLLER/ACTION SEPARATOR IN A RAILS ROUTE.
//
// The previous `rawLine.replace(/#.*$/, '')` truncated `get 'dashboard', to: 'admin_reports#index'`
// to `get 'dashboard', to: 'admin_reports` — so `parseExplicitRoute` matched nothing and EVERY
// explicit `to:` route silently produced no Route node at all. `resources :articles` contains no
// `#`, which is the only reason anything worked.
//
// ⭐ MEASURED: a fixture containing one explicit route and nothing else produced ZERO refs, while
// the same file with `resources` produced eight. Two forms of the same feature, one of them
// entirely invisible.
//
// ⇒ Only a `#` OUTSIDE a quoted string starts a comment. Tracked rather than pattern-matched,
// because a regex cannot see quote state.
function stripRubyComment(rawLine) {
  let quote = null;
  for (let i = 0; i < rawLine.length; i += 1) {
    const ch = rawLine[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; } // an escaped char inside a string is never a delimiter
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '#') return rawLine.slice(0, i);
  }
  return rawLine;
}

function parseExplicitRoute(line) {
  // `get '/x', to: 'users#index'` or `get '/x' => 'users#index'`
  const m = line.match(/^\s*(get|post|put|patch|delete|head|options|match)\s+['"]([^'"]+)['"].*?(?:to:\s*|=>\s*)['"]([a-z_][a-z0-9_\/]*)#([a-z_]+)['"]/i);
  if (!m) return null;
  return {
    method: m[1].toUpperCase(),
    path: m[2],
    controller: m[3],
    action: m[4],
  };
}

function parseResourcesLine(line) {
  // `resources :posts` or `resources :posts, only: [:index, :show]`
  const m = line.match(/^\s*resources?\s+:([a-z_]+)(.*)/);
  if (!m) return null;
  const name = m[1];
  const opts = m[2];
  const onlyMatch = opts.match(/only:\s*\[([^\]]+)\]/);
  const exceptMatch = opts.match(/except:\s*\[([^\]]+)\]/);
  let actions = STANDARD_RESOURCE_ACTIONS;
  if (onlyMatch) {
    const keep = new Set([...onlyMatch[1].matchAll(/:([a-z_]+)/g)].map((x) => x[1]));
    actions = actions.filter((a) => keep.has(a.action));
  } else if (exceptMatch) {
    const drop = new Set([...exceptMatch[1].matchAll(/:([a-z_]+)/g)].map((x) => x[1]));
    actions = actions.filter((a) => !drop.has(a.action));
  }
  return { name, actions };
}

function parseScope(line) {
  // `namespace :api do` or `scope '/v1' do`
  const ns = line.match(/^\s*namespace\s+:([a-z_]+)\s+do/);
  if (ns) return { prefix: `/${ns[1]}`, controllerPrefix: `${ns[1]}/` };
  const scope = line.match(/^\s*scope\s+['"]([^'"]+)['"]\s+do/);
  if (scope) return { prefix: scope[1], controllerPrefix: '' };
  return null;
}

function parseRoutes(content, file) {
  const lines = content.split('\n');
  const scopeStack = []; // { prefix, controllerPrefix }
  const routes = [];

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = stripRubyComment(rawLine);

    const scope = parseScope(line);
    if (scope) { scopeStack.push(scope); continue; }
    if (/^\s*end\b/.test(line) && scopeStack.length > 0) {
      scopeStack.pop();
      continue;
    }

    const prefix = scopeStack.map((s) => s.prefix).join('');
    const ctrlPrefix = scopeStack.map((s) => s.controllerPrefix).join('');

    const explicit = parseExplicitRoute(line);
    if (explicit) {
      routes.push({
        method: explicit.method,
        path: `${prefix}${explicit.path}`.replace(/\/+/g, '/'),
        controller: `${ctrlPrefix}${explicit.controller}`,
        action: explicit.action,
        line: i + 1,
        file,
      });
      continue;
    }

    const resources = parseResourcesLine(line);
    if (resources) {
      const basePath = `${prefix}/${resources.name}`.replace(/\/+/g, '/');
      for (const a of resources.actions) {
        routes.push({
          method: a.method,
          path: `${basePath}${a.suffix}`,
          controller: `${ctrlPrefix}${resources.name}`,
          action: a.action,
          line: i + 1,
          file,
        });
      }
    }
  }
  return routes;
}

export const railsPlugin = createFrameworkPlugin({
  name: 'rails-routes',

  async detect({ repoRoot }) {
    const gemfile = await tryReadFile(`${repoRoot}/Gemfile`);
    if (gemfile && /gem\s+['"]rails['"]/i.test(gemfile)) return true;
    const routesRb = await tryReadFile(`${repoRoot}/config/routes.rb`);
    return routesRb !== null;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    // Rails has one canonical routes file + optional engine routes.
    const files = await walkFiles(repoRoot, ['.rb'], { maxFiles: 1000 });
    // Normalize Windows backslashes before suffix-match so the filter works
    // cross-platform. walkFiles returns absolute paths in native form.
    const routeFiles = files.filter((f) => {
      const norm = f.replace(/\\/g, '/');
      return norm.endsWith('config/routes.rb') || norm.endsWith('/routes.rb');
    });
    for (const abs of routeFiles) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      const rp = relPath(repoRoot, abs);
      for (const r of parseRoutes(content, rp)) {
        const label = `${r.method} ${r.path}`;
        const node = routeNode({ filePath: rp, label, language: 'ruby', startLine: r.line });
        nodes.push(node);
        // ⛔ THE BARE ACTION NAME CANNOT RESOLVE, AND THE COMMENT HERE USED TO SAY IT WOULD.
        //
        // It read: "We emit the action identifier alone (the resolver will match it against Method
        // nodes by label)." But label matching is exactly what the COMMON_NAMES denylist blocks —
        // and `index`, `create` and `update` are ON it, being three of the seven standard Rails
        // actions and among the most-used names in any codebase.
        //
        // ⭐ MEASURED on a real Rails fixture indexed by the real pipeline: `resources :articles`
        // produced 8 route nodes and exactly ONE bound edge (`show`). `index` was defined in the
        // controller and still did not bind.
        //
        // ⇒ The plugin KNOWS the controller — it is right there in `r.controller` — so there is no
        // need to guess by bare label. `laravel.js` already emits `${controller}.${action}` for
        // exactly this reason; this now matches it.
        refs.push(invokesRef({
          node, target: `${controllerClassName(r.controller)}.${r.action}`, extractor: 'rails',
          sourceFile: rp, sourceLine: r.line,
        }));
      }
    }
    return { nodes, edges: result.edges, refs };
  },
});
