// FREEZE THE COMPILER-MODE GROUND TRUTH — before a single prompt is written.
//
// ⛔ THE HEURISTIC GRAPH IS NOT THE ANSWER KEY. The no-compile-DB extraction (24 nodes, all four
// symbols) is a LIVENESS CONTROL only: it proves the corpus indexes at all. It cannot establish
// linkage, and `exhaustive` remaining impossible in that mode is the EXPECTED NEGATIVE CONTROL, not
// a finding. A rubric can be perfectly blind while the answer key underneath it is still guesswork.
//
// ⭐ SO LINKAGE IS TAKEN FROM THE COMPILER, NOT FROM SOURCE SHAPE. Reading `namespace {` and
// concluding "internal linkage" is the same class of inference as reading a grep and concluding
// "no callers" — right here, wrong in general. clang-cl emits the object; llvm-nm reports what the
// compiler actually decided:
//
//   T <mangled>   EXTERNAL linkage — another TU may call it
//   t <mangled>   INTERNAL linkage — no other TU can name it
//
// Everything positive this file asserts is bound to an exact compiler version, an exact command
// row, exact source bytes, and a clean compile.
import { writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildCorpusRepo, CORPUS_FILES } from './lib/ab-corpus.mjs';

const CL = 'C:/Program Files/LLVM/bin/clang-cl.exe';
const NM = 'C:/Program Files/LLVM/bin/llvm-nm.exe';
const CLANGD = 'C:/Program Files/LLVM/bin/clangd.exe';
const OUT = 'C:/Docker/aify-project-graph/docs/evidence/ab-compiler-truth/compiler-truth.frozen.json';

const version = (exe, args) => {
  try { return execFileSync(exe, args, { encoding: 'utf8' }).split(/\r?\n/)[0].trim(); }
  catch { return null; }
};

/** Compile one TU. Returns the exact row plus whether diagnostics were clean. */
function compileTU(repo, file) {
  const args = ['/std:c++17', '/c', `src/${file}`];
  try {
    const stdout = execFileSync(CL, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { file, command: `clang-cl ${args.join(' ')}`, ok: true, diagnostics: stdout.trim() };
  } catch (e) {
    return { file, command: `clang-cl ${args.join(' ')}`, ok: false, diagnostics: String(e?.stderr ?? e?.message ?? e).trim() };
  }
}

/** Read the object's symbol table and classify linkage the way the COMPILER decided it. */
function linkageFromObject(repo, objName) {
  const out = execFileSync(NM, [objName], { cwd: repo, encoding: 'utf8' });
  const syms = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*[0-9a-f]*\s+([A-Za-z])\s+(\S+)/);
    if (!m) continue;
    const [, code, mangled] = m;
    // Uppercase = external/global, lowercase = internal/local. That is nm's contract, and it is
    // the compiler's own verdict rather than an inference from the source text.
    syms.push({ mangled, code, linkage: code === code.toUpperCase() ? 'external' : 'internal' });
  }
  return syms;
}

