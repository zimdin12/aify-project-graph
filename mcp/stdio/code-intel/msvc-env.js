// Find the MSVC toolset and Windows SDK so the clangd we spawn can resolve <cstddef> / <chrono>.
//
// ⛔ THE DEFECT THIS CLOSES, measured 2026-08-25. A clangd inheriting a shell with no MSVC
// environment returns an EMPTY caller set for any TU that includes a standard header, and reports
// status "ok" — 2 references vs 0 on identical TUs differing only by `#include <cstddef>`. Nearly
// every real C++ file includes one, so the blast radius is the whole repository, silently.
// `--query-driver=*` does not cover it: that is GCC-style driver interrogation, and clang-cl finds
// the MSVC STL through the INCLUDE environment.
//
// ⭐ AND THE DISCOVERY ITSELF IS WHERE EVERYONE GOT STUCK. `vswhere -latest` on this machine
// returns a **BuildTools** install that has no C++ toolset at all — no VC/Tools/MSVC, no cl.exe,
// no vcvars64.bat. The real toolset (14.43.34604, the one sand_castle's compile DB was built with)
// lives in a *Preview* install under the OTHER Program Files root. Two separate agents concluded
// "vcvars cannot be captured here"; both were reading a real absence at the wrong instance.
//
// ⇒ SO THIS ASSERTS CAPABILITY, NEVER NAME OR RECENCY. An install counts only when a header we
// actually need is readable inside it. "Latest", "BuildTools", "Preview" and version ordering are
// all unreliable proxies for "can compile C++", and picking by them is the same defect as choosing
// a compile DB by its directory name.

import fs from 'node:fs';
import path from 'node:path';

// Roots where Visual Studio installs itself. Both are scanned because the toolset and the
// installer metadata can live under different ones on the same machine — exactly this machine.
const VS_ROOTS = [
  'C:/Program Files/Microsoft Visual Studio',
  'C:/Program Files (x86)/Microsoft Visual Studio',
];
const SDK_ROOTS = [
  'C:/Program Files (x86)/Windows Kits/10',
  'C:/Program Files/Windows Kits/10',
];

// A header that must be readable for the toolset to be usable at all. This is the capability
// probe: its presence is the only thing that makes an install count.
const PROBE_HEADER = 'cstddef';
// The Windows SDK sections clang-cl needs; all three or the install does not count.
const SDK_SECTIONS = ['ucrt', 'um', 'shared'];

function dirsIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

const isReadableFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/**
 * Every MSVC toolset on this machine that can actually compile, newest first.
 * @returns {{version: string, includeDir: string, installPath: string}[]}
 */
export function findMsvcToolsets() {
  const found = [];
  for (const root of VS_ROOTS) {
    for (const year of dirsIn(root)) {
      for (const edition of dirsIn(path.join(root, year))) {
        const toolsRoot = path.join(root, year, edition, 'VC', 'Tools', 'MSVC');
        for (const version of dirsIn(toolsRoot)) {
          const includeDir = path.join(toolsRoot, version, 'include');
          // CAPABILITY, not name: the probe header must be readable.
          if (isReadableFile(path.join(includeDir, PROBE_HEADER))) {
            found.push({ version, includeDir, installPath: path.join(root, year, edition) });
          }
        }
      }
    }
  }
  // Newest by version string, but only among installs that already PASSED the capability probe —
  // recency is a tiebreak here, never an admission rule.
  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/**
 * Every Windows SDK that carries all the sections clang-cl needs, newest first.
 * @returns {{version: string, includeDirs: string[]}[]}
 */
export function findWindowsSdks() {
  const found = [];
  for (const root of SDK_ROOTS) {
    const includeRoot = path.join(root, 'Include');
    for (const version of dirsIn(includeRoot)) {
      const dirs = SDK_SECTIONS.map((s) => path.join(includeRoot, version, s));
      if (dirs.every((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })) {
        found.push({ version, includeDirs: dirs });
      }
    }
  }
  return found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/**
 * The INCLUDE path list a clangd child needs on Windows, or an explicit statement that it could
 * not be built. Never throws, never guesses.
 *
 * FAILS CLOSED AND SAYS SO: with no usable toolset this returns `found: false` plus a reason,
 * rather than a partial INCLUDE that would resolve some headers and not others — a half-resolved
 * TU still produces an empty caller set, and would be harder to diagnose than none.
 */
export function discoverMsvcEnv({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') {
    return { found: false, reason: 'not_win32', include: null, toolset: null, sdk: null };
  }
  // An operator-supplied INCLUDE (a real vcvars shell) is authoritative — do not second-guess it.
  if (typeof env.INCLUDE === 'string' && env.INCLUDE.trim()) {
    return { found: true, reason: 'inherited_from_environment', include: env.INCLUDE, toolset: null, sdk: null };
  }
  const toolset = findMsvcToolsets()[0] ?? null;
  const sdk = findWindowsSdks()[0] ?? null;
  if (!toolset) {
    return {
      found: false,
      reason: 'no_msvc_toolset_with_readable_headers',
      include: null,
      toolset: null,
      sdk,
    };
  }
  if (!sdk) {
    return { found: false, reason: 'no_windows_sdk_with_ucrt_um_shared', include: null, toolset, sdk: null };
  }
  return {
    found: true,
    reason: 'discovered',
    include: [toolset.includeDir, ...sdk.includeDirs].join(';'),
    toolset,
    sdk,
  };
}

/**
 * The env object for a clangd child: the caller's environment plus a discovered INCLUDE.
 * Returns `{ env, msvc }` so the caller can report what happened rather than guess.
 */
export function clangdChildEnv({ base = process.env, platform = process.platform } = {}) {
  const msvc = discoverMsvcEnv({ platform, env: base });
  if (!msvc.found || !msvc.include) return { env: base, msvc };
  if (msvc.reason === 'inherited_from_environment') return { env: base, msvc };
  return { env: { ...base, INCLUDE: msvc.include }, msvc };
}
