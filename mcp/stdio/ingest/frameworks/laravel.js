import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stableId } from '../identity/stable-id.js';
import { createFrameworkPlugin } from '../extractors/base.js';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import phpConfig from '../languages/php.js';
import { readRouteDefinitions } from './_laravel_route_ast.js';


function routeNode(filePath, label) {
  const qname = `route:${filePath}:${label}`;
  return {
    id: stableId(['Route', filePath, qname]),
    type: 'Route',
    label,
    file_path: filePath,
    start_line: 1,
    end_line: 1,
    language: 'php',
    confidence: 0.75,
    structural_fp: structuralFingerprint({
      qname,
      signature: '',
      decorators: [],
      parentClass: '',
      nodeType: 'Route',
    }),
    dependency_fp: dependencyFingerprint({
      outgoing: { calls: [], references: [], usesTypes: [], imports: [] },
    }),
    extra: { qname },
  };
}

function extractArrayProperty(content, propertyNames) {
  for (const property of propertyNames) {
    const marker = `$${property}`;
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) continue;
    const start = content.indexOf('[', markerIndex);
    if (start === -1) continue;
    let depth = 0;
    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (char === '[') depth += 1;
      if (char === ']') {
        depth -= 1;
        if (depth === 0) return content.slice(start + 1, index);
      }
    }
  }
  return '';
}

function extractArrayLiteral(text, startIndex) {
  const start = text.indexOf('[', startIndex);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: text.slice(start + 1, index),
          end: index + 1,
        };
      }
    }
  }
  return null;
}

function parseAliasMap(block) {
  const aliases = new Map();
  for (const match of block.matchAll(/['"]([^'"]+)['"]\s*=>\s*([^,\n]+),?/gu)) {
    aliases.set(match[1], match[2].trim());
  }
  return aliases;
}