const demangledName = (mangled) => {
  const m = mangled.match(/\?([A-Za-z_][A-Za-z0-9_]*)@/);
  return m ? m[1] : null;
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

const report = {
  purpose: 'FROZEN compiler-mode ground truth for the routing/utility A/B. Positive scope claims are '
    + 'bound to an exact compiler, an exact command row, exact source bytes and a clean compile.',
  heuristicGraphIsNotTheKey: 'The no-compile-DB extraction is a LIVENESS CONTROL. `exhaustive` being '
    + 'impossible in that mode is the expected negative control, never a finding.',
  toolchain: {
    clangCl: version(CL, ['--version']),
    clangd: version(CLANGD, ['--version']),
    llvmNm: version(NM, ['--version']),
  },
  sourceBytes: {},
  modes: {},
  controls: {},
};

// Source membership, bound by hash. The SAME bytes must appear in every mode — if they differ, a
// mode comparison is measuring source drift rather than TU population.
{
  const { repo } = buildCorpusRepo({ tuMode: 'none' });
  for (const f of CORPUS_FILES) report.sourceBytes[f] = sha(join(repo, 'src', f));
  rmSync(repo, { recursive: true, force: true });
}

for (const tuMode of ['none', 'separate', 'unity']) {
  const { repo, translationUnits } = buildCorpusRepo({ tuMode });
  const bytesMatch = CORPUS_FILES.every((f) => sha(join(repo, 'src', f)) === report.sourceBytes[f]);
  const compiles = translationUnits.map((f) => compileTU(repo, f));
  const objects = existsSync(repo) ? readdirSync(repo).filter((f) => f.endsWith('.obj')) : [];
  const symbols = {};
  for (const obj of objects) {
    for (const s of linkageFromObject(repo, obj)) {
      const n = demangledName(s.mangled);
      if (n && ['computeWeight', 'scaleFactor', 'deriveScale', 'normalizeInput', 'runNormalize',
        'runWeighting', 'applyGain', 'applyByIndex'].includes(n)) {
        symbols[n] = { linkage: s.linkage, mangled: s.mangled, object: obj };
      }
    }
  }
  report.modes[tuMode] = {
    translationUnits,
    sourceBytesIdenticalToBaseline: bytesMatch,
    compiles,
    // ⛔ NOT `compiles.every(...)` ALONE. In `none` mode there are no TUs, so `[].every()` is TRUE
    // and the report read "clean=true" for a mode that compiled nothing at all. This repository has
    // already shipped one gate certified by a vacuous `[].every()`; a mode that ran no compile has
    // no cleanliness to report, and must say so rather than borrow the passing answer.
    allCompilesClean: compiles.length === 0 ? null : compiles.every((c) => c.ok),
    objectsProduced: objects,
    compilerProvenLinkage: symbols,
  };
  rmSync(repo, { recursive: true, force: true });
}

// ── CONTROLS ─────────────────────────────────────────────────────────────────────────────────
const sep = report.modes.separate;
const uni = report.modes.unity;

report.controls.repeatedExternVisibleAcrossSeparateTUs = {
  claim: 'in separate mode, weights.cpp and pipeline.cpp are DISTINCT TUs and both compile, so the '
    + 'repeated-extern caller is a real cross-TU reference',
  pass: sep.translationUnits.includes('weights.cpp') && sep.translationUnits.includes('pipeline.cpp')
    && sep.allCompilesClean,
};

report.controls.unityIsOneTUAndNothingDoubleCompiled = {
  claim: 'in unity mode ONLY bundle.cpp is a TU; weights.cpp and pipeline.cpp are not compiled '
    + 'separately, so no source is compiled twice',
  pass: uni.translationUnits.includes('bundle.cpp')
    && !uni.translationUnits.includes('weights.cpp')
    && !uni.translationUnits.includes('pipeline.cpp'),
};

report.controls.internalSymbolEarnsOnlyTUScope = {
  claim: 'scaleFactor is INTERNAL and computeWeight is EXTERNAL, decided by the compiler and read '
    + 'from the object symbol table — not inferred from `namespace {` in the source',
  observed: {
    scaleFactor: sep.compilerProvenLinkage.scaleFactor?.linkage ?? null,
    computeWeight: sep.compilerProvenLinkage.computeWeight?.linkage ?? null,
  },
  pass: sep.compilerProvenLinkage.scaleFactor?.linkage === 'internal'
    && sep.compilerProvenLinkage.computeWeight?.linkage === 'external',
};

report.controls.modeSwitchChangesAuthorityNotSource = {
  claim: 'switching TU mode changes the expected authority outcome while source bytes stay identical',
  sourceIdenticalAcrossModes: ['none', 'separate', 'unity'].every((m) => report.modes[m].sourceBytesIdenticalToBaseline),
  tuPopulationDiffers: JSON.stringify(sep.translationUnits) !== JSON.stringify(uni.translationUnits),
  pass: ['none', 'separate', 'unity'].every((m) => report.modes[m].sourceBytesIdenticalToBaseline)
    && JSON.stringify(sep.translationUnits) !== JSON.stringify(uni.translationUnits),
};

report.controls.noneModeWithholdsExhaustiveness = {
  claim: 'the no-compile-DB mode declares NO translation units, so no compiler-backed scope claim is '
    + 'available — the expected negative control',
  pass: report.modes.none.translationUnits.length === 0 && report.modes.none.objectsProduced.length === 0,
};

const allPass = Object.values(report.controls).every((c) => c.pass);
report.allControlsPass = allPass;

writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log('COMPILER-MODE GROUND TRUTH\n');
console.log('  toolchain:', report.toolchain.clangCl);
for (const [m, d] of Object.entries(report.modes)) {
  const clean = d.allCompilesClean === null ? 'n/a ' : String(d.allCompilesClean);
  console.log(`  ${m.padEnd(9)} TUs=${d.translationUnits.length}  clean=${clean}  objs=${d.objectsProduced.length}  bytesIdentical=${d.sourceBytesIdenticalToBaseline}`);
}
console.log('\n  CONTROLS');
for (const [k, c] of Object.entries(report.controls)) {
  console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${k}`);
}
console.log(`\n  frozen -> ${OUT}`);
console.log(`  ALL CONTROLS PASS: ${allPass}`);
if (!allPass) process.exit(2);
