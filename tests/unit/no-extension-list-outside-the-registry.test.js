// #7: no file in mcp/stdio keeps its own list of the extensions the language registry knows.
//
// About two dozen hand lists (indexing, live inference, collectors, coverage, C++ roles, every framework plugin's
// walk) each decided which files belonged to a language, and they disagreed. They now come from
// mcp/stdio/language-registry.js. The population is every .js under mcp/stdio, derived; the detector is "two or more
// distinct extension literals the registry has a row for".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_ROWS } from '../../mcp/stdio/language-registry.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KNOWN = new Set(EXTENSION_ROWS.map((r) => r.ext));
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const SOURCES = walk(join(ROOT, 'mcp', 'stdio')).filter((f) => f.endsWith('.js'));
const rel = (f) => relative(ROOT, f).replaceAll('\\', '/');

// Not language membership, so not the registry's: each says what it decides instead.
const NOT_MEMBERSHIP = {
  'mcp/stdio/language-registry.js': 'the registry itself',
  'mcp/stdio/dashboard/server.js': 'Content-Type for the viewer\'s own static files',
  'mcp/stdio/ingest/import-resolution.js': 'which file an import specifier resolves to, in order',
  'mcp/stdio/intelligence/extract.js': 'label strings for LLM file summaries, including languages apg does not index',
};

export function extensionLiterals(text) {
  return [...new Set([...text.matchAll(/['"](\.[a-z0-9+]+)['"]/gu)].map((m) => m[1]).filter((e) => KNOWN.has(e)))];
}

describe('extension membership lives only in the language registry', () => {
  it('★★★ control: the detector finds a hand list, and finds the registry\'s own rows', () => {
    expect(extensionLiterals("walkFiles(repoRoot, ['.cpp', '.cc', '.h'])")).toEqual(['.cpp', '.cc', '.h']);
    expect(extensionLiterals("const notExt = ['.md', '.txt'];")).toEqual([]);
    expect(extensionLiterals(readFileSync(join(ROOT, 'mcp/stdio/language-registry.js'), 'utf8')).length).toBeGreaterThan(30);
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it('★★★ no other file in mcp/stdio holds two or more of them', () => {
    const offenders = SOURCES.filter((f) => !(rel(f) in NOT_MEMBERSHIP))
      .map((f) => [rel(f), extensionLiterals(readFileSync(f, 'utf8'))])
      .filter(([, lits]) => lits.length >= 2)
      .map(([f, lits]) => `${f}: ${lits.join(' ')}`);
    expect(offenders).toEqual([]);
  });

  it('★★ every exemption still exists (a stale exemption would hide a new file of the same name)', () => {
    for (const file of Object.keys(NOT_MEMBERSHIP)) expect(SOURCES.map(rel), file).toContain(file);
  });
});
