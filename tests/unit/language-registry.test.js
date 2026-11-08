// #7: one table says which extensions apg indexes and which language server each goes to; the extractor's configs
// are computed from it, and an extension with a language server is indexed or deliberately not.
//
// .mts and .cts went to typescript-language-server (backends.js) while the TypeScript tree-sitter config listed only
// .ts and .tsx, so a repository's .mts/.cts files had live answers and no graph nodes.
import { describe, it, expect } from 'vitest';
import { LANGUAGE_CONFIGS, hasLanguageConfig, getLanguageConfig } from '../../mcp/stdio/ingest/languages/index.js';
import { EXTENSION_ROWS, treeSitterExtensions } from '../../mcp/stdio/language-registry.js';

describe('the language registry owns extension membership', () => {
  it('★★★ every tree-sitter config extracts exactly the extensions the registry gives it', () => {
    for (const config of LANGUAGE_CONFIGS) {
      expect([...config.extensions].sort(), config.language).toEqual([...treeSitterExtensions(config.language)].sort());
    }
    // and no registry row names a tree-sitter language that has no config
    const configured = new Set(LANGUAGE_CONFIGS.map((c) => c.language));
    expect(EXTENSION_ROWS.filter((r) => r.treeSitter && !configured.has(r.treeSitter))).toEqual([]);
  });

  it('★★★ an extension with a language server is indexed, or is declared LSP-only on purpose (.pyi only)', () => {
    const lspOnly = EXTENSION_ROWS.filter((r) => r.lsp && !r.treeSitter).map((r) => r.ext);
    expect(lspOnly).toEqual(['.pyi']);
  });

  it('★★★ the extractor takes .mts and .cts as TypeScript (control: .ts, and .pyi stays out)', () => {
    for (const file of ['src/a.mts', 'src/b.cts', 'src/c.ts']) {
      expect(hasLanguageConfig(file), file).toBe(true);
      expect(getLanguageConfig(file).language, file).toBe('typescript');
    }
    expect(hasLanguageConfig('types/x.pyi')).toBe(false);
  });
});
