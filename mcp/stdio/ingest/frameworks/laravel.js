import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
  }));
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
      for (const definition of parseRouteDefinitions(content)) {
        const label = `${definition.method} ${definition.path}`;
        const node = routeNode(relPath, label);
        nodes.push(node);
        refs.push({
          from_id: node.id,
          from_label: node.label,
          relation: 'INVOKES',
          target: `${definition.controller}.${definition.action}`,
          source_file: relPath,
          source_line: 1,
          confidence: 0.75,
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
