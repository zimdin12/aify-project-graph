// #7: one set of named extension cases gets the same answer from every surface that decides about extensions:
// indexing, collection enumeration, live language inference and coverage counting. And a coverage denominator never
// leaves out a file its collector admits.
//
// Before the registry these were separate hand lists. The TypeScript and Python coverage denominators left out
// .mts/.cts/.pyi that their collectors enumerate, so coverage could count covered files the denominator never had;
// `.inl` picked clangd in graph_collect_code_intel's language vote and nothing in the live verbs.
import { describe, it, expect } from 'vitest';
import { hasLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { inferLanguage } from '../../../mcp/stdio/code-intel/backends.js';
import { CPP_EXTENSIONS } from '../../../mcp/stdio/code-intel/compile-db.js';
import { ADMITTED_EXTENSIONS as TS_ADMITTED } from '../../../mcp/stdio/code-intel/providers/ts-langserver.js';
import { ADMITTED_EXTENSIONS as PY_ADMITTED } from '../../../mcp/stdio/code-intel/providers/pyright.js';
import { LANGUAGE_FILE_EXTENSIONS, inferLanguageFromFiles } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';

const COLLECTORS = { typescript: TS_ADMITTED, python: PY_ADMITTED, cpp: CPP_EXTENSIONS };
const collectedBy = (ext) => Object.keys(COLLECTORS).filter((lang) => [...(COLLECTORS[lang] ?? [])].includes(ext));

// ext → [indexed by tree-sitter, collector that enumerates it, live language, coverage language]
const CASES = {
  '.mts': [true, 'typescript', 'typescript', 'typescript'],
  '.hh': [true, 'cpp', 'cpp', 'cpp'],
  '.c': [true, 'cpp', 'cpp', 'cpp'],
  '.pyi': [false, 'python', 'python', 'python'],
  '.inl': [false, null, null, null],
};

describe('every surface gives a named extension the same answer', () => {
  it.each(Object.entries(CASES))('★★★ %s', (ext, [indexed, collector, live, coverage]) => {
    const file = `src/x${ext}`;
    expect(hasLanguageConfig(file), 'indexing').toBe(indexed);
    expect(collectedBy(ext), 'collection enumeration').toEqual(collector ? [collector] : []);
    expect(inferLanguage(file), 'live inference').toBe(live);
    expect(inferLanguageFromFiles([file]), 'graph_collect_code_intel language vote').toBe(live);
    const counted = Object.keys(LANGUAGE_FILE_EXTENSIONS).filter((l) => l !== 'javascript' && LANGUAGE_FILE_EXTENSIONS[l].includes(ext));
    expect(counted, 'coverage counting').toEqual(coverage ? [coverage] : []);
  });

  it.each(Object.keys(COLLECTORS))('★★★ the %s coverage denominator counts every extension its collector admits', (lang) => {
    const admitted = [...(COLLECTORS[lang] ?? [])];
    expect(admitted.length, 'control: the collector admits something').toBeGreaterThan(0);
    expect(admitted.filter((ext) => !LANGUAGE_FILE_EXTENSIONS[lang].includes(ext))).toEqual([]);
  });
});
