// `apg code-intel serve-lsp <language>` — thin LSP relay.
// Spawns the underlying language server and pipes stdio between parent
// (the host: Claude `.lsp.json`, Codex MCP, Pi `.pi-lsp.json`) and child.
// No JSON-RPC parsing — pure byte pipe. The host owns the LSP protocol;
// this wrapper exists so hosts can target one stable command name and
// APG can resolve the actual binary per language (project-local → bundled
// → global), with explicit error exits instead of silent downgrades.
//
// Pattern mirrors `agent-code-intel serve-lsp <lang>` from the upstream
// reference repo. APG-owned variant; resolution chain and supported
// languages live here, not in the host config.

import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

// ⛔ THE RESOURCE FLAGS COME FROM THE ONE OWNER, NOT FROM A SECOND LIST HERE.
// This file used to carry only `--background-index=false`, so clangd ran with its DEFAULT
// `--pch-storage=disk` and wrote a preamble per translation unit into %TEMP% that nothing removed.
// Measured: 3,854 files / 84.2 GB accumulated since 2026-08-18, which filled the volume.
// `--background-index=false` stays local — the host owns the protocol here — but the discipline is
// shared, because that is the half a relay has no business having its own opinion about.
import { CLANGD_RESOURCE_ARGS } from '../resolve-clangd.js';

const LANGUAGE_SERVERS = {
  cpp: {
    binary: 'clangd',
    versionArgs: ['--version'],
    defaultArgs: ['--background-index=false', ...CLANGD_RESOURCE_ARGS],
    hint: 'install clangd via your package manager (apt install clangd / brew install llvm) and ensure it is on PATH'
  }
};

function resolveBinary(language) {
  const cfg = LANGUAGE_SERVERS[language];
  if (!cfg) return { ok: false, reason: 'language_unsupported', message: `language '${language}' has no registered language server`, hint: 'supported: ' + Object.keys(LANGUAGE_SERVERS).join(', ') };
  // Resolution chain: project-local → bundled → global. v1 only checks global PATH.
  const probe = spawnSync(cfg.binary, cfg.versionArgs, { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) {
    return { ok: false, reason: 'language_server_missing', message: `${cfg.binary} not on PATH (${probe.error?.message || `exit ${probe.status}`})`, hint: cfg.hint };
  }
  return { ok: true, binary: cfg.binary, args: cfg.defaultArgs };
}

export function runServeLsp(args) {
  const language = args[0];
  if (!language || language === '--help' || language === '-h') {
    process.stderr.write('Usage: apg code-intel serve-lsp <language>\n');
    process.stderr.write(`Supported languages: ${Object.keys(LANGUAGE_SERVERS).join(', ')}\n`);
    return language ? 0 : 2;
  }

  const resolved = resolveBinary(language);
  if (!resolved.ok) {
    process.stderr.write(`apg code-intel serve-lsp: ${resolved.message}\n`);
    process.stderr.write(`  hint: ${resolved.hint}\n`);
    return resolved.reason === 'language_unsupported' ? 2 : 3;
  }

  return new Promise((resolve) => {
    const child = spawn(resolved.binary, resolved.args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });

    process.stdin.pipe(child.stdin);
    child.stdout.pipe(process.stdout);

    child.on('error', err => {
      process.stderr.write(`apg code-intel serve-lsp: spawn error: ${err.message}\n`);
      resolve(3);
    });
    child.on('exit', code => resolve(code ?? 0));

    // Forward parent termination signals to the child.
    const fwd = (sig) => { if (!child.killed) try { child.kill(sig); } catch { /* ignore */ } };
    process.on('SIGINT', () => fwd('SIGINT'));
    process.on('SIGTERM', () => fwd('SIGTERM'));
  });
}

export { LANGUAGE_SERVERS };
