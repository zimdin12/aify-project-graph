import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cppPreflight, cppPreflightMessage } from '../../../scripts/lib/cpp-preflight.mjs';

// F3. Measured on a fresh clone of fmt: `graph_collect_code_intel(language:'cpp')` returns
// `compile_db_missing` in 74ms — typed, fast, with the exact remedy. The error is good; its TIMING
// is the problem. An operator installs, indexes, works, and only learns at the moment they wanted a
// caller set that C++ verification was never available.
//
// ⚠ THE CLAIM STAYS NARROW. Review corrected two false universals of mine: "no freshly-cloned C++
// repo has a compile DB" and "configure AND BUILD first". A DB may be committed, and CMake emits
// one at CONFIGURE time. This reports what it FOUND.

let dir;
const mk = (files, markers = []) => {
  dir = mkdtempSync(join(tmpdir(), 'apg-preflight-'));
  for (const f of files) {
    const full = join(dir, f);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '// x\n');
  }
  for (const m of markers) writeFileSync(join(dir, m), 'x\n');
  return dir;
};

beforeEach(() => { dir = null; });
afterEach(() => { if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('cppPreflight — warns at install time, when the operator can still act', () => {
  it('⭐ a real C++ project with NO compile DB is flagged unavailable', () => {
    const r = cppPreflight(mk(['src/main.cpp', 'include/lib.h'], ['CMakeLists.txt']));
    expect(r.applicable).toBe(true);
    expect(r.cppCodeIntel).toBe('unavailable');
    expect(r.cause).toBe('compile_db_missing');
    expect(r.absenceAuthority).toBe(false);
  });

  it('⭐ the same project WITH a compile DB is available — the positive control', () => {
    // Without this, the assertion above is satisfied by a check that always says unavailable.
    const root = mk(['src/main.cpp'], ['CMakeLists.txt', 'compile_commands.json']);
    const r = cppPreflight(root);
    expect(r.cppCodeIntel).toBe('available');
    expect(r.absenceAuthority).toBe(true);
    expect(r.compileDbCandidates.length).toBeGreaterThan(0);
  });

  it('⛔ TEST FIXTURES ARE NOT A C++ PROJECT — the false positive executing caught', () => {
    // ⛔ The first version returned true on ANY single C/C++ file, and running it against a control
    // exposed that: aify-project-graph is JavaScript and reported `compile_db_missing`, because it
    // tracks 7 C/C++ files — ALL under tests/fixtures, feeding its own extractor tests. A warning
    // that fires on every JS repo holding a C fixture is noise, and noise on an install path is how
    // a real warning gets ignored.
    const r = cppPreflight(mk(['tests/fixtures/tiny-cpp/Foo.cpp', 'tests/fixtures/tiny-c/app.c', 'index.js']));
    expect(r.applicable).toBe(false);
    expect(r.cppCodeIntel).toBe('not_applicable');
    expect(r.evidence.nonFixtureSources).toBe(0);
  });

  it('⛔ C++ sources WITHOUT a build marker are not a project either', () => {
    // Two independent signals are required. A stray .cpp beside a Node app is not something whose
    // build system could be asked to emit a compile database.
    const r = cppPreflight(mk(['scratch/experiment.cpp', 'index.js']));
    expect(r.applicable).toBe(false);
    expect(r.evidence.hasBuildMarker).toBe(false);
  });

  it('⛔ a build marker WITHOUT C++ sources is not a project either', () => {
    const r = cppPreflight(mk(['index.js', 'lib/util.py'], ['Makefile']));
    expect(r.applicable).toBe(false);
    expect(r.evidence.nonFixtureSources).toBe(0);
  });

  it('⭐ says NOT APPLICABLE more often than it warns — an install path must stay quiet', () => {
    const cases = [
      mk(['src/main.cpp'], ['CMakeLists.txt']),                    // warns
      mk(['index.js']),
      mk(['app.py'], ['Makefile']),
      mk(['tests/fixtures/x/Foo.cpp', 'index.js']),
    ];
    const warned = cases.map((c) => cppPreflight(c)).filter((r) => r.cppCodeIntel === 'unavailable');
    expect(warned).toHaveLength(1);
  });
});

describe('the remedy names what THIS project needs, never a universal rule', () => {
  it('⭐ points at configure-time emission and does not demand a full build', () => {
    // Review's correction, pinned: CMake emits the database at CONFIGURE time, and some repos
    // commit one. Saying "build first" would be false for both.
    const r = cppPreflight(mk(['src/main.cpp'], ['CMakeLists.txt']));
    expect(r.remedy).toMatch(/CMAKE_EXPORT_COMPILE_COMMANDS/);
    expect(r.remedy).toMatch(/configure time/i);
    expect(r.remedy).toMatch(/a full build is not required/i);
  });

  it('⛔ it also says what the CONSEQUENCE is, not only the fix', () => {
    // A remedy without a consequence leaves the reader unable to judge whether to bother.
    const r = cppPreflight(mk(['src/main.cpp'], ['CMakeLists.txt']));
    expect(r.remedy).toMatch(/heuristic/i);
    expect(r.remedy).toMatch(/no callers/i);
  });

  it('the human message is emitted ONLY when there is something to say', () => {
    expect(cppPreflightMessage(cppPreflight(mk(['src/main.cpp'], ['CMakeLists.txt'])))).toMatch(/UNAVAILABLE/);
    expect(cppPreflightMessage(cppPreflight(mk(['index.js'])))).toBeNull();
    expect(cppPreflightMessage(cppPreflight(mk(['src/main.cpp'], ['CMakeLists.txt', 'compile_commands.json'])))).toBeNull();
  });
});
