import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDirtyEdgesSidecar } from './dirty-edges-sidecar.js';
import { loadManifest } from './manifest.js';
import { readJsonCappedSafe } from '../util/json.js';
import { COMMON_NAMES, JS_RUNTIME_GLOBALS } from '../ingest/denylist.js';

const CLASSIFIERS = [
  {
    bucket: 'external-by-design:node-builtin',
    test: (r) => r.relation === 'IMPORTS'
      && /^(node:[A-Za-z0-9_./-]+|assert|buffer|child_process|crypto|events|fs|http|https|net|os|path|process|stream|url|util|zlib)(\.|$)/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:npm',
    // Audit 2026-06-12: the old regex `^[a-z@][a-z0-9@/_.-]*$` allowed `/`, so a
    // normalized intra-repo import target like `mcp/stdio/code-intel/...` matched
    // and a genuinely-fixable edge was hidden in the external bucket. An npm
    // specifier is either bare (`react`, no slash) or scoped (`@scope/name` —
    // exactly scope + one segment); a repo path has `/` without an `@` scope.
    test: (r) => {
      if (!(r.extractor === 'javascript' || r.extractor === 'typescript') || r.relation !== 'IMPORTS') return false;
      const head = (r.target || '').split('.')[0];
      if (!head) return false;
      if (head.includes('/')) return /^@[a-z0-9._~-]+\/[a-z0-9._~-]+$/.test(head);
      return /^[a-z@][a-z0-9@_.-]*$/.test(head);
    },
  },
  {
    bucket: 'external-by-design:python-stdlib',
    test: (r) => r.extractor === 'python' && r.relation === 'IMPORTS'
      && /^(os|sys|re|json|math|time|datetime|typing|collections|functools|itertools|logging|pathlib|unittest|pytest|asyncio|subprocess|threading|socket|abc|dataclasses|enum|warnings|contextlib|io)(\.|$)/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:pip',
    test: (r) => r.extractor === 'python' && r.relation === 'IMPORTS' && !(r.target || '').includes('/') && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(r.target || ''),
  },
  {
    bucket: 'external-by-design:cpp-system',
    test: (r) => (r.extractor === 'cpp' || r.extractor === 'c')
      ? /^(std|boost|glm|vk|vma|vulkan|<|\w+\.h)/.test(r.target || '')
      : false,
  },
  {
    bucket: 'external-by-design:php-framework',
    test: (r) => (r.extractor === 'php' || r.extractor === 'laravel')
      && /^(Illuminate|Symfony|Laravel|Eloquent|DB|Cache|Log|Auth|Queue|Event)(\.|$|\\)/.test(r.target || ''),
  },
  {
    bucket: 'shape-issue:contains-missing-target',
    test: (r) => r.relation === 'CONTAINS' && (!r.target || r.target.trim() === ''),
  },
  {
    bucket: 'shape-issue:empty-target',
    test: (r) => !r.target || r.target.trim() === '',
  },
  {
    bucket: 'shape-issue:operator-only',
    test: (r) => /^[()[\]{}<>+\-*/=!?:;,.$#@&|^~%\s`'"]+$/.test(r.target || ''),
  },
  // Audit 2026-06-12: route targets the resolver refuses BY DESIGN to a
  // denylisted bucket BEFORE the fixable shapes below, so the scoreboard stops
  // counting `parse`/`log`/`__dirname` as actionable. Shares the exact list with
  // the resolver (ingest/denylist.js) so the two can't drift.
  {
    bucket: 'denylisted-by-design:common-name',
    test: (r) => (r.relation === 'CALLS' || r.relation === 'REFERENCES')
      && !(r.target || '').includes('.') && COMMON_NAMES.has(r.target || ''),
  },
  {
    bucket: 'denylisted-by-design:js-global',
    test: (r) => (r.relation === 'CALLS' || r.relation === 'REFERENCES')
      && !(r.target || '').includes('.') && JS_RUNTIME_GLOBALS.has(r.target || ''),
  },
  {
    bucket: 'fixable:call-short-name',
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

function pct(n, total) {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

export function classifyUnresolvedRef(ref) {
  for (const classifier of CLASSIFIERS) {
    if (classifier.test(ref)) return classifier.bucket;
  }
  return 'unclassified';
}

export function categorizeRefs(refs) {
  const buckets = {};
  const samplesByBucket = {};
  for (const ref of refs) {
    const bucket = classifyUnresolvedRef(ref);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (!samplesByBucket[bucket]) samplesByBucket[bucket] = [];
    if (samplesByBucket[bucket].length < 5) {
      samplesByBucket[bucket].push({
        relation: ref.relation,
        target: ref.target,
        file: ref.source_file,
        line: ref.source_line,
        extractor: ref.extractor,
      });
    }
  }

  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const external = sorted.filter(([k]) => k.startsWith('external-by-design:')).reduce((s, [, n]) => s + n, 0);
  const denylisted = sorted.filter(([k]) => k.startsWith('denylisted-by-design:')).reduce((s, [, n]) => s + n, 0);
  const fixable = sorted.filter(([k]) => k.startsWith('fixable:')).reduce((s, [, n]) => s + n, 0);
  const shapeIssues = sorted.filter(([k]) => k.startsWith('shape-issue:')).reduce((s, [, n]) => s + n, 0);
  const unclassified = sorted.filter(([k]) => k === 'unclassified').reduce((s, [, n]) => s + n, 0);

  return {
    summary: { external, denylisted, fixable, shapeIssues, unclassified },
    buckets: Object.fromEntries(sorted),
    samples: samplesByBucket,
  };
}

export async function buildUnresolvedCategorization({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const { manifest } = await loadManifest(graphDir);
  const sidecar = await readDirtyEdgesSidecar(graphDir);
  const refs = sidecar ?? (manifest.dirtyEdges ?? []);
  const source = sidecar !== null ? 'sidecar' : 'manifest-sample';
  const total = sidecar !== null
    ? refs.length
    : (manifest.dirtyEdgeCount ?? refs.length);
  const categorization = categorizeRefs(refs);

  return {
    repoRoot,
    graph_commit: manifest.commit ?? null,
    graph_indexed_at: manifest.indexedAt ?? null,
    source,
    total,
    sample_size: refs.length,
    capped: source === 'manifest-sample' && total > refs.length,
    summary: categorization.summary,
    buckets: categorization.buckets,
    samples: categorization.samples,
    writtenAt: new Date().toISOString(),
  };
}

export async function writeUnresolvedCategorization({ repoRoot }) {
  const outPath = join(repoRoot, '.aify-graph', 'unresolved-categorization.json');
  const output = await buildUnresolvedCategorization({ repoRoot });
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  return {
    path: outPath,
    total: output.total,
    sample_size: output.sample_size,
    source: output.source,
    capped: output.capped,
    summary: output.summary,
  };
}

export function renderUnresolvedCategorizationReport(output) {
  const lines = [];
  lines.push(`Repo: ${output.repoRoot}`);
  lines.push(`Total unresolved refs: ${output.total}`);
  lines.push(`  source: ${output.source}${output.capped ? ` (sampled ${output.sample_size}/${output.total})` : ''}`);
  lines.push(`  external-by-design: ${output.summary.external} (${pct(output.summary.external, output.sample_size || output.total)})`);
  lines.push(`  denylisted-by-design: ${output.summary.denylisted ?? 0} (${pct(output.summary.denylisted ?? 0, output.sample_size || output.total)})`);
  lines.push(`  fixable:            ${output.summary.fixable} (${pct(output.summary.fixable, output.sample_size || output.total)})`);
  lines.push(`  shape-issue:        ${output.summary.shapeIssues} (${pct(output.summary.shapeIssues, output.sample_size || output.total)})`);
  lines.push(`  unclassified:       ${output.summary.unclassified} (${pct(output.summary.unclassified, output.sample_size || output.total)})`);
  lines.push('');
  lines.push('Per-bucket breakdown:');
  for (const [bucket, count] of Object.entries(output.buckets)) {
    lines.push(`  ${String(count).padStart(4)} ${bucket}`);
    for (const sample of (output.samples[bucket] ?? []).slice(0, 3)) {
      lines.push(`         · ${sample.relation} "${sample.target}" [${sample.extractor}] at ${sample.file}:${sample.line}`);
    }
  }
  return lines.join('\n');
}

export function readArtifactIndexedAt(filePath) {
  // P5-1: size-capped read. readJsonCappedSafe returns null on missing,
  // over-cap, or parse failure — preserving the existing lenient contract.
  const raw = readJsonCappedSafe(filePath);
  return raw?.graph_indexed_at ?? null;
}
