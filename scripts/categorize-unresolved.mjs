#!/usr/bin/env node
// Categorize unresolved refs from the authoritative unresolved set.
//
// Usage:
//   node scripts/categorize-unresolved.mjs <repoRoot>
//
// Output: text report to stdout, JSON at .aify-graph/unresolved-categorization.json

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildUnresolvedCategorization, renderUnresolvedCategorizationReport, writeUnresolvedCategorization } from '../mcp/stdio/freshness/unresolved-categorization.js';

const [, , repoArg] = process.argv;
if (!repoArg) {
  console.error('usage: categorize-unresolved.mjs <repoRoot>');
  process.exit(2);
}
const repoRoot = resolve(repoArg);
const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest at ${manifestPath}`);
  process.exit(3);
}
const preview = await buildUnresolvedCategorization({ repoRoot });
console.log(renderUnresolvedCategorizationReport(preview));
const written = await writeUnresolvedCategorization({ repoRoot });
console.log('');
console.log(`Wrote ${written.path}`);
