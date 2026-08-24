// `apg code-intel doctor` — agent-readable readiness report (Code-Intel v2 L1).
//
// Answers the three questions an agent needs before trusting C++ answers:
//   1. Is clangd resolvable, and which binary / version?
//   2. Is there a usable compile_commands.json, normalized to host paths?
//   3. READY or NOT READY — and if not, the single most important fix-it line.
//
// Signature preserved: runDoctor(args) where args may name languages and/or
// carry `--project-root <dir>`. Returns 0 (informational).

import fs from 'node:fs';
import { resolveClangd, clangdVersion, detectWslClangd, wslModeRequested } from '../resolve-clangd.js';
import { prepareCompileDb } from '../compile-db.js';
import { nodeLspSpawn } from '../node-bin.js';
import { computeCoverage } from '../coverage.js';

const LANGUAGES = {
  cpp: {
    serverBinary: 'clangd',
    install: 'install LLVM (winget install LLVM.LLVM / brew install llvm / apt install clangd) or set APG_CLANGD=<path to clangd>'
  },
  typescript: { pkg: 'typescript-language-server', bin: 'typescript-language-server', install: 'bundled with the plugin; if missing run `npm install` in the plugin dir' },
  python: { pkg: 'pyright', bin: 'pyright-langserver', install: 'bundled with the plugin; if missing run `npm install` in the plugin dir' },
};

