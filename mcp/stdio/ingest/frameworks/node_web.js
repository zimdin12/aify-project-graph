// Node.js web framework plugin: Express, Koa, Fastify, Hono.
//
// Detects `app.METHOD('/path', handler)` / `router.METHOD(...)` /
// `fastify.METHOD({...}, handler)` patterns. Emits Route nodes + INVOKES
// edges from route → handler function. Middleware in the args list
// becomes PASSES_THROUGH edges so graph_path can trace request flow.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

const METHODS = 'get|post|put|patch|delete|head|options|all|use';

// Matches: app.get('/x', foo) | router.post('/y', mw1, mw2, handler)
// Greedy on the args tail; we post-parse identifiers.
const EXPRESS_RE = new RegExp(
  `\\b([A-Za-z_][A-Za-z0-9_]*)\\.(${METHODS})\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*([^)]+)\\)`,
  'g',
);

// Fastify object-form: fastify.get({ url: '/x', handler })
const FASTIFY_OBJ_RE = new RegExp(
  `\\b([A-Za-z_][A-Za-z0-9_]*)\\.(${METHODS})\\s*\\(\\s*\\{[^}]*?url\\s*:\\s*['"]([^'"]+)['"][^}]*?\\}`,
  'g',
);

// Hono: app.get('/x', (c) => ...) — same shape as Express; handled by
// EXPRESS_RE when the handler is a named identifier. Inline arrow
// functions are skipped intentionally (no stable symbol to link to).

function parseHandlerArgs(argsTail) {
  // Split on commas at depth 0. Returns the list of top-level tokens.
  const tokens = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsTail.length; i += 1) {
    const c = argsTail[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      tokens.push(argsTail.slice(start, i).trim());
      start = i + 1;
    }
  }
  tokens.push(argsTail.slice(start).trim());
  return tokens.filter(Boolean);
}

// Extract the identifier from a token (drops call-expression tails,
// returns null for arrow fns / anonymous literals).
function identOf(token) {
  const inline = /^(async\s+)?\(?\s*[a-zA-Z_$][\w$,\s]*\)?\s*=>/;
  if (inline.test(token)) return null;
  // Take the leading bare identifier; drop anything after '(' or '.'.
  const m = token.match(/^([A-Za-z_$][\w$]*)/);
  return m ? m[1] : null;
}

function lineOfOffset(content, offset) {
  return (content.slice(0, offset).match(/\n/g) || []).length + 1;
}

function extractExpressStyleRoutes(content, rp) {
  const out = [];
  const seen = new Set();
  for (const m of content.matchAll(EXPRESS_RE)) {
    const method = m[2].toUpperCase();
    if (method === 'USE') continue; // `app.use('/x', mw)` — not a route by itself
    const path = m[3];
    const tokens = parseHandlerArgs(m[4]).map(identOf).filter(Boolean);
    if (tokens.length === 0) continue;
    const handler = tokens.at(-1);
    const middlewares = tokens.slice(0, -1);
    const key = `${method}|${path}|${handler}|${rp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method, path, handler, middlewares, line: lineOfOffset(content, m.index), file: rp });
  }
  for (const m of content.matchAll(FASTIFY_OBJ_RE)) {
    const method = m[2].toUpperCase();
    const path = m[3];
    // Handler name must be resolved from the object body; skip if opaque.
    out.push({ method, path, handler: 'handler', middlewares: [], line: lineOfOffset(content, m.index), file: rp });
  }
  return out;
}

export const nodeWebPlugin = createFrameworkPlugin({
  name: 'node-web',

  async detect({ repoRoot }) {
    const raw = await tryReadFile(`${repoRoot}/package.json`);
    if (!raw) return false;
    try {
      const pkg = JSON.parse(raw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return ['express', 'koa', 'fastify', 'hono', '@hono/node-server'].some((name) => name in deps);
    } catch { return false; }
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const files = await walkFiles(repoRoot, ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);

    for (const abs of files) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      if (!/\.(get|post|put|patch|delete|head|options|all)\s*\(/.test(content)) continue;
      const rp = relPath(repoRoot, abs);
      const lang = /\.(ts|mts|cts)$/.test(abs) ? 'typescript' : 'javascript';

      for (const r of extractExpressStyleRoutes(content, rp)) {
        const label = `${r.method} ${r.path}`;
        const node = routeNode({ filePath: rp, label, language: lang, startLine: r.line });
        nodes.push(node);
        refs.push(invokesRef({
          node, target: r.handler, extractor: 'node-web',
          sourceFile: rp, sourceLine: r.line,
        }));
        // Middleware chain: route → mw1 → mw2 → handler (PASSES_THROUGH).
        if (r.middlewares.length > 0) {
          refs.push({
            from_id: node.id, from_label: node.label,
            relation: 'PASSES_THROUGH', target: r.middlewares[0],
            source_file: rp, source_line: r.line,
            confidence: 0.72, provenance: 'INFERRED', extractor: 'node-web',
          });
          for (let i = 0; i < r.middlewares.length - 1; i += 1) {
            refs.push({
              from_target: r.middlewares[i], from_label: r.middlewares[i],
              relation: 'PASSES_THROUGH', target: r.middlewares[i + 1],
              source_file: rp, source_line: r.line,
              confidence: 0.72, provenance: 'INFERRED', extractor: 'node-web',
            });
          }
          refs.push({
            from_target: r.middlewares.at(-1), from_label: r.middlewares.at(-1),
            relation: 'PASSES_THROUGH', target: r.handler,
            source_file: rp, source_line: r.line,
            confidence: 0.72, provenance: 'INFERRED', extractor: 'node-web',
          });
        }
      }
    }
    return { nodes, edges: result.edges, refs };
  },
});
