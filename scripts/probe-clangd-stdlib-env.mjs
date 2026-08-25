#!/usr/bin/env node
// Does a clangd spawned by THIS server resolve the C++ standard library against a clang-cl
// compile DB, in the environment the MCP server actually runs in?
//
// WHY: sc-manager compiled sand_castle's TUs by hand on 2026-08-25 and every one failed at
// `'chrono' file not found` / `'cstddef' file not found` — INCLUDING their positive control
// (Terrain.cpp, core terrain code, nothing to do with the fluid solver they were chasing). They
// flagged their own instrument as suspect: they ran from a bash shell with no vcvars applied, and
// clang-cl locates the MSVC STL through the INCLUDE environment, not through --query-driver.
//
// Their hypothesis, which is ours to test: if the clangd WE spawn inherits an environment without
// the MSVC toolchain, every TU in a clang-cl repo fails to compile, every AST is empty, and every
// caller set comes back empty — repo-wide, not subsystem-specific.
//
// This runs the mechanism on a synthetic repo on this machine, so it neither touches sand_castle
// nor depends on anyone's shell. It settles the MECHANISM. It does NOT settle whether that is what
// happened in sand_castle — only a run there can do that.
//
// CONTROLS, in the same pass as the measurement:
//   POSITIVE — references on a symbol in a TU with NO stdlib include. Must find its caller, or
//              clangd/our plumbing is broken and the measurement means nothing.
//   MEASURE  — references on a symbol in a TU that includes <cstddef>.
//   NEGATIVE — references on a symbol that does not exist. Must find nothing, or the probe is
//              answering PRESENT to everything and cannot report ABSENT.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeIntelReferences } from '../mcp/stdio/query/verbs/code_intel_live.js';
import { resolveClangd, clangdVersion } from '../mcp/stdio/code-intel/resolve-clangd.js';

const CLEAN = `int plain_target() { return 1; }
int plain_caller() { return plain_target(); }
`;

const STDLIB = `#include <cstddef>
std::size_t stdlib_target() { return 1; }
std::size_t stdlib_caller() { return stdlib_target(); }
`;

// GAP 1, raised by sc-manager: the guard keys on clangd REPORTING an unresolved include. What
// about a TU that was never attempted at all — a file absent from the compile DB? There may be no
// diagnostic to read, translationUnitFailed stays false, and the empty result is presented as
// genuine. That is the same green null one level up, landing in the exact bucket the guard exists
// to keep honest. This file is on disk with a real caller, and deliberately NOT in the DB.
const ORPHAN = `int orphan_target() { return 1; }
int orphan_caller() { return orphan_target(); }
`;

function buildRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-stdlib-probe-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'plain.cpp'), CLEAN);
  fs.writeFileSync(path.join(src, 'stdlib.cpp'), STDLIB);
  fs.writeFileSync(path.join(src, 'orphan.cpp'), ORPHAN);
  // GAP 1, harder shape. `orphan.cpp` needs no flags, so clangd's fallback command compiles it
  // and the question goes unanswered. This one includes a project header reachable ONLY via an
  // -I the compile DB would have supplied — so clangd's fallback cannot resolve it. If clangd
  // emits an unresolved-include diagnostic, the guard fires and the gap is closed. If it returns
  // empty in silence, sc-manager's Gap 1 is real.
  fs.mkdirSync(path.join(root, 'include', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'include', 'deep', 'Dep.h'), 'inline int dep() { return 7; }\n');
  fs.writeFileSync(path.join(src, 'orphan_needs_include.cpp'),
    '#include "deep/Dep.h"\nint needy_target() { return dep(); }\nint needy_caller() { return needy_target(); }\n');

  const buildDir = path.join(root, 'build-clangd-native');
  fs.mkdirSync(buildDir, { recursive: true });
  const clangCl = 'C:/Program Files/LLVM/bin/clang-cl.exe';
  const db = ['plain.cpp', 'stdlib.cpp'].map((name) => {
    const file = path.join(src, name).replace(/\\/g, '/');
    return { directory: buildDir.replace(/\\/g, '/'), file, command: `"${clangCl}" /std:c++20 -c ${file}` };
  });
  fs.writeFileSync(path.join(buildDir, 'compile_commands.json'), JSON.stringify(db, null, 2));
  return { root, src };
}

async function refs(repoRoot, file, line, col, label) {
  try {
    const res = await codeIntelReferences({ repoRoot, language: 'cpp', file, line, col, waitForReadyMs: 20000 });
    const n = Array.isArray(res?.references) ? res.references.length : 0;
    const ev = res?.evidence ?? {};
    return {
      label,
      count: n,
      status: res?.status ?? 'unknown',
      exhaustive: ev.exhaustive ?? null,
      // Does the guard actually FIRE here? A fix that tests green but never triggers on the case
      // it was built from is the same green — so the reproduction has to check it, not the suite.
      translationUnitFailed: ev.translationUnitFailed ?? false,
      missingHeaders: ev.missingHeaders ?? [],
      warnsNotAbsence: (ev.warnings || []).some((w) => /DID NOT COMPILE/.test(w)),
    };
  } catch (err) {
    return { label, count: 0, status: `threw: ${err.message}`, exhaustive: null, translationUnitFailed: false };
  }
}

const { root, src } = buildRepo();
const { command } = resolveClangd();

console.log(JSON.stringify({
  what: 'Does a clangd spawned by this server resolve the MSVC stdlib against a clang-cl DB?',
  environment: {
    clangd: command,
    clangdVersion: clangdVersion(command),
    INCLUDE: Boolean(process.env.INCLUDE),
    VCINSTALLDIR: Boolean(process.env.VCINSTALLDIR),
    LIB: Boolean(process.env.LIB),
    note: 'INCLUDE/VCINSTALLDIR/LIB are how clang-cl finds the MSVC STL. --query-driver is a GCC-style mechanism and does not supply them.',
  },
  carrier: { repo: root },
}, null, 2));

// `plain_target` is declared on line 1 col 5; its caller sits on line 2.
const positive = await refs(root, path.join(src, 'plain.cpp'), 1, 5, 'POSITIVE plain_target (no stdlib include)');
// `stdlib_target` is on line 2 col 13 (after `std::size_t `).
const measured = await refs(root, path.join(src, 'stdlib.cpp'), 2, 13, 'MEASURE stdlib_target (includes <cstddef>)');
// A position inside whitespace naming nothing — must produce no references.
const negative = await refs(root, path.join(src, 'plain.cpp'), 2, 1, 'NEGATIVE no symbol at this position');
// GAP 1: on disk, has a real caller one line below, absent from the compile DB.
const orphan = await refs(root, path.join(src, 'orphan.cpp'), 1, 5, 'GAP1 orphan_target (file NOT in the compile DB)');

const needy = await refs(root, path.join(src, 'orphan_needs_include.cpp'), 2, 5, 'GAP1-HARD needy_target (not in DB, needs an -I only the DB supplies)');

console.log(JSON.stringify({ positive, measured, negative, orphan, needy }, null, 2));

const controlsOk = positive.count > 0 && negative.count === 0;
console.log(JSON.stringify({
  controlsPassed: controlsOk,
  verdict: !controlsOk
    ? 'CONTROLS FAILED — this run establishes nothing. Do not read the measurement.'
    : measured.count > 0
      ? 'stdlib TU RESOLVED — clangd found the MSVC STL without an explicit vcvars environment.'
      : 'stdlib TU EMPTY while the plain TU resolved — the stdlib include is what breaks it.',
}, null, 2));

try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* leave it */ }
process.exit(controlsOk ? 0 : 1);
