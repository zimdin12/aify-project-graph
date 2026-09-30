// Facts the anchor resolver is built on, measured rather than assumed. Run from the repo root:
//   node docs/evidence/dashboard-seam-2026-09-30/anchor-facts-probe.mjs
//
// Every question here has a POSITIVE control (a case where the answer is known non-empty) and a
// NEGATIVE control (a case where it must be empty), in the same run — because a probe that cannot
// return ABSENT cannot return PRESENT.
import { readFileSync } from 'node:fs';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../../../mcp/stdio/ingest/fingerprint.js';
import { scanDocReferences } from '../../../mcp/stdio/analysis/doc-links.js';

const line = (k, v) => console.log(String(k).padEnd(52), v);

console.log('== Q1 does the JS extractor model `export const`? ==');
for (const rel of ['mcp/stdio/storage/taxonomy.js', 'mcp/stdio/ingest/fingerprint.js']) {
  const ex = extractFile({ filePath: rel, source: readFileSync(rel, 'utf8'), config: getLanguageConfig(rel) });
  const symbols = ex.nodes.filter((n) => !['File', 'Module', 'Directory'].includes(n.type));
  line(`  ${rel}`, `nodes=${ex.nodes.length} symbols=${symbols.length} [${symbols.map((n) => n.label).join(',')}]`);
  line('    carries structural_fp / dependency_fp?',
    `${symbols[0] ? Boolean(symbols[0].structural_fp) : 'n/a'} / ${symbols[0] ? Boolean(symbols[0].dependency_fp) : 'n/a'}`);
}
console.log('  ⇒ POSITIVE control is fingerprint.js (symbols found). NEGATIVE-shaped case is taxonomy.js,');
console.log('    which is ALL `export const`: 0 symbols, so a symbol anchor there is UNMODELLED, not GONE.');

console.log('== Q2 is a file fingerprint stable across a comment-only edit? ==');
{
  const rel = 'mcp/stdio/ingest/fingerprint.js';
  const src = readFileSync(rel, 'utf8');
  const base = fileStructuralFingerprint(extractFile({ filePath: rel, source: src, config: getLanguageConfig(rel) }));
  const commented = `// a comment nobody asked for\n${src}`;
  const after = fileStructuralFingerprint(extractFile({ filePath: rel, source: commented, config: getLanguageConfig(rel) }));
  line('  comment-only edit changes the fingerprint?', after === base ? 'NO (correct)' : 'YES — would report a false `changed`');
  const renamed = src.replace('export function dependencyFingerprint(', 'export function dependencyFingerprintRenamed(');
  const mutated = fileStructuralFingerprint(extractFile({ filePath: rel, source: renamed, config: getLanguageConfig(rel) }));
  line('  MUTATION CONTROL: renaming a function changes it?',
    renamed === src ? 'PROBE BROKEN — the replace matched nothing'
      : (mutated === base ? 'NO — THE FINGERPRINT IS INERT' : 'YES (correct)'));
}
console.log('  ⇒ Without the mutation control, "comment edit does not change it" is also what a');
console.log('    constant would report. The pair separates stable from dead.');

console.log('== Q3 what does a doc link set look like? ==');
{
  const refs = scanDocReferences(readFileSync('AGENTS.md', 'utf8'));
  const live = refs.filter((r) => !r.fenced);
  line('  AGENTS.md references total / non-fenced', `${refs.length} / ${live.length}`);
  line('  distinct non-fenced targets', new Set(live.map((r) => r.written)).size);
  line('  first five', JSON.stringify([...new Set(live.map((r) => r.written))].slice(0, 5)));
  const empty = scanDocReferences('# a heading and nothing else\n');
  line('  NEGATIVE CONTROL: a doc with no links', `${empty.length} (must be 0)`);
}