// Report an npm-distributed (bundled) LSP backend: is the server script
// resolvable, and what does its coverage strategy say about exhaustiveness?
function reportNodeBackend(lang, projectRoot, write) {
  const cfg = LANGUAGES[lang];
  write(`${lang}:\n`);
  const spawn = nodeLspSpawn({ pkgName: cfg.pkg, binName: cfg.bin, args: ['--stdio'], projectRoot });
  const scriptOk = spawn.command === process.execPath && spawn.args[0] && fs.existsSync(spawn.args[0]);
  if (scriptOk) {
    write(`  server: OK — ${cfg.pkg} (bundled) via node ${spawn.args[0]}\n`);
  } else {
    write(`  server: NOT FOUND — ${cfg.pkg} (not on disk and not on PATH)\n`);
    write(`    fix: ${cfg.install}\n`);
  }
  let cov = null;
  try { cov = computeCoverage({ language: lang, projectRoot }); } catch { /* defensive */ }
  if (lang === 'python') {
    write('  coverage: PARTIAL by nature — Python call resolution is never provably exhaustive (duck typing / getattr / dynamic dispatch).\n');
    write('    references/hierarchy return exhaustive:false; verify with rg before any delete/rename.\n');
  } else if (cov) {
    if (cov.complete) write('  coverage: tsconfig.json/jsconfig.json found — references are exhaustive.\n');
    else write('  coverage: NO tsconfig.json/jsconfig.json — loose inferred-project mode; references may undercount (add a tsconfig for exhaustive results).\n');
  }
  write(scriptOk ? `  => READY${lang === 'python' ? ' (non-exhaustive by nature)' : ''}\n` : '  => NOT READY\n');
  write('  NOTE: the MCP server owns this language server — no host (Claude Code / Hermes) LSP config needed.\n');
}

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

  // Opt-in WSL-clangd transport availability (win32-only; cheap probe).
  const wslRequested = wslModeRequested();
  const wsl = detectWslClangd();

  let dbReady = false;
  let unityWarn = false;
  let unityExpanded = false;
  let foreignToolchain = false;
  // wslActive = WSL mode is requested AND actually usable for THIS db.
  let wslActive = false;
  if (db.found) {
    // ⛔ THIS USED TO BE `db.firstPartyCount > 0` AND NOTHING ELSE. On 2026-08-25 that reported
    // "=> READY" for an MSVC compile DB rooted in a per-session temp scratchpad, on a clang host,
    // in a repo whose owner had been told every absence claim there was void. A verdict that
    // cannot say NOT-READY for the case our own diagnostics describe is decoration.
    dbReady = db.firstPartyCount > 0 && !db.toolchainMismatch && !db.externalRoot;
    unityWarn = !!db.unity;
    unityExpanded = !!db.unityExpanded;
    foreignToolchain = !!db.foreignToolchain;
    wslActive = wslRequested && wsl.available;
    write(`  compile_db: FOUND — ${db.sourcePath}\n`);
    write(`    normalized: ${db.normalizedPath}\n`);
    write(`    entries: ${db.entryCount} (first-party: ${db.firstPartyCount})\n`);
    if (foreignToolchain) {
      const d = (db.diagnostics || []).find(x => x.code === 'foreign_toolchain');
      write(`    WARNING foreign_toolchain: Linux/WSL-built DB (${(db.foreignReasons || []).join(', ')}); stripped ${db.strippedFlags || 0} Linux-only toolchain flag(s)\n`);
      write('      references + call/type hierarchy: USABLE\n');
      if (wslActive) {
        // WSL transport ON + available → full diagnostics/hover via clangd-under-WSL.
        write(`      WSL-clangd: ACTIVE (APG_CLANGD_WSL=1) — ${wsl.version || 'clangd in WSL'}\n`);
        write(`      diagnostics + hover: READY (clangd runs under WSL against ${db.sourceDir} — Linux stdlib resolves; locations translated back to Windows paths)\n`);
      } else if (wsl.available) {
        // Foreign DB, WSL available but not opted in → tell them the exact opt-in.
        write('      diagnostics + hover: DEGRADED (host clangd can\'t resolve the Linux stdlib — bogus "file not found" cascade likely)\n');
        write(`      WSL-clangd: AVAILABLE (${wsl.version || 'clangd in WSL'}) — set APG_CLANGD_WSL=1 to run clangd under WSL for full stdlib diagnostics/hover (references/hierarchy still translate to Windows paths)\n`);
      } else {
        write('      diagnostics + hover: DEGRADED (host clangd can\'t resolve the Linux stdlib — bogus "file not found" cascade likely)\n');
        write(`      WSL-clangd: UNAVAILABLE (${wsl.reason || 'no clangd in WSL'}) — install clangd in WSL (apt install clangd) then set APG_CLANGD_WSL=1 for full diagnostics/hover, or build a native Windows compile_commands.json\n`);
        if (d?.fix) write(`      recommended: ${d.fix}\n`);
      }
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
    if (db.toolchainMismatch) {
      const d = (db.diagnostics || []).find((x) => x.code === 'toolchain_mismatch');
      write(`    WARNING toolchain_mismatch: DB built with '${db.compiler}' (MSVC) but clangd is clang\n`);
      if (d?.message) write(`      ${d.message}\n`);
      if (d?.fix) write(`      fix: ${d.fix}\n`);
    }
    if (db.externalRoot) {
      const d = (db.diagnostics || []).find((x) => x.code === 'compile_db_external_root');
      write(`    WARNING external_root: entries rooted outside this repository — ${db.externalRootSample}\n`);
      if (d?.fix) write(`      fix: ${d.fix}\n`);
    }
    if (db.firstPartyCount === 0) {
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
    if (foreignToolchain && wslActive) {
      // WSL transport ON + available → full readiness, incl. diagnostics/hover.
      write(`  => READY (WSL-clangd mode${suffix}) — references + hierarchy + diagnostics + hover\n`);
      write('     NOTE: clangd runs under WSL against the Linux DB; file URIs round-trip host↔WSL so locations come back as Windows paths.\n');
    } else if (foreignToolchain) {
      // Honest split verdict: refs/hierarchy work, diagnostics/hover don't.
      write(`  => READY for references + call/type hierarchy${suffix}\n`);
      if (wsl.available) {
        write('     NOTE: diagnostics + hover are DEGRADED (Linux/WSL-built DB). WSL clangd IS available — set APG_CLANGD_WSL=1 for full stdlib diagnostics/hover.\n');
      } else {
        write('     NOTE: diagnostics + hover are DEGRADED (Linux/WSL-built DB); install clangd in WSL + set APG_CLANGD_WSL=1, or build a native Windows compile DB, for full diagnostics/hover.\n');
      }
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
    else reportNodeBackend(lang, projectRoot, write);
  }
  return 0;
}
