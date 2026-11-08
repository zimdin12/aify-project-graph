// #16: no instruction an agent reads may say clangd ships with apg.
//
// Only typescript-language-server and pyright are npm dependencies. clangd is resolved from APG_CLANGD, then
// C:/Program Files/LLVM/bin/clangd.exe on Windows, then PATH (mcp/stdio/code-intel/resolve-clangd.js), and
// `apg code-intel serve-lsp` checks PATH only. Yet README, the server instructions and every shipped skill said "the
// servers are bundled with the plugin" right after naming clangd, so an agent on a host without LLVM was told there
// was nothing to install.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SURFACES, repoPath } from '../../helpers/instruction-surfaces.js';

// The unit is the paragraph: the claim was usually one sentence after the one naming clangd.
const CLAIM = /\bbundled\b/iu;
const NAMES_CLANGD = /clangd/iu;
const DENIES = /clangd is not bundled|not bundled/iu;

function bundledClangdParagraphs(text) {
  return text.split(/\r?\n\s*\r?\n/u).filter((p) => NAMES_CLANGD.test(p) && CLAIM.test(p) && !DENIES.test(p));
}

describe('no instruction surface says clangd is bundled', () => {
  it('★★★ the detector flags the shipped sentence and passes the corrected one (control)', () => {
    expect(bundledClangdParagraphs('Works on C++ (clangd) and Python (pyright). The servers are bundled with the plugin.'))
      .toHaveLength(1);
    expect(bundledClangdParagraphs('pyright ships with apg; clangd is not bundled, install LLVM.')).toHaveLength(0);
    expect(bundledClangdParagraphs('C++ (clangd).\n\nThe Python server is bundled.'), 'other paragraphs are other claims')
      .toHaveLength(0);
  });

  it('★★★ no surface states it', () => {
    const offenders = SURFACES.flatMap((f) => bundledClangdParagraphs(readFileSync(f, 'utf8'))
      .map((p) => `${repoPath(f)}: ${p.replace(/\s+/gu, ' ').trim().slice(0, 120)}`));
    expect(offenders).toEqual([]);
  });
});
