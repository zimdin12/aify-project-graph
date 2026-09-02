import python from './python.js';
import javascript from './javascript.js';
import typescript from './typescript.js';
import php from './php.js';
import c from './c.js';
import cpp from './cpp.js';
import go from './go.js';
import rust from './rust.js';
import ruby from './ruby.js';
import java from './java.js';
import glsl from './glsl.js';
import css from './css.js';

export const LANGUAGE_CONFIGS = [
  python,
  javascript,
  typescript,
  php,
  c,
  cpp,
  go,
  rust,
  ruby,
  java,
  glsl,
  css,
];

function findLanguageConfig(filePath) {
  const normalized = String(filePath).toLowerCase();
  return LANGUAGE_CONFIGS.find((candidate) =>
    candidate.extensions.some((extension) => normalized.endsWith(extension))
  );
}

export function getLanguageConfig(filePath) {
  const config = findLanguageConfig(filePath);

  if (!config) {
    throw new Error(`No language config found for ${filePath}`);
  }

  return config;
}

/**
 * Would the extractor read symbols out of this path? Non-throwing, so a caller can ASK.
 *
 * ⭐ THIS IS THE DISCRIMINATOR THAT MAKES AN UNCOMMITTED-FILE DISCLOSURE HONEST RATHER THAN NOISE,
 * and it replaced a design that counted dirty files instead. Counting fails on the population that
 * actually shows up: the field report of 2026-07-30 had 592 untracked files, every one of them
 * `.aify-graph.bak-*` JSON residue. A count-based caveat fires on all 592 and teaches a reader to
 * ignore it — the exact mistake read_freshness already warns about when it keys staleness on
 * TRACKED modifications only.
 *
 * Measured against both real populations in one pass (2026-09-03): `.aify-graph.bak-test/f0.json`,
 * `package-lock.json` and `notes.md` -> no config, silent; `src/n0.js`, `src/thing.py`,
 * `src/thing.cpp` -> config, fires.
 *
 * ⚠ CODE ONLY, deliberately, and it is a scope rather than a completeness claim: the doc layer
 * indexes Markdown that has no language config here. That is the right boundary for the current
 * callers — every consumer of this predicate answers a CODE-symbol question — but a caller asking
 * about documents must not read a false negative from it as "not indexed".
 */
export function hasLanguageConfig(filePath) {
  return Boolean(findLanguageConfig(filePath));
}
