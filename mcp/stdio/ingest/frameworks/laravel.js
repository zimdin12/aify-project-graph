import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createFrameworkPlugin } from '../extractors/base.js';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';

function stableId(parts) {
  return createHash('sha1').update(parts.join('::')).digest('hex');
}

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

function parseRouteDefinitions(content) {
  const matches = [...content.matchAll(/Route::([A-Za-z_]+)\(\s*['"]([^'"]+)['"]\s*,\s*\[([A-Za-z_][A-Za-z0-9_]*)::class\s*,\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]\s*\)/gu)];
  return matches.map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2],
    controller: match[3],
    action: match[4],
    middleware: [],
  }));
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

function parseMiddlewareTokens(expression) {
  const tokens = [];
  for (const match of expression.matchAll(/['"]([^'"]+)['"]/gu)) tokens.push(match[1]);
  for (const match of expression.matchAll(/([\\A-Za-z_][\\A-Za-z0-9_]*)::class/gu)) tokens.push(match[1]);
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

function parseMiddlewareContext(content, routeFile) {
  const conventionalGroups = [];
  if (routeFile === 'api.php') conventionalGroups.push('api');
  if (routeFile === 'web.php') conventionalGroups.push('web');

  const groupedDefinitions = [];
  const consumedRanges = [];

  const groupedPattern = /Route::middleware\(([\s\S]*?)\)\s*->group\(function\s*\(\)\s*(?::\s*[^({]+)?\s*\{([\s\S]*?)\}\s*\);/gu;
  let match;
  while ((match = groupedPattern.exec(content)) !== null) {
    const middleware = [...conventionalGroups, ...parseMiddlewareTokens(match[1])];
    groupedDefinitions.push(...parseRouteDefinitions(match[2]).map((definition) => ({
      ...definition,
      middleware,
    })));
    consumedRanges.push([match.index, match.index + match[0].length]);
  }

  const inlinePattern = /Route::middleware\(([\s\S]*?)\)\s*->([A-Za-z_]+)\(\s*['"]([^'"]+)['"]\s*,\s*\[([A-Za-z_][A-Za-z0-9_]*)::class\s*,\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]\s*\)/gu;
  while ((match = inlinePattern.exec(content)) !== null) {
    groupedDefinitions.push({
      method: match[2].toUpperCase(),
      path: match[3],
      controller: match[4],
      action: match[5],
      middleware: [...conventionalGroups, ...parseMiddlewareTokens(match[1])],
    });
    consumedRanges.push([match.index, match.index + match[0].length]);
  }

  const remaining = consumedRanges.length === 0
    ? content
    : consumedRanges
      .sort((a, b) => a[0] - b[0])
      .reduce((acc, [start, end], index, ranges) => {
        const prevEnd = index === 0 ? 0 : ranges[index - 1][1];
        return acc + content.slice(prevEnd, start) + ' '.repeat(end - start);
      }, '')
      + content.slice(consumedRanges.at(-1)?.[1] ?? 0);

  return [
    ...groupedDefinitions,
    ...parseRouteDefinitions(remaining).map((definition) => ({
      ...definition,
      middleware: [...conventionalGroups],
    })),
  ];
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
      for (const definition of parseMiddlewareContext(content, routeFile)) {
        const label = `${definition.method} ${definition.path}`;
        const node = routeNode(relPath, label);
        nodes.push(node);

        const controllerQname = `${definition.controller}.${definition.action}`;
        refs.push({
          from_id: node.id,
          from_label: node.label,
          relation: 'INVOKES',
          target: controllerQname,
          source_file: relPath,
          source_line: 1,
          confidence: 0.75,
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
            extractor: 'laravel',
          });
        }

        refs.push({
          from_target: middlewareTargets.at(-1),
          from_label: classBaseName(middlewareTargets.at(-1)),
          relation: 'PASSES_THROUGH',
          target: controllerQname,
          source_file: relPath,
          source_line: 1,
          confidence: 0.72,
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
