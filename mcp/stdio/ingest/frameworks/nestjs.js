// NestJS plugin: decorator-based controller routes.
//
// @Controller('users')                      ← class prefix
// export class UsersController {
//   @Get(':id')
//   findOne(@Param('id') id: string) { }    ← emits GET /users/:id → findOne
// }
//
// Also captures @UseGuards / @UseInterceptors / @UsePipes on the
// controller class or method as PASSES_THROUGH hops.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, routeNode, invokesRef } from './_plugin_utils.js';

const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'];

function extractControllers(content) {
  // Find every @Controller('prefix') export class Foo { ... } block.
  // We slice the class body by brace matching.
  const controllers = [];
  const re = /@Controller\s*\(\s*(?:['"]([^'"]*)['"])?\s*\)[\s\S]*?(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const prefix = m[1] || '';
    const className = m[2];
    const classStart = content.indexOf('{', m.index + m[0].length);
    if (classStart === -1) continue;
    let depth = 0;
    let classEnd = -1;
    for (let i = classStart; i < content.length; i += 1) {
      if (content[i] === '{') depth += 1;
      else if (content[i] === '}') {
        depth -= 1;
        if (depth === 0) { classEnd = i; break; }
      }
    }
    if (classEnd === -1) continue;
    controllers.push({
      className, prefix,
      body: content.slice(classStart + 1, classEnd),
      offsetInFile: classStart + 1,
    });
  }
  return controllers;
}

function extractClassGuards(content, classOffset) {
  // Scan backwards from the class keyword for stacked @UseGuards decorators.
  const window = content.slice(Math.max(0, classOffset - 500), classOffset);
  const guards = [];
  for (const m of window.matchAll(/@Use(Guards|Interceptors|Pipes|Filters)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\)/g)) {
    guards.push(...m[2].split(',').map((s) => s.trim()));
  }
  return guards;
}

function extractMethodsFromBody(body, classPrefix, file, controllerOffset, content) {
  const routes = [];
  // Loop each HTTP decorator inside the class body, then find the method
  // name on the next non-decorator line.
  const deco = new RegExp(
    `@(${HTTP_DECORATORS.join('|')})\\s*\\(\\s*(?:['"]([^'"]*)['"])?\\s*\\)`,
    'g',
  );
  let m;
  while ((m = deco.exec(body)) !== null) {
    const method = m[1].toUpperCase();
    const pathSuffix = m[2] || '';
    const afterDecorator = body.slice(m.index + m[0].length);
    // Jump over intervening decorators/annotations to find `methodName(`.
    const methodMatch = afterDecorator.match(/(?:^\s*@[^\n]*\n)*\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!methodMatch) continue;
    const handler = methodMatch[1];

    // Method-level guards (between @Get and the method name)
    const betweenStart = m.index + m[0].length;
    const betweenEnd = betweenStart + afterDecorator.indexOf(handler);
    const between = body.slice(betweenStart, betweenEnd);
    const guards = [];
    for (const g of between.matchAll(/@Use(Guards|Interceptors|Pipes|Filters)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\)/g)) {
      guards.push(...g[2].split(',').map((s) => s.trim()));
    }

    // Full path = /prefix/suffix with single-slash normalization.
    const path = `/${[classPrefix, pathSuffix].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
    const absoluteOffset = controllerOffset + m.index;
    routes.push({
      method, path, handler, guards,
      line: (content.slice(0, absoluteOffset).match(/\n/g) || []).length + 1,
      file,
    });
  }
  return routes;
}

export const nestjsPlugin = createFrameworkPlugin({
  name: 'nestjs',

  async detect({ repoRoot }) {
    const raw = await tryReadFile(`${repoRoot}/package.json`);
    if (!raw) return false;
    try {
      const pkg = JSON.parse(raw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return ['@nestjs/core', '@nestjs/common'].some((n) => n in deps);
    } catch { return false; }
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const files = await walkFiles(repoRoot, ['.ts', '.js']);

    for (const abs of files) {
      const content = await tryReadFile(abs);
      if (!content || !content.includes('@Controller')) continue;
      const rp = relPath(repoRoot, abs);
      for (const ctrl of extractControllers(content)) {
        const classGuards = extractClassGuards(content, ctrl.offsetInFile);
        for (const r of extractMethodsFromBody(ctrl.body, ctrl.prefix, rp, ctrl.offsetInFile, content)) {
          const label = `${r.method} ${r.path}`;
          const node = routeNode({ filePath: rp, label, language: 'typescript', startLine: r.line });
          nodes.push(node);
          refs.push(invokesRef({
            node, target: r.handler, extractor: 'nestjs',
            sourceFile: rp, sourceLine: r.line,
          }));

          const chain = [...classGuards, ...r.guards];
          if (chain.length === 0) continue;
          refs.push({
            from_id: node.id, from_label: node.label,
            relation: 'PASSES_THROUGH', target: chain[0],
            source_file: rp, source_line: r.line,
            confidence: 0.72, provenance: 'INFERRED', extractor: 'nestjs',
          });
          for (let i = 0; i < chain.length - 1; i += 1) {
            refs.push({
              from_target: chain[i], from_label: chain[i],
              relation: 'PASSES_THROUGH', target: chain[i + 1],
              source_file: rp, source_line: r.line,
              confidence: 0.72, provenance: 'INFERRED', extractor: 'nestjs',
            });
          }
          refs.push({
            from_target: chain.at(-1), from_label: chain.at(-1),
            relation: 'PASSES_THROUGH', target: r.handler,
            source_file: rp, source_line: r.line,
            confidence: 0.72, provenance: 'INFERRED', extractor: 'nestjs',
          });
        }
      }
    }
    return { nodes, edges: result.edges, refs };
  },
});
