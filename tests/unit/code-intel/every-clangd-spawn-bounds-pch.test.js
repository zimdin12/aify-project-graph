// ⛔ EVERY PATH THAT SPAWNS clangd MUST BOUND ITS PCH STORAGE. This gate exists because one did not.
//
// `buildClangdSpawn` had `--pch-storage=memory` and two tests asserting it. `cli/serve-lsp.js` — the
// host-integration relay (Claude `.lsp.json`, Codex MCP, Pi) — carried a SEPARATE
// `defaultArgs: ['--background-index=false']` and never touched that list, so clangd ran with its
// default `disk` storage and wrote one `preamble-*.pch` per translation unit into %TEMP%, forever.
//
// Measured on this machine before the fix: 3,854 files, 84.2 GB, ~22 MB each, dating from
// 2026-08-18. It filled a 1.9 TB volume to 100% and stopped the test suite with ENOSPC.
//
// ⚠ THE EXISTING TESTS COULD NOT HAVE CAUGHT IT. Both asserted on `buildClangdSpawn`'s output — the
// path that was already correct. Nothing asserted over the SET of spawn sites, so the one that was
// wrong was simply not in any test's population. That is the parallel-list defect: the second list
// is invisible to every test written against the first.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLANGD_RESOURCE_ARGS } from '../../../mcp/stdio/code-intel/resolve-clangd.js';

const CODE_INTEL = fileURLToPath(new URL('../../../mcp/stdio/code-intel/', import.meta.url));

// Walk the code-intel tree and return every file that names the clangd binary as something to
// SPAWN. Derived from source at run time so a third spawn site is enrolled automatically.
function filesNamingClangdBinary() {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!entry.endsWith('.js')) continue;
      const source = readFileSync(path, 'utf8');
      // A spawn site declares the binary as a value: `binary: 'clangd'` or resolveClangd()'s
      // command. Mentioning clangd in prose or in an extractor tag is not a spawn.
      if (/binary:\s*'clangd'/.test(source) || /export function buildClangdSpawn/.test(source)) {
        hits.push({ file: path.slice(CODE_INTEL.length).replaceAll('\\', '/'), source });
      }
    }
  };
  walk(CODE_INTEL);
  return hits;
}

describe('every clangd spawn path bounds its PCH storage', () => {
  it('POSITIVE CONTROL: the scan finds more than one spawn site', () => {
    // A "no site is missing the flag" result is trivially true of an empty scan, and the defect
    // this gate exists for was precisely a site nobody's population included.
    const sites = filesNamingClangdBinary();
    expect(sites.length, 'the scan found no spawn sites — it is blind, not satisfied')
      .toBeGreaterThan(1);
    const names = sites.map((s) => s.file);
    expect(names, 'the relay must be in the population').toContain('cli/serve-lsp.js');
    expect(names, 'the main spawn builder must be in the population').toContain('resolve-clangd.js');
  });

  it('★ every spawn site carries the shared resource flags', () => {
    // Either it names them literally, or it composes the exported list. Both are fine; having
    // neither is the defect.
    const missing = filesNamingClangdBinary()
      .filter((s) => !s.source.includes('CLANGD_RESOURCE_ARGS') && !s.source.includes('--pch-storage='))
      .map((s) => s.file);
    expect(missing, 'a clangd spawn without bounded PCH storage fills %TEMP% until the disk dies')
      .toEqual([]);
  });

  it('⛔ the shared list actually pins PCH storage to memory', () => {
    // Guards the case where the list survives but its contents are hollowed out — the flag is the
    // whole point, and `disk` is clangd's DEFAULT, so losing it fails silently and expensively.
    expect(CLANGD_RESOURCE_ARGS).toContain('--pch-storage=memory');
    expect(CLANGD_RESOURCE_ARGS.some((a) => a.includes('pch-storage=disk')),
      'disk storage is the failure mode, never the setting').toBe(false);
  });

  it('the relay keeps its own indexing mode — shared discipline, not shared intent', () => {
    // serve-lsp legitimately disables background indexing because the host drives the protocol.
    // Merging the two lists entirely would have forced one call site to lie about the other's
    // intent, so only the resource half is shared.
    const relay = filesNamingClangdBinary().find((s) => s.file === 'cli/serve-lsp.js');
    expect(relay.source).toContain('--background-index=false');
  });
});
