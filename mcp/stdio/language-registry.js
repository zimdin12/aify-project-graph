// Which file extensions apg understands, and how: the ONE table (#7).
//
// Every extension-membership set in mcp/stdio (which files the tree-sitter extractor indexes, which language server
// a live query drives, which files a collector enumerates and a coverage figure counts, which C++ files are headers)
// is computed from these rows. Before this there were about a dozen hand lists that disagreed: .mts and .cts went to
// typescript-language-server but were never indexed; the TypeScript and Python coverage denominators left out
// .mts/.cts/.pyi that their collectors admit; `.inl` picked clangd in graph_collect_code_intel and nothing in the live
// verbs. A disagreement is now a different column, visible here, not a different list somewhere else.
//
// Columns:
//   treeSitter  the ingest/languages config that extracts symbols from the file, or null (not indexed)
//   lsp         the language server family a live query or collection uses, or null (none)
//   cppRole     'source' (a translation unit), 'header', 'inline' (included implementation), or null
//
// ⚠ Adding a row changes what gets indexed. There is no per-language extractor version: an existing graph picks up a
// newly indexed extension on its next full rebuild, not before.
const ROWS = Object.freeze([
  // ext       treeSitter     lsp           cppRole
  ['.c',      'c',          'cpp',        'source'],
  ['.cpp',    'cpp',        'cpp',        'source'],
  ['.cc',     'cpp',        'cpp',        'source'],
  ['.cxx',    'cpp',        'cpp',        'source'],
  ['.c++',    null,         null,         'source'],
  ['.cp',     null,         null,         'source'],
  ['.h',      'cpp',        'cpp',        'header'],
  ['.hpp',    'cpp',        'cpp',        'header'],
  ['.hh',     'cpp',        'cpp',        'header'],
  ['.hxx',    'cpp',        'cpp',        'header'],
  ['.h++',    null,         null,         'header'],
  ['.inc',    null,         null,         'header'],
  ['.inl',    null,         null,         'inline'],
  ['.ipp',    null,         null,         'inline'],
  ['.ts',     'typescript', 'typescript', null],
  ['.tsx',    'typescript', 'typescript', null],
  ['.mts',    'typescript', 'typescript', null],
  ['.cts',    'typescript', 'typescript', null],
  ['.js',     'javascript', 'typescript', null],
  ['.jsx',    'javascript', 'typescript', null],
  ['.mjs',    'javascript', 'typescript', null],
  ['.cjs',    'javascript', 'typescript', null],
  ['.py',     'python',     'python',     null],
  ['.pyi',    null,         'python',     null], // type stubs: pyright reads them, nothing extracts symbols from them
  ['.php',    'php',        null,         null],
  ['.go',     'go',         null,         null],
  ['.rs',     'rust',       null,         null],
  ['.rb',     'ruby',       null,         null],
  ['.java',   'java',       null,         null],
  ['.css',    'css',        null,         null],
  ...['.glsl', '.vert', '.frag', '.geom', '.tesc', '.tese', '.comp', '.mesh', '.task',
    '.rgen', '.rmiss', '.rchit', '.rahit', '.rint', '.rcall'].map((ext) => [ext, 'glsl', null, null]),
].map(([ext, treeSitter, lsp, cppRole]) => Object.freeze({ ext, treeSitter, lsp, cppRole })));

export const EXTENSION_ROWS = ROWS;

const extsWhere = (predicate) => Object.freeze(ROWS.filter(predicate).map((r) => r.ext));

/** Extensions the tree-sitter config for `language` extracts. */
export const treeSitterExtensions = (language) => extsWhere((r) => r.treeSitter === language);

/** Extensions whose files any tree-sitter config extracts. */
export const INDEXED_EXTENSIONS = extsWhere((r) => r.treeSitter !== null);

/** Extensions a `language` server family is driven for (live queries, collection, coverage). */
export const lspExtensions = (language) => extsWhere((r) => r.lsp === language);

/** ext -> language server family, for every extension that has one. */
export const LSP_LANGUAGE_BY_EXTENSION = Object.freeze(Object.fromEntries(ROWS.filter((r) => r.lsp).map((r) => [r.ext, r.lsp])));

/** C++ extensions with the given role ('source' | 'header' | 'inline'). */
export const cppExtensions = (role) => extsWhere((r) => r.cppRole === role);

/** Every extension that belongs to the C++ family in any role. */
export const CPP_FAMILY_EXTENSIONS = extsWhere((r) => r.cppRole !== null);