function parseGroupMap(block) {
  const groups = new Map();
  const groupKeyPattern = /['"]([^'"]+)['"]\s*=>\s*\[/gu;
  let match;
  while ((match = groupKeyPattern.exec(block)) !== null) {
    const extracted = extractArrayLiteral(block, match.index + match[0].lastIndexOf('['));
    if (!extracted) continue;
    groups.set(match[1], extracted.body);
    groupKeyPattern.lastIndex = match.index + match[0].lastIndexOf('[') + extracted.body.length + 2;
  }
  return groups;
}

// ⛔ THE `::class` MARKER IS THE ONLY THING THAT DISTINGUISHES A CLASS TOKEN FROM AN ALIAS STRING,
// AND STRIPPING IT HERE THREW THAT AWAY. Both kinds land in one flat list, so a bare
// `Route::middleware([Authenticate::class])` — the ordinary Laravel idiom, with the class imported
// at the top of the file — arrived at `normalizeMiddlewareTarget` as plain `Authenticate`. That
// function recognises a class only by a backslash or a `::class` suffix, so the token matched
// neither, fell through to `[]`, and the whole middleware chain was silently dropped.
//
// ⭐ MEASURED, four configurations, in one pass:
//     bare Foo::class, no Kernel            -> 0 chain refs   <- the defect
//     fully-qualified \App\...::class       -> 3
//     string aliases + Kernel alias map     -> 3
//     string aliases, NO Kernel (CONTROL)   -> 0   <- CORRECT: without an alias map 'auth' is
//                                                     genuinely unresolvable, and must stay so
//
// The first and last both produced zero for completely different reasons, which is exactly why the
// control matters: it is what shows the zero is a defect rather than honest ignorance.
function parseMiddlewareTokens(expression) {
  const tokens = [];
  for (const match of expression.matchAll(/['"]([^'"]+)['"]/gu)) tokens.push(match[1]);
  // ⚠ Keep the suffix. `classBaseName` strips it again downstream, so nothing else has to change.
  for (const match of expression.matchAll(/([\\A-Za-z_][\\A-Za-z0-9_]*)::class/gu)) tokens.push(`${match[1]}::class`);
  return [...new Set(tokens)];
}

function classBaseName(value) {
  return String(value ?? '')
    .replace(/::class$/u, '')
    .replace(/^\\+/u, '')
    .split('\\')
    .pop()
    ?.trim() ?? '';
}

function normalizeMiddlewareTarget(token, aliases, groups, seen = new Set()) {
  const normalized = String(token ?? '').trim();
  if (!normalized) return [];

  const aliasKey = normalized.split(':')[0];
  if (groups.has(aliasKey)) {
    if (seen.has(aliasKey)) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(aliasKey);
    return parseMiddlewareTokens(groups.get(aliasKey))
      .flatMap((entry) => normalizeMiddlewareTarget(entry, aliases, groups, nextSeen));
  }

  if (aliases.has(aliasKey)) {
    const className = classBaseName(aliases.get(aliasKey));
    return className ? [`${className}.handle`] : [];
  }

  if (normalized.includes('\\') || normalized.endsWith('::class')) {
    const className = classBaseName(normalized);
    return className ? [`${className}.handle`] : [];
  }

  return [];
}

// Every route a route file registers, read from its syntax tree (_laravel_route_ast.js, #5), with the middleware group
// Laravel applies to the file by convention ahead of the route's own.
function routeDefinitionsOf(content, routeFile) {
  const conventionalGroups = { 'api.php': ['api'], 'web.php': ['web'] }[routeFile] ?? [];
  return readRouteDefinitions({ source: content, config: phpConfig, middlewareTokens: parseMiddlewareTokens })
    .map((definition) => ({ ...definition, middleware: [...conventionalGroups, ...definition.middleware] }));
}

function parseKernelConfig(content) {
  const aliases = parseAliasMap(extractArrayProperty(content, ['routeMiddleware', 'middlewareAliases']));
  const groups = parseGroupMap(extractArrayProperty(content, ['middlewareGroups']));
  return { aliases, groups };
}

export const laravelRoutesPlugin = createFrameworkPlugin({
  name: 'laravel-routes',

  async detect({ repoRoot }) {
    try {
      const composerJson = await readFile(join(repoRoot, 'composer.json'), 'utf8');
      return composerJson.includes('"laravel/framework"');
    } catch {
      return false;
    }
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];
    const routesDir = join(repoRoot, 'routes');

    let kernelConfig = { aliases: new Map(), groups: new Map() };
    try {
      const kernelContent = await readFile(join(repoRoot, 'app', 'Http', 'Kernel.php'), 'utf8');
      kernelConfig = parseKernelConfig(kernelContent);
    } catch {
      // No Kernel.php — route invoke refs still work.
    }

    let routeFiles = [];
    try {
      routeFiles = (await readdir(routesDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.php'))
        .map((entry) => entry.name);
    } catch {
      return result;
    }

    for (const routeFile of routeFiles) {
      const relPath = `routes/${routeFile}`;
      const content = await readFile(join(routesDir, routeFile), 'utf8');
      for (const definition of routeDefinitionsOf(content, routeFile)) {
        const label = `${definition.method} ${definition.path}`;
        const node = routeNode(relPath, label);
        nodes.push(node);

        // A closure or view route is a route with no controller: it gets a node and its middleware, never a guessed target.
        const controllerQname = definition.controller ? `${definition.controller}.${definition.action}` : null;
        if (controllerQname) refs.push({
          from_id: node.id,
          from_label: node.label,
          relation: 'INVOKES',
          target: controllerQname,
          source_file: relPath,
          source_line: definition.line,
          confidence: 0.75,
          provenance: 'INFERRED',
          // ⚠ Carried explicitly so this plugin no longer depends on the legacy
          // ['laravel','php'] entry in the resolver language map.
          language: 'php',
          extractor: 'laravel',
        });

        const middlewareTargets = definition.middleware
          .flatMap((entry) => normalizeMiddlewareTarget(entry, kernelConfig.aliases, kernelConfig.groups))
          .filter(Boolean);

        if (middlewareTargets.length === 0) {
          continue;
        }

        refs.push({
          from_id: node.id,
          from_label: node.label,
          relation: 'PASSES_THROUGH',
          target: middlewareTargets[0],
          source_file: relPath,
          source_line: 1,
          confidence: 0.72,
          provenance: 'INFERRED',
          // ⚠ Carried explicitly so this plugin no longer depends on the legacy
          // ['laravel','php'] entry in the resolver language map.
          language: 'php',
          extractor: 'laravel',
        });

        for (let index = 0; index < middlewareTargets.length - 1; index += 1) {
          refs.push({
            from_target: middlewareTargets[index],
            from_label: classBaseName(middlewareTargets[index]),
            relation: 'PASSES_THROUGH',
            target: middlewareTargets[index + 1],
            source_file: relPath,
            source_line: 1,
            confidence: 0.72,
            provenance: 'INFERRED',
            extractor: 'laravel',
            // ⚠ Carried explicitly so this plugin no longer depends on the legacy
            // ['laravel','php'] entry in the resolver language map.
            language: 'php',
          });
        }

        if (controllerQname) refs.push({
          from_target: middlewareTargets.at(-1),
          from_label: classBaseName(middlewareTargets.at(-1)),
          relation: 'PASSES_THROUGH',
          target: controllerQname,
          source_file: relPath,
          source_line: 1,
          confidence: 0.72,
          provenance: 'INFERRED',
          // ⚠ Carried explicitly so this plugin no longer depends on the legacy
          // ['laravel','php'] entry in the resolver language map.
          language: 'php',
          extractor: 'laravel',
        });
      }
    }

    return {
      nodes,
      edges: result.edges,
      refs,
    };
  },
});
