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
];

export function getLanguageConfig(filePath) {
  const normalized = filePath.toLowerCase();
  const config = LANGUAGE_CONFIGS.find((candidate) =>
    candidate.extensions.some((extension) => normalized.endsWith(extension))
  );

  if (!config) {
    throw new Error(`No language config found for ${filePath}`);
  }

  return config;
}
