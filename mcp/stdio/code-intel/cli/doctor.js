// `apg code-intel doctor` — agent-readable readiness report (Code-Intel v2 L1).
//
// Answers the three questions an agent needs before trusting C++ answers:
//   1. Is clangd resolvable, and which binary / version?
//   2. Is there a usable compile_commands.json, normalized to host paths?
//   3. READY or NOT READY — and if not, the single most important fix-it line.
//
// Signature preserved: runDoctor(args) where args may name languages and/or
// carry `--project-root <dir>`. Returns 0 (informational).

import { resolveClangd, clangdVersion } from '../resolve-clangd.js';
import { prepareCompileDb } from '../compile-db.js';

const LANGUAGES = {
  cpp: {
    serverBinary: 'clangd',
    install: 'install LLVM (winget install LLVM.LLVM / brew install llvm / apt install clangd) or set APG_CLANGD=<path to clangd>'
  }
};

function parseArgs(args) {
  const langs = [];
  let projectRoot = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--project-root') { projectRoot = args[++i] || projectRoot; continue; }
    if (a.startsWith('--')) continue;
    langs.push(a);
  }
  return { langs, projectRoot };
}

function reportCpp(projectRoot, write) {
  // 1. clangd resolution + version.
  const { command, source } = resolveClangd();
  const version = clangdVersion(command);
  const clangdReady = version !== null;

  write('cpp:\n');
  if (clangdReady) {
    write(`  clangd: OK — ${command} (source: ${source})\n`);
    write(`    version: ${version}\n`);
  } else {
    write(`  clangd: NOT FOUND — tried '${command}' (source: ${source})\n`);
    write(`    fix: ${LANGUAGES.cpp.install}\n`);
  }

  // 2. compile DB discovery + normalization.
  let db;
  try { db = prepareCompileDb({ projectRoot }); }
  catch (err) { db = { found: false, diagnostics: [{ code: 'compile_db_error', message: err.message, fix: 'check --project-root' }] }; }

  let dbReady = false;
  let unityWarn = false;
  let unityExpanded = false;
  let foreignToolchain = false;
  if (db.found) {
    dbReady = db.firstPartyCount > 0;
    unityWarn = !!db.unity;
    unityExpanded = !!db.unityExpanded;
    foreignToolchain = !!db.foreignToolchain;
    write(`  compile_db: FOUND — ${db.sourcePath}\n`);
    write(`    normalized: ${db.normalizedPath}\n`);
    write(`    entries: ${db.entryCount} (first-party: ${db.firstPartyCount})\n`);
    if (foreignToolchain) {
      const d = (db.diagnostics || []).find(x => x.code === 'foreign_toolchain');
      write(`    WARNING foreign_toolchain: Linux/WSL-built DB (${(db.foreignReasons || []).join(', ')}); stripped ${db.strippedFlags || 0} Linux-only toolchain flag(s)\n`);
      write('      references + call/type hierarchy: USABLE\n');
      write('      diagnostics + hover: DEGRADED (host clangd can\'t resolve the Linux stdlib — bogus "file not found" cascade likely)\n');
      if (d?.fix) write(`      recommended: ${d.fix}\n`);
    }
    if (unityExpanded) {
      const d = (db.diagnostics || []).find(x => x.code === 'unity_expanded');
      write(`    unity-expanded: ${db.expandedFrom} unity TUs → ${db.expandedSources} per-source entries\n`);
      if (d?.message) write(`      ${d.message}\n`);
    } else if (unityWarn) {
      const d = (db.diagnostics || []).find(x => x.code === 'unity_build');
      write(`    WARNING unity_build: ${d ? d.message : 'unity aggregates detected'}\n`);
      if (d?.fix) write(`      fix: ${d.fix}\n`);
    }
    if (!dbReady) {
      write('    WARNING: 0 first-party entries after dep filtering — clangd will see only vendored/build sources\n');
    }
  } else {
    const d = (db.diagnostics || [])[0];
    write(`  compile_db: MISSING — ${d ? d.message : 'no compile_commands.json found'}\n`);
    if (d?.fix) write(`    fix: ${d.fix}\n`);
  }

  // 3. Verdict + single most important fix-it.
  const ready = clangdReady && dbReady;
  if (ready) {
    let suffix = '';
    if (unityExpanded) suffix = ' (unity-expanded)';
    else if (unityWarn) suffix = ' (degraded: unity build — precision reduced)';
    if (foreignToolchain) {
      // Honest split verdict: refs/hierarchy work, diagnostics/hover don't.
      write(`  => READY for references + call/type hierarchy${suffix}\n`);
      write('     NOTE: diagnostics + hover are DEGRADED (Linux/WSL-built DB); run clangd under WSL against the Linux DB for full stdlib diagnostics/hover\n');
    } else {
      write(`  => READY${suffix}\n`);
    }
  } else {
    let fixit;
    if (!clangdReady) fixit = LANGUAGES.cpp.install;
    else if (!db.found) fixit = (db.diagnostics?.[0]?.fix) || 'generate compile_commands.json (cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON)';
    else if (unityWarn) fixit = (db.diagnostics?.find(d => d.code === 'unity_build')?.fix)
      || 'unity build with no expandable members (build tree absent?) — reconfigure with -DCMAKE_UNITY_BUILD=OFF or run the build so unity .cxx files exist on disk';
    else fixit = 'no first-party sources in compile DB — pass explicit files[] or reconfigure the build';
    write('  => NOT READY\n');
    write(`     fix: ${fixit}\n`);
  }
}

export function runDoctor(args) {
  const { langs, projectRoot } = parseArgs(Array.isArray(args) ? args : []);
  const targets = langs.length > 0 ? langs : Object.keys(LANGUAGES);
  const write = (s) => process.stdout.write(s);
  for (const lang of targets) {
    if (!LANGUAGES[lang]) {
      write(`${lang}: unsupported (no provider registered)\n`);
      continue;
    }
    if (lang === 'cpp') reportCpp(projectRoot, write);
  }
  return 0;
}
