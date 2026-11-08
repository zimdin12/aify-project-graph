// #6: a file whose extension maps to no language server is refused, never handed to clangd.
//
// Before the fix every live verb fell back to `|| 'cpp'`, so a `.svelte`, `.glsl` or `.php` file started clangd and
// came back with C++ answers about a file that is not C++. The spawn here names a binary that does not exist: a verb
// that reaches the language server fails `language_server_missing`, so a refusal before that point is
// `language_unsupported`, and the `.cpp` control proves the same call does reach the spawn.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codeIntelDiagnostics, codeIntelReferences, codeIntelDefinitions, codeIntelHover, codeIntelSymbols,
} from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { codeIntelHierarchy } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';

const repoRoot = mkdtempSync(join(tmpdir(), 'apg-unmapped-'));
const spawn = { command: 'apg-no-such-language-server-binary', args: [] };
const VERBS = {
  diagnostics: (file) => codeIntelDiagnostics({ repoRoot, files: [file], spawn }),
  references: (file) => codeIntelReferences({ repoRoot, file, line: 1, col: 1, spawn }),
  definitions: (file) => codeIntelDefinitions({ repoRoot, file, line: 1, col: 1, spawn }),
  hover: (file) => codeIntelHover({ repoRoot, file, line: 1, col: 1, spawn }),
  symbols: (file) => codeIntelSymbols({ repoRoot, file, spawn }),
  hierarchy: (file) => codeIntelHierarchy({ repoRoot, file, line: 1, col: 1, kind: 'callers', spawn }),
};
const codeOf = (out) => out?.errors?.[0]?.code ?? out?.status;

describe('an unmapped extension is refused before any language server starts', () => {
  for (const [verb, call] of Object.entries(VERBS)) {
    it(`★★★ ${verb}: .svelte is language_unsupported; the .cpp control reaches the spawn`, async () => {
      const refused = await call('ui/src/lib/StateCard.svelte');
      expect(codeOf(refused), JSON.stringify(refused)).toBe('language_unsupported');
      expect(JSON.stringify(refused)).toMatch(/\.svelte/u);
      const reached = await call('src/a.cpp');
      expect(codeOf(reached), JSON.stringify(reached)).toBe('language_server_missing');
    });
  }
});
