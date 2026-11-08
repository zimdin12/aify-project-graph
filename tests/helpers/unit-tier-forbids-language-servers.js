// The UNIT tier runs files in parallel, so a file in it must never start a real language server (#10).
//
// vitest.config.js keeps the real-server files in the serial `lsp` tier because concurrent clangd / tsserver / pyright
// processes starve each other of CPU and a correct cross-file query fails. Which files those are is decided HERE, by
// behaviour, not by remembering a list: in the unit tier, starting one throws and names the fix.
//
// ⛔ A THROW CAN BE SWALLOWED. Product code catches spawn failures and reports "server unavailable", so a test could
// pass on that branch, or skip, and the file would stay in the parallel tier without a word. Every refusal is
// therefore also RECORDED, and the run's teardown fails the run on any record (tests/helpers/temp-root.global.js).
// vitest.config.js loads this module into every node child of a unit-tier test too (NODE_OPTIONS), so a test that
// runs a script which starts a server is caught as well.
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const LANGUAGE_SERVER = /clangd|typescript-language-server|tsserver|pyright|langserver/iu;

function refuseIfLanguageServer(name, command, rest) {
  const args = Array.isArray(rest[0]) ? rest[0] : [];
  const commandLine = [command, ...args].join(' ');
  if (!LANGUAGE_SERVER.test(commandLine)) return;
  const file = process.env.APG_UNIT_TEST_FILE ?? '(unknown test file)';
  try {
    appendFileSync(process.env.APG_LANGUAGE_SERVER_REFUSALS, `${file}\t${name}\t${commandLine}\n`);
  } catch { /* no record path: the throw below still fails the call */ }
  throw new Error(`${name}(${command}) started a real language server from the parallel unit tier (${file}); `
    + 'add this test file to LSP_TIER in vitest.config.js so it runs in the serial lsp tier');
}

function refuseLanguageServer(original, name) {
  function guarded(command, ...rest) {
    refuseIfLanguageServer(name, command, rest);
    return original.call(this, command, ...rest);
  }
  // ⚠ execFile and exec carry a util.promisify.custom that resolves {stdout, stderr}. Without it, promisify falls back
  // to the callback shape and resolves stdout ALONE: a test reading stderr saw '' (reindex-payload, found on the first
  // tiered run). The promisified form is guarded too.
  const custom = original[promisify.custom];
  if (custom) {
    guarded[promisify.custom] = function guardedPromise(command, ...rest) {
      try { refuseIfLanguageServer(name, command, rest); } catch (error) { return Promise.reject(error); }
      return custom.call(this, command, ...rest);
    };
  }
  return guarded;
}

for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  childProcess[name] = refuseLanguageServer(childProcess[name], name);
}
// Named imports (`import { spawn } from 'node:child_process'`) see the guard only after this.
syncBuiltinESMExports();
