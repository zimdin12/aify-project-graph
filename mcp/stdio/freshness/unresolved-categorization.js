import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDirtyEdgesSidecar } from './dirty-edges-sidecar.js';
import { loadManifest } from './manifest.js';
import { readJsonCappedSafe } from '../util/json.js';
import { COMMON_NAMES, JS_RUNTIME_GLOBALS } from '../ingest/denylist.js';

// C++ standard-library headers spelled WITHOUT an extension (`#include <vector>`).
// Audit 2026-06-12 (echoes measurement): these were the bulk of the
// `unclassified` bucket (710) because the cpp-system regex keyed on `.h` / known
// vendor prefixes and never saw a bare STL header.
const CPP_STDLIB_HEADERS = new Set([
  'algorithm', 'any', 'array', 'atomic', 'barrier', 'bit', 'bitset', 'cassert',
  'cctype', 'cerrno', 'cfenv', 'cfloat', 'charconv', 'chrono', 'cinttypes',
  'climits', 'clocale', 'cmath', 'codecvt', 'compare', 'complex', 'concepts',
  'condition_variable', 'coroutine', 'csetjmp', 'csignal', 'cstdarg', 'cstaddef',
  'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'cuchar',
  'cwchar', 'cwctype', 'deque', 'exception', 'execution', 'expected', 'filesystem',
  'format', 'forward_list', 'fstream', 'functional', 'future', 'initializer_list',
  'iomanip', 'ios', 'iosfwd', 'iostream', 'istream', 'iterator', 'latch', 'limits',
  'list', 'locale', 'map', 'memory', 'memory_resource', 'mutex', 'new', 'numbers',
  'numeric', 'optional', 'ostream', 'queue', 'random', 'ranges', 'ratio', 'regex',
  'scoped_allocator', 'semaphore', 'set', 'shared_mutex', 'source_location', 'span',
  'sstream', 'stack', 'stdexcept', 'stop_token', 'streambuf', 'string', 'string_view',
  'strstream', 'syncstream', 'system_error', 'thread', 'tuple', 'type_traits',
  'typeindex', 'typeinfo', 'unordered_map', 'unordered_set', 'utility', 'valarray',
  'variant', 'vector', 'version',
]);

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
    // Gated to IMPORTS (system headers are includes) — which also stops a project
    // symbol starting with `vk`/`std` being miscounted as a system include (M5).
    test: (r) => {
      if (!(r.extractor === 'cpp' || r.extractor === 'c') || r.relation !== 'IMPORTS') return false;
      const t = (r.target || '').trim();
      if (!t) return false;
      if (t.startsWith('<')) return true;                       // explicit angle-bracket include
      if (CPP_STDLIB_HEADERS.has(t)) return true;               // bare STL header (<vector>)
      if (/\.(h|hpp|hh|hxx|inl|ipp)$/i.test(t)) return true;    // any header file incl. paths (SDL3/SDL.h)
      if (/^(std|boost|glm|vma|vulkan|imgui|entt|flecs)\b/.test(t)) return true; // known vendor roots
      return false;
    },
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
  // ⛔⛔ ONE REASON, NAMED — NOT `Boolean(refusedReason)`. The first version of this bucket matched
  // ANY refusal, and it was fail-OPEN in the worst possible place: every reason the admission owner
  // might ever add would be removed from the trust denominator before anyone decided whether it was
  // a product defect.
  //
  // ⭐ AND THE MEASURED HARM WAS NOT HYPOTHETICAL. On this repository the blanket test took
  // trustDirtyEdgeCount from 27,957 to ZERO — the single most load-bearing number in the product,
  // silently dead, in a commit whose message claimed the denominator was unchanged.
  //
  // ⭐ MEASURED, which is why this is narrow. Of the four reasons the owner currently emits, the
  // pre-existing classifiers already handle three correctly, and only ONE moves the denominator:
  //
  //     references-bare-local-name      28,070   ->  27,919 trust-relevant  (fixable:reference-short-name)
  //     common-name-not-worth-minting    5,057   ->       0  (denylisted-by-design:common-name)
  //     relation-not-admitted:IMPORTS    4,739   ->       2  (external-by-design:npm / node-builtin)
  //     fragment-shape-not-minted          833   ->      36  (mostly external-by-design:node-builtin)
  //
  // So only the local-name class needs an exclusion; it is the population the old silent drop
  // existed for. Everything else FALLS THROUGH to the classifiers below, which is the fail-closed
  // direction: an unrecognised future reason lands in `fixable:` or `unclassified` and stays
  // TRUST-RELEVANT until someone classifies it deliberately.
  {
    bucket: 'external-by-design:admission-refused-local-name',
    test: (r) => r?.refusedReason === 'references-bare-local-name',
  },
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
  // Turn the `fixable` NUMBER into an ACTION (Sand Castle field report
  // 2026-07-10, #4a): a count with no next step doesn't tell a reader what to
  // do. `fixable:*` edges are plain-name CALLS/REFERENCES tree-sitter saw but
  // couldn't bind to a definition — the LSP trust spine resolves most of them.
  if ((output.summary.fixable ?? 0) > 0) {
    lines.push('');
    lines.push(
      `  → fixable = tree-sitter saw a plain call/reference but couldn't bind it to a definition. ` +
      `Run graph_collect_code_intel to let the LSP (clangd/tsserver/pyright) resolve them into real edges; ` +
      `residue is genuinely cross-TU / dynamic and expected.`,
    );
  }
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
