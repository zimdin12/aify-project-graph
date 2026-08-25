// Can this project's C/C++ answers ever be compiler-verified? Asked at INSTALL time, when the
// operator is already configuring things — not at collect time, deep inside a later workflow.
//
// ⛔ MEASURED, ON A FRESH CLONE OF fmt:
//
//     graph_collect_code_intel(language: 'cpp')
//       -> status error · code compile_db_missing · 74ms
//
// The error itself is good: typed, fast, and carrying the exact remedy. The problem is WHEN it
// arrives. An operator installs the server, indexes, works for a while, and only discovers at the
// moment they wanted a caller set that C++ verification was never available.
//
// ⚠ AND THE CLAIM MUST STAY NARROW. Review corrected me for writing "no freshly-cloned C++ repo has
// a compile DB" and "configure AND BUILD first" — both false universals from a single observation.
// A compile DB may be committed to the repository, and CMake commonly emits one at CONFIGURE time,
// not build time. This reports what it FOUND; it never asserts what every C++ project requires.

import fs from 'node:fs';
import path from 'node:path';
import { discoverCompileDbCandidates } from '../../mcp/stdio/code-intel/compile-db.js';

// ⭐ DERIVED FROM THE REAL DISCOVERY FUNCTION, never a parallel list of build directories. Two
// hardcoded compile-DB directory lists drifted apart in this repository once already and cost a
// real project its caller sets.

const CPP_EXT = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.aify-graph', 'build', 'out', 'dist', '.venv', '__pycache__']);
// ⚠ Test fixtures are not a C++ project. A JavaScript repository with a two-file C++ fixture used
// by its own extractor tests must not be told its C++ evidence is unavailable.
const FIXTURE_SEGMENTS = ['/tests/fixtures/', '/test/fixtures/', '/__fixtures__/', '/testdata/'];
// Markers that a build system exists and could emit a compile database.
const BUILD_MARKERS = ['CMakeLists.txt', 'Makefile', 'makefile', 'meson.build', 'configure.ac', 'BUILD.bazel'];

/**
 * Is this plausibly a C/C++ PROJECT — not merely a repository containing a `.h` somewhere?
 *
 * ⛔ THE FIRST VERSION RETURNED TRUE ON ANY SINGLE C/C++ FILE, AND EXECUTING IT AGAINST A CONTROL
 * CAUGHT THAT. aify-project-graph is JavaScript and reported `compile_db_missing`: it tracks 7
 * C/C++ files, ALL of them under tests/fixtures, feeding its own extractor tests. Measured against
 * a real C++ project, fmt tracks 74 outside fixtures and carries a CMakeLists.
 *
 * ⇒ A warning that fires on every JS repository holding a C fixture is noise, and noise on an
 * install path is how a real warning gets ignored. Two independent signals are required: sources
 * OUTSIDE fixture directories, and a build-system marker that could produce a compile database.
 */
function looksLikeCppProject(root, budget = 4000) {
  let seen = 0;
  let nonFixtureSources = 0;

  const walk = (dir, depth, rel) => {
    if (seen >= budget || depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= budget) return;
      const relPath = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1, relPath);
      } else {
        seen += 1;
        if (!CPP_EXT.has(path.extname(e.name).toLowerCase())) continue;
        if (FIXTURE_SEGMENTS.some((seg) => `${relPath}/`.includes(seg))) continue;
        nonFixtureSources += 1;
      }
    }
  };
  walk(root, 0, '');

  const hasBuildMarker = BUILD_MARKERS.some((m) => fs.existsSync(path.join(root, m)));
  return { isCppProject: nonFixtureSources > 0 && hasBuildMarker, nonFixtureSources, hasBuildMarker };
}

/**
 * @returns {{applicable: boolean, cppCodeIntel: string, cause: string|null,
 *            absenceAuthority: boolean|null, compileDbCandidates: string[], remedy: string|null}}
 */
export function cppPreflight(projectRoot) {
  const shape = looksLikeCppProject(projectRoot);
  if (!shape.isCppProject) {
    // ⚠ NOT A PASS AND NOT A FAILURE. A project with no C/C++ has nothing to warn about, and
    // saying "available" would be a claim about a capability nobody asked for.
    return {
      applicable: false, cppCodeIntel: 'not_applicable', cause: null,
      absenceAuthority: null, compileDbCandidates: [], remedy: null,
      // Reported so a reader can see WHY it was skipped rather than inferring silence.
      evidence: shape,
    };
  }

  const candidates = discoverCompileDbCandidates(projectRoot);
  if (candidates.length > 0) {
    return {
      applicable: true, cppCodeIntel: 'available', cause: null,
      absenceAuthority: true, compileDbCandidates: candidates, remedy: null, evidence: shape,
    };
  }

  return {
    applicable: true,
    cppCodeIntel: 'unavailable',
    cause: 'compile_db_missing',
    // ⛔ FAILS CLOSED. Without a compile DB clangd cannot index, so no C++ caller set from this
    // project can support a "no callers / safe to delete" claim.
    absenceAuthority: false,
    compileDbCandidates: [],
    evidence: shape,
    // ⚠ Phrased as what THIS project needs, not what C++ projects require in general. Many
    // generators emit the database at configure time and some repositories commit it.
    remedy: 'no compile_commands.json found in this project or its build directories. C/C++ caller '
      + 'sets here will be heuristic (tree-sitter) and cannot support a "no callers" claim. To enable '
      + 'compiler-verified C++ evidence, have your build system emit one — for CMake, configure with '
      + '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON (emitted at configure time; a full build is not required '
      + 'for the database itself) — then run graph_collect_code_intel({ scope: "all" }).',
  };
}

/** One line for a human running the installer. Null when there is nothing worth saying. */
export function cppPreflightMessage(result) {
  if (!result?.applicable || result.cppCodeIntel !== 'unavailable') return null;
  return `NOTE: C/C++ sources detected but no compile_commands.json found — compiler-verified C++ `
    + `evidence is UNAVAILABLE until your build system emits one. ${result.remedy}`;
}
