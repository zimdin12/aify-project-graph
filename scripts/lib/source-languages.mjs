// ONE definition of "which files are source, and what evidence tier can that language reach".
//
// ⚠ EXTRACTED BECAUSE IT WAS ABOUT TO BE DUPLICATED. The audit script owned this map; the corpus
// manifest needed the same recognition to record exact tracked-file MEMBERSHIP. Two lists of "what
// counts as source" drift, and when they drift the manifest and the audit silently describe
// different populations while agreeing on the word "coverage".
//
// This repository has already paid for that shape twice in compile-DB directory allowlists.
//
// ⛔ THE TIERS ARE NOT COSMETIC. `lsp` means a language server exists and an edge can be
// compiler-verified. `heuristic` means tree-sitter only: those edges can never carry `[lsp✓]`,
// never support `exhaustive: true`, and never license an absence claim. PHP sits in the second
// group despite being a stated priority language.

export const LANGUAGE_TIERS = Object.freeze({
  cpp:        { tier: 'lsp',       server: 'clangd',                  ext: ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh'] },
  c:          { tier: 'heuristic', server: null,                      ext: ['.c'] },
  python:     { tier: 'lsp',       server: 'pyright',                 ext: ['.py'] },
  typescript: { tier: 'lsp',       server: 'typescript-language-server', ext: ['.ts', '.tsx'] },
  javascript: { tier: 'lsp',       server: 'typescript-language-server', ext: ['.js', '.mjs', '.cjs', '.jsx'] },
  php:        { tier: 'heuristic', server: null,                      ext: ['.php'] },
  go:         { tier: 'heuristic', server: null,                      ext: ['.go'] },
  java:       { tier: 'heuristic', server: null,                      ext: ['.java'] },
  rust:       { tier: 'heuristic', server: null,                      ext: ['.rs'] },
  ruby:       { tier: 'heuristic', server: null,                      ext: ['.rb'] },
});

/** extension -> language, DERIVED from the table above so the two can never disagree. */
export const EXTENSION_TO_LANGUAGE = Object.freeze(
  Object.fromEntries(
    Object.entries(LANGUAGE_TIERS).flatMap(([lang, def]) => def.ext.map((e) => [e, lang])),
  ),
);

/** Every recognised source extension, derived. Used to detect untracked source contamination. */
export const SOURCE_EXTENSIONS = Object.freeze(Object.keys(EXTENSION_TO_LANGUAGE));

const extOf = (p) => {
  const m = String(p).match(/\.[A-Za-z0-9]+$/);
  return m ? m[0].toLowerCase() : '';
};

/** Is this path a file one of our extractors claims? */
export const isRecognisedSource = (p) => Object.hasOwn(EXTENSION_TO_LANGUAGE, extOf(p));

/** Which language, or null. */
export const languageOf = (p) => EXTENSION_TO_LANGUAGE[extOf(p)] ?? null;

/**
 * Group a file list into exact per-language MEMBERSHIP, not counts.
 *
 * ⚠ MEMBERSHIP, BECAUSE A COUNT IS NOT IDENTITY. Two runs can both report "79 python files" over
 * different sets and every derived coverage figure would agree while describing different
 * populations. Review made this point about submodule counts and it is the same error.
 */
export function membershipByLanguage(files) {
  const out = {};
  for (const f of files) {
    const lang = languageOf(f);
    if (!lang) continue;
    (out[lang] ??= []).push(String(f).replace(/\\/g, '/'));
  }
  for (const lang of Object.keys(out)) out[lang].sort();
  return out;
}
