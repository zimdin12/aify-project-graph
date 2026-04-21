#!/usr/bin/env node
// Categorize unresolved refs from a repo's manifest.json.
// Informs the resolution-pass investigation (task #94) by splitting refs
// into fixable vs external-by-design buckets.
//
// Usage:
//   node scripts/categorize-unresolved.mjs <repoRoot>
//
// Output: text report to stdout, JSON at .aify-graph/unresolved-categorization.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const refs = manifest.dirtyEdges ?? [];

if (refs.length === 0) {
  console.log('No unresolved refs. TRUST=ok territory.');
  process.exit(0);
}

// Classification rules — order matters (first match wins).
//
// external-by-design: we cannot resolve these without ingesting outside
//   code (node built-ins, npm packages, OS syscalls). Fixing these would
//   require indexing third-party source, which blows up the graph.
//
// fixable: target SHOULD be in the graph but the resolver didn't find it.
//   These are the real investigation bucket.
//
// shape-issue: extractor emitted a nonsense target (empty string, operator
//   characters, etc.). Upstream extractor bug.
const CLASSIFIERS = [
  {
    bucket: 'external-by-design:node-builtin',
    test: (r) => /^(node:|assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|process|stream|url|util|zlib)(\.|$)/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:npm',
    // heuristic: target starts with lowercase ident, no slash, no dot
    // Likely a package name. Real fix would be to index node_modules, not
    // cheap — leave as external-by-design for v1.
    test: (r) => r.extractor === 'javascript' || r.extractor === 'typescript'
      ? /^[a-z@][a-z0-9@/_.-]*$/.test((r.target || '').split('.')[0]) && !(r.target || '').includes('/')
      : false,
  },
  {
    bucket: 'external-by-design:python-stdlib',
    test: (r) => r.extractor === 'python'
      && /^(os|sys|re|json|math|time|datetime|typing|collections|functools|itertools|logging|pathlib|unittest|pytest|asyncio|subprocess|threading|socket|abc|dataclasses|enum|warnings|contextlib|io)(\.|$)/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:pip',
    test: (r) => r.extractor === 'python' && !(r.target || '').includes('/') && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:cpp-system',
    test: (r) => r.extractor === 'cpp' || r.extractor === 'c'
      ? /^(std|boost|glm|vk|vma|vulkan|<|\w+\.h)/.test(r.target || '')
      : false,
  },
  {
    bucket: 'external-by-design:php-framework',
    test: (r) => (r.extractor === 'php' || r.extractor === 'laravel')
      && /^(Illuminate|Symfony|Laravel|Eloquent|DB|Cache|Log|Auth|Queue|Event)(\.|$|\\)/.test(r.target || ''),
  },
  {
    bucket: 'shape-issue:empty-target',
    test: (r) => !r.target || r.target.trim() === '',
  },
  {
    bucket: 'shape-issue:operator-only',
    test: (r) => /^[()[\]{}<>+\-*/=!?:;,.$#@&|^~%\s`'"]+$/.test(r.target || ''),
  },
  {
    bucket: 'fixable:call-short-name',
    // target is a bare identifier (no dots). For CALLS relation this means
    // the resolver couldn't match the name to any node. Likely fixable by
    // index improvements or extractor disambiguation.
    test: (r) => r.relation === 'CALLS' && !(r.target || '').includes('.') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.target || ''),
  },
  {
    bucket: 'fixable:reference-short-name',
    test: (r) => r.relation === 'REFERENCES' && !(r.target || '').includes('.') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.target || ''),
  },
  {
    bucket: 'fixable:qualified-path',
    test: (r) => (r.target || '').includes('.') || (r.target || '').includes('/'),
  },
  {
    bucket: 'unclassified',
    test: () => true,
  },
];

function classify(ref) {
  for (const c of CLASSIFIERS) {
    if (c.test(ref)) return c.bucket;
  }
  return 'unclassified';
}

const buckets = {};
const samplesByBucket = {};
for (const ref of refs) {
  const b = classify(ref);
  buckets[b] = (buckets[b] ?? 0) + 1;
  if (!samplesByBucket[b]) samplesByBucket[b] = [];
  if (samplesByBucket[b].length < 5) {
    samplesByBucket[b].push({
      relation: ref.relation,
      target: ref.target,
      file: ref.source_file,
      line: ref.source_line,
      extractor: ref.extractor,
    });
  }
}

const total = refs.length;
const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
const fixable = sorted.filter(([k]) => k.startsWith('fixable:')).reduce((s, [, n]) => s + n, 0);
const external = sorted.filter(([k]) => k.startsWith('external-by-design:')).reduce((s, [, n]) => s + n, 0);
const shapeIssues = sorted.filter(([k]) => k.startsWith('shape-issue:')).reduce((s, [, n]) => s + n, 0);
const unclassified = sorted.filter(([k]) => k === 'unclassified').reduce((s, [, n]) => s + n, 0);

console.log(`Repo: ${repoRoot}`);
console.log(`Total unresolved refs sampled: ${total}${total >= 500 ? '  (CAPPED at 500 — manifest cap)' : ''}`);
console.log(`  external-by-design: ${external} (${pct(external, total)})`);
console.log(`  fixable:            ${fixable} (${pct(fixable, total)})`);
console.log(`  shape-issue:        ${shapeIssues} (${pct(shapeIssues, total)})`);
console.log(`  unclassified:       ${unclassified} (${pct(unclassified, total)})`);
console.log('');
console.log('Per-bucket breakdown:');
for (const [bucket, count] of sorted) {
  console.log(`  ${count.toString().padStart(4)} ${bucket}`);
  for (const s of samplesByBucket[bucket].slice(0, 3)) {
    console.log(`         · ${s.relation} "${s.target}" [${s.extractor}] at ${s.file}:${s.line}`);
  }
}

const output = {
  repoRoot,
  total,
  capped: total >= 500,
  summary: { external, fixable, shapeIssues, unclassified },
  buckets: Object.fromEntries(sorted),
  samples: samplesByBucket,
};
const outPath = join(repoRoot, '.aify-graph', 'unresolved-categorization.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log('');
console.log(`Wrote ${outPath}`);

function pct(n, total) {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}
