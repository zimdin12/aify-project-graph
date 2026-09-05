// ⛔ A TYPESCRIPT HIERARCHY ANNOUNCED "clangd", ON THE TRUST BANNER.
//
// Found by a bounded audit of every site that BRANCHES on a language — 24 across 12 files, which is
// a decidable population, unlike the ~250 files that merely MENTION cpp. ef-manager's terminating
// criterion: each such site must either DERIVE from the provider registry, or sit in a module that
// is C++-only by construction and says so. "The class is closed" is an ABSENCE claim, and a probe
// count never reaches one; an argument over a bounded population does.
//
// Two sites failed it, both on the trust surface:
//   code_intel_hierarchy.js  — SEVEN hardcoded "clangd" in banners that serve every language
//   lsp-evidence.js:573      — a parallel name list: pyright | tsserver | clangd
//
// ⚠ `tsserver` appears EXACTLY ONCE in the codebase, at that line. The registry says
// `ts-langserver`. One backend, two names, and the banner used the one nothing else knows.
//
// ⚠ AND lsp-evidence.js:31 STATES THE PRINCIPLE IT BREAKS, 540 LINES ABOVE:
//     "Language normalisation comes from the backend REGISTRY, never a parallel alias list here."
// Normalisation was derived. The NAMES were not. A stated rule is not a guard.
//
// ⛔ ONE OF THE SEVEN IS MINE, WRITTEN HOURS EARLIER. The readiness-unknown banner I added last
// night hardcodes "clangd" — added during the session spent removing exactly this class. The class
// is not a thing other people did; it is what this surface does to whoever edits it next.
import { describe, it, expect } from 'vitest';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';
import { backendNameFor } from '../../../mcp/stdio/code-intel/provenance.js';
import { backendForCollection } from '../../../mcp/stdio/query/lsp-evidence.js';
import { buildHierarchyTrustLine } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';

describe('trust banners name the backend that actually answered', () => {
  it('★★★ THE CENTRAL PIN: banner literals elsewhere match the registry', () => {
    // Six assertions in three other files spell the C++ provider name inside regex literals. Rather
    // than convert each to a template — regex surgery for no gain — this pins the value once. If the
    // registry name ever changes, THIS fails and names the reason, instead of six opaque regexes
    // failing somewhere else. It is the producer checking the copies.
    expect(BACKENDS.cpp.providerName).toBe('cpp-clangd');
    expect(BACKENDS.typescript.providerName).toBe('ts-langserver');
    expect(BACKENDS.python.providerName).toBe('pyright');
  });

  it('★★★ every registered backend maps to ITS OWN name, harvested from BACKENDS', () => {
    const langs = Object.keys(BACKENDS);
    expect(langs.length, 'no backends — the assertion would be vacuous').toBeGreaterThan(1);
    for (const lang of langs) expect(backendNameFor(lang)).toBe(BACKENDS[lang].providerName);
  });

  it('★★★ the names are DISTINCT — one string for all would satisfy nothing else here', () => {
    const produced = Object.keys(BACKENDS).map(backendNameFor);
    expect(new Set(produced).size).toBe(produced.length);
  });

  it('★★★ an unknown language does NOT inherit clangd', () => {
    // Fail closed: the banner must not assert a toolchain it cannot support. The old code defaulted
    // `lang` to 'cpp', so an unlabelled collection claimed a C++ toolchain on a trust surface.
    expect(backendNameFor('zzq-not-a-language')).not.toContain('clangd');
    expect(backendNameFor(undefined)).not.toContain('clangd');
  });

  it('★★★ a TYPESCRIPT hierarchy banner does not say clangd', () => {
    // The live defect, as the agent would read it.
    const line = buildHierarchyTrustLine({
      mode: 'indexed', indexReady: true, kind: 'callers', nodeCount: 3,
      coverage: { complete: true }, language: 'typescript',
    });
    expect(line).toContain(BACKENDS.typescript.providerName);
    expect(line).not.toContain('clangd');
  });

  it('★★★ POSITIVE CONTROL: a C++ hierarchy banner still names clangd', () => {
    // ⛔ The direction this breaks in. If the fix stripped the engine name from everyone, the banner
    // would lose information rather than gain accuracy.
    const line = buildHierarchyTrustLine({
      mode: 'indexed', indexReady: true, kind: 'callers', nodeCount: 3,
      coverage: { complete: true }, language: 'cpp',
    });
    expect(line).toContain(BACKENDS.cpp.providerName);
  });

  it('★★ every hierarchy banner BRANCH carries the backend, not just the happy one', () => {
    // Seven sites were hardcoded; a fix that reached only the one under test would leave six.
    const cases = [
      { mode: 'bounded', indexReady: null },
      { mode: 'indexed', indexReady: true, nodeCount: 1 },
      { mode: 'indexed', indexReady: true, coverage: { complete: false } },
      { mode: 'indexed', indexReady: true, truncated: 3 },
      { mode: 'indexed', indexReady: null },
      { mode: 'indexed', indexReady: false },
    ];
    for (const c of cases) {
      const line = buildHierarchyTrustLine({
        kind: 'callers', nodeCount: 3, coverage: { complete: true }, language: 'typescript', ...c,
      });
      expect(line, `branch ${JSON.stringify(c)} still says clangd`).not.toContain('clangd');
    }
  });

  it('★★★ a compile DB identifies the backend when no language was recorded', () => {
    // ⛔ THIS CLAUSE WAS UNTESTED AND I HAD JUSTIFIED IT WITH A FALSE STORY. I wrote that a test
    // caught me removing it; the failure I was chasing came from a different line entirely, and a
    // mutant proved it — deleting the clause broke nothing. It survives because the reasoning holds
    // on its own: only C++ has a compile DB, so a recorded hash identifies the backend. Now checked.
    expect(backendForCollection({ compileDbHash: 'deadbeef' })).toBe(BACKENDS.cpp.providerName);
  });

  it('★★★ and with neither a language nor a compile DB it says UNKNOWN, not clangd', () => {
    // The original defaulted to cpp here, asserting a toolchain on a trust surface with no evidence.
    expect(backendForCollection({})).toBe('unknown-provider');
    expect(backendForCollection(null)).toBe('unknown-provider');
  });

  it('★★ an explicit language always wins over the compile-DB inference', () => {
    expect(backendForCollection({ language: 'typescript', compileDbHash: 'deadbeef' }))
      .toBe(BACKENDS.typescript.providerName);
  });
});
