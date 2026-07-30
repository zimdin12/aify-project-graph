// SHARED REAL-CLANGD GATE.
//
// Both integration suites gated on a bare `spawnSync('clangd', ['--version'])`.
// That is NOT how the product finds clangd: resolveClangd() also knows the
// standard Windows install location (`C:/Program Files/LLVM/bin/clangd.exe`) and
// the WSL path. So on any Windows box with a normal LLVM install — including this
// one, clangd 22.1.6 — the product works fine and the tests SKIPPED, reporting the
// reason "clangd not on PATH", which was false.
//
// The suite therefore reported green while its ONLY real-server coverage never
// executed. That is the same failure shape this whole hardening pass has been
// removing: a green signal over an operation that did not happen. It is worse in a
// test harness than in a verb, because the harness is what is supposed to catch
// the others.
//
// Gate on the product's own resolver so test capability and product capability
// cannot diverge again.
import { resolveClangd, clangdVersion } from '../../../mcp/stdio/code-intel/resolve-clangd.js';

const resolved = (() => {
  try { return resolveClangd(); } catch { return null; }
})();

export const clangdCommand = resolved?.command ?? null;
export const clangdAvailable = Boolean(clangdCommand);
export const clangdSource = resolved?.source ?? null;
export const clangdVersionString = clangdAvailable
  ? (() => { try { return clangdVersion(clangdCommand); } catch { return null; } })()
  : null;

// A skip must say what was actually checked. "not on PATH" was misleading when the
// product looks in three places.
export const skipReason = clangdAvailable
  ? null
  : 'clangd not resolvable via resolveClangd() (PATH, C:/Program Files/LLVM/bin, or WSL)';
