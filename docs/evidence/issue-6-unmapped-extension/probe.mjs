// #6 probe: does a live verb on a file no language server handles start one anyway?
// Calls the REAL code_intel_references (no spawn stub) from the APG checkout given, on real files, and records every
// process this probe spawned. Run it against an older checkout and the current one to see before and after.
// Usage: node docs/evidence/issue-6-unmapped-extension/probe.mjs <apg-checkout> <repo> <file> [<repo> <file> ...]
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [apg, ...pairs] = process.argv.slice(2);
// Before the fix a PHP file reached clangd, whose "invalid AST" error escaped as an unhandled rejection and ended the
// process. Recorded here so every file still gets its line.
for (const event of ['unhandledRejection', 'uncaughtException']) {
  process.on(event, (e) => console.log(`  ${event} from the language server: ${e?.message ?? e} (this ends an unguarded process)`));
}
const live = await import(pathToFileURL(join(apg, 'mcp/stdio/query/verbs/code_intel_live.js')).href);
const { shutdownAllSessions } = await import(pathToFileURL(join(apg, 'mcp/stdio/code-intel/live.js')).href);
const children = () => JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Select-Object ProcessId,Name | ConvertTo-Json -Compress`],
{ encoding: 'utf8' }) || '[]');
const asList = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean).filter((p) => !/powershell|conhost/iu.test(p.Name));

console.log(`apg checkout ${apg} at ${execFileSync('git', ['-C', apg, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()}`);
for (let i = 0; i < pairs.length; i += 2) {
  const [repoRoot, file] = [pairs[i], pairs[i + 1]];
  const out = await Promise.race([
    live.codeIntelReferences({ repoRoot, file, line: 1, col: 1, warmupMs: 0 }),
    new Promise((r) => setTimeout(() => r({ status: 'probe-timeout-20s' }), 20_000)),
  ]);
  const started = asList(children());
  console.log(`${file.padEnd(40)} -> ${out.errors?.[0]?.code ?? out.status}; language servers started: ${started.map((p) => p.Name).join(', ') || 'none'}`);
  await shutdownAllSessions();
}
process.exit(0);
