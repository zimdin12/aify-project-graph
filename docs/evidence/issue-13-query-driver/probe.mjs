// #13 probe: does dropping `--query-driver=*` change clangd's result on a real compile DB on this host?
// Runs `clangd --check=<file>` twice with the env and args APG builds, once with the old flag added back.
// Usage: node docs/evidence/issue-13-query-driver/probe.mjs <compile-db-dir> <source-file>
import { spawnSync } from 'node:child_process';
import { buildClangdSpawn } from '../../../mcp/stdio/code-intel/resolve-clangd.js';

const [dbDir, file] = process.argv.slice(2);
const { command, args, env } = buildClangdSpawn({ env: process.env, compileDb: { found: true, normalizedDir: dbDir } });
console.log(`clangd ${command}`);
console.log(`APG args carry --query-driver: ${args.some((a) => a.startsWith('--query-driver'))}`);
const keep = (a) => a.startsWith('--compile-commands-dir');
for (const [label, extra] of [['now (no --query-driver)', []], ['old (--query-driver=*)', ['--query-driver=*']]]) {
  const r = spawnSync(command, [...args.filter(keep), ...extra, `--check=${file}`],
    { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const log = `${r.stdout}${r.stderr}`;
  // Every clangd error, diagnostics included, is an `E[` line; the same config error in both runs is the control
  // that this count sees errors at all.
  const errors = log.split('\n').filter((l) => /^E\[/u.test(l));
  console.log(`${label.padEnd(26)} exit=${r.status} errorLines=${errors.length} `
    + `ranADriver=${/System include extraction: driver/u.test(log)}`);
  for (const l of errors.slice(0, 3)) console.log(`  ${l.slice(0, 200)}`);
}
