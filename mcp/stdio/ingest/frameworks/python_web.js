// Python web framework plugin: FastAPI + Flask.
//
// Emits Route nodes for decorator-based routes and INVOKES edges from
// each route to its handler function. Also emits PASSES_THROUGH edges
// for FastAPI `Depends(fn)` annotations, which are the idiomatic DI
// hook agents need to trace to understand request flow.
//
// Shape-identical to laravel.js so downstream verbs (graph_path,
// graph_consequences, graph_impact) treat the outputs the same way.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

function extractFastApiRoutes(content, file) {
  // @app.get("/x"), @router.post("/y", ...), @app.api_route("/z", methods=[...])
  const routes = [];
  const lines = content.split('\n');
  const decoratorRe = /@([A-Za-z_][A-Za-z0-9_]*)\.(get|post|put|patch|delete|head|options|api_route)\s*\(\s*['"]([^'"]+)['"]/;

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(decoratorRe);
    if (!m) continue;
    const method = m[2] === 'api_route' ? 'ANY' : m[2].toUpperCase();
    const path = m[3];
    // Find next `def` for the handler name. Decorators stack, so skip
    // intervening decorator lines.
    for (let j = i + 1; j < Math.min(lines.length, i + 20); j += 1) {
      const stripped = lines[j].trim();
      if (stripped.startsWith('@')) continue;
      const defMatch = stripped.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (defMatch) {
        routes.push({
          method, path, handler: defMatch[1], line: i + 1, file,
          framework: 'fastapi',
        });
        break;
      }
      if (stripped.length > 0) break; // non-decorator, non-blank, non-def — give up
    }
  }
  return routes;
}

function extractFlaskRoutes(content, file) {
  // @app.route('/x', methods=['GET','POST']) or @blueprint.route('/y')
  const routes = [];
  const lines = content.split('\n');
  const decoratorRe = /@([A-Za-z_][A-Za-z0-9_]*)\.(route|get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]([^)]*)\)/;

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(decoratorRe);
    if (!m) continue;
    const verb = m[2];
    const path = m[3];
    const tail = m[4] || '';
    let methods;
    if (verb === 'route') {
      const mm = tail.match(/methods\s*=\s*\[([^\]]*)\]/);
      methods = mm
        ? [...mm[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1].toUpperCase())
        : ['GET'];
    } else {
      methods = [verb.toUpperCase()];
    }
    for (let j = i + 1; j < Math.min(lines.length, i + 20); j += 1) {
      const stripped = lines[j].trim();
      if (stripped.startsWith('@')) continue;
      const defMatch = stripped.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (defMatch) {
        for (const method of methods) {
          routes.push({
            method, path, handler: defMatch[1], line: i + 1, file,
            framework: 'flask',
          });
        }
        break;
      }
      if (stripped.length > 0) break;
    }
  }
  return routes;
}

// FastAPI `def handler(db: Session = Depends(get_db))` — the dependency
// target is a function whose handler passes through. Emit PASSES_THROUGH
// so graph_path can trace request flow through DI.
function extractDepends(content) {
  const out = [];
  // Matches `Depends(identifier)` — captures the identifier only.
  const re = /Depends\(\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push(m[1]);
  }
  return out;
}

// Locate the enclosing def for a byte offset — used to bind Depends()
// calls to the handler they live inside.
function enclosingDefName(content, offset) {
  const slice = content.slice(0, offset);
  const lastDef = slice.lastIndexOf('def ');
  if (lastDef === -1) return null;
  const rest = content.slice(lastDef + 4);
  const m = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] : null;
}

function dependsEdgesForHandler(content, handlerName, file, extractor) {
  const out = [];
  const re = /Depends\(\s*([A-Za-z_][A-Za-z0-9_\.]*)\s*\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const encl = enclosingDefName(content, m.index);
    if (encl !== handlerName) continue;
    out.push({
      from_label: handlerName,
      from_target: handlerName,
      relation: 'PASSES_THROUGH',
      target: m[1].split('.').pop(),
      source_file: file,
      source_line: (content.slice(0, m.index).match(/\n/g) || []).length + 1,
      confidence: 0.72,
      provenance: 'INFERRED',
      extractor,
    });
  }
  return out;
}

export const pythonWebPlugin = createFrameworkPlugin({
  name: 'python-web',

  async detect({ repoRoot }) {
    for (const f of ['requirements.txt', 'pyproject.toml', 'Pipfile']) {
      const raw = await tryReadFile(`${repoRoot}/${f}`);
      if (raw && /fastapi|flask/i.test(raw)) return true;
    }
    return false;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const files = await walkFiles(repoRoot, ['.py']);

    for (const abs of files) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      const rp = relPath(repoRoot, abs);
      if (!/(fastapi|flask|Blueprint)/.test(content)) continue;

      const routes = [
        ...extractFastApiRoutes(content, rp),
        ...extractFlaskRoutes(content, rp),
      ];

      for (const r of routes) {
        const label = `${r.method} ${r.path}`;
        const node = routeNode({ filePath: r.file, label, language: 'python', startLine: r.line, confidence: 0.75 });
        nodes.push(node);
        refs.push(invokesRef({
          node, target: r.handler, extractor: 'python-web',
          sourceFile: r.file, sourceLine: r.line, confidence: 0.75,
        }));
        if (r.framework === 'fastapi') {
          refs.push(...dependsEdgesForHandler(content, r.handler, r.file, 'python-web'));
        }
      }
    }

    return { nodes, edges: result.edges, refs };
  },
});
