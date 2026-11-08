// Which file extensions apg understands, and how: the ONE table (#7).
//
// Every extension-membership set in mcp/stdio (which files the tree-sitter extractor indexes, which language server
// a live query drives, which files a collector enumerates and a coverage figure counts, which C++ files are headers,
// which files a framework plugin scans) is computed from these rows. Before this there were about two dozen hand
// lists that disagreed: .mts and .cts went to typescript-language-server but were never indexed; the TypeScript and
// Python coverage denominators left out .mts/.cts/.pyi that their collectors admit; `.inl` picked clangd in
// graph_collect_code_intel and nothing in the live verbs. A disagreement is now a different column, visible here.
//
// Columns:
//   language    what the file is written in; framework plugins scan by this
//   treeSitter  the ingest/languages config that extracts symbols from the file, or null (not indexed)
//   lsp         the language server family a live query or collection uses, or null (none)
//   cppRole     'source' (a translation unit), 'header', 'inline' (included implementation), or null
//
// ⚠ Adding a row changes what gets indexed. There is no per-language extractor version: an existing graph picks up a
// newly indexed extension on its next full rebuild, not before.
const ROWS = Object.freeze([
  // ext       language      treeSitter     lsp           cppRole
  ['.c',      'c',          'c',          'cpp',        'source'],
  ['.cpp',    'cpp',        'cpp',        'cpp',        'source'],
  ['.cc',     'cpp',        'cpp',        'cpp',        'source'],
  ['.cxx',    'cpp',        'cpp',        'cpp',        'source'],
  ['.c++',    'cpp',        null,         null,         'source'],
  ['.cp',     'cpp',        null,         null,         'source'],
  ['.h',      'cpp',        'cpp',        'cpp',        'header'],
  ['.hpp',    'cpp',        'cpp',        'cpp',        'header'],
  ['.hh',     'cpp',        'cpp',        'cpp',        'header'],
  ['.hxx',    'cpp',        'cpp',        'cpp',        'header'],
  ['.h++',    'cpp',        null,         null,         'header'],
  ['.inc',    'cpp',        null,         null,         'header'],
  ['.inl',    'cpp',        null,         null,         'inline'],
  ['.ipp',    'cpp',        null,         null,         'inline'],
  ['.ts',     'typescript', 'typescript', 'typescript', null],
  ['.tsx',    'typescript', 'typescript', 'typescript', null],
  ['.mts',    'typescript', 'typescript', 'typescript', null],
  ['.cts',    'typescript', 'typescript', 'typescript', null],
  ['.js',     'javascript', 'javascript', 'typescript', null],
  ['.jsx',    'javascript', 'javascript', 'typescript', null],
  ['.mjs',    'javascript', 'javascript', 'typescript', null],
  ['.cjs',    'javascript', 'javascript', 'typescript', null],
  ['.py',     'python',     'python',     'python',     null],
  ['.pyi',    'python',     null,         'python',     null], // type stubs: pyright reads them, nothing extracts symbols
  ['.php',    'php',        'php',        null,         null],
  ['.go',     'go',         'go',         null,         null],
  ['.rs',     'rust',       'rust',       null,         null],
  ['.rb',     'ruby',       'ruby',       null,         null],
  ['.java',   'java',       'java',       null,         null],
  ['.kt',     'kotlin',     null,         null,         null], // scanned by the Spring plugin for annotations only
  ['.css',    'css',        'css',        null,         null],
  ...['.glsl', '.vert', '.frag', '.geom', '.tesc', '.tese', '.comp', '.mesh', '.task',
    '.rgen', '.rmiss', '.rchit', '.rahit', '.rint', '.rcall'].map((ext) => [ext, 'glsl', 'glsl', null, null]),
].map(([ext, language, treeSitter, lsp, cppRole]) => Object.freeze({ ext, language, treeSitter, lsp, cppRole })));

export const EXTENSION_ROWS = ROWS;

const extsWhere = (predicate) => Object.freeze(ROWS.filter(predicate).map((r) => r.ext));

/** Extensions of files written in any of `languages` (what a framework plugin for those languages scans). */
export const languageExtensions = (...languages) => extsWhere((r) => languages.includes(r.language));

/** The language a file is written in, from its extension, or null. */
export function languageOfExtension(ext) {
  return ROWS.find((r) => r.ext === String(ext).toLowerCase())?.language ?? null;
}

/** Extensions the tree-sitter config for `language` extracts. */
export const treeSitterExtensions = (language) => extsWhere((r) => r.treeSitter === language);

/** Extensions a `language` server family is driven for (live queries, collection, coverage). */
export const lspExtensions = (language) => extsWhere((r) => r.lsp === language);

/** ext -> language server family, for every extension that has one. */
export const LSP_LANGUAGE_BY_EXTENSION = Object.freeze(Object.fromEntries(ROWS.filter((r) => r.lsp).map((r) => [r.ext, r.lsp])));

/** C++ extensions with the given role ('source' | 'header' | 'inline'). */
export const cppExtensions = (role) => extsWhere((r) => r.cppRole === role);
