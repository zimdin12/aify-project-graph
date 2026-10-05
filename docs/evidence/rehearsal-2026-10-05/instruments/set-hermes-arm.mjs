// Point one hermes profile at the pinned dashboard bridge for one rehearsal arm, as its ONLY MCP server.
// Usage: node set-hermes-arm.mjs <profile> <A|B> <agentId>
// The API key is read from the scratch service's env file and written into the profile config; it is never printed.
import { readFileSync, writeFileSync } from 'node:fs';
// Which scratch service: 9781 (c28f08b, no bridge instructions) by default; SVC_DIR/SVC_URL select another, e.g. 9782.
const SVC_DIR = process.env.SVC_DIR || "C:/Docker/aify-trial-service";
const SVC_URL = process.env.SVC_URL || "http://127.0.0.1:9781";

const [profile, arm, agentId] = process.argv.slice(2);
if (!/^rh[ab]$/u.test(profile ?? '') || !/^[AB]$/u.test(arm ?? '') || !/^[a-z0-9-]+$/u.test(agentId ?? '')) {
  console.error('usage: set-hermes-arm.mjs <rha|rhb> <A|B> <agent-id>');
  process.exit(2);
}
const configPath = `${process.env.LOCALAPPDATA.replaceAll('\\', '/')}/hermes/profiles/${profile}/config.yaml`;
const env = Object.fromEntries(readFileSync(`${SVC_DIR}/service.env`, 'utf8')
  .split(/\r?\n/u).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.API_KEY) { console.error('no API_KEY in service.env'); process.exit(3); }
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
// Hermes' terminal puts its own Node 26 ahead of the system Node 22, and this checkout's better-sqlite3 is built for 22,
// so a Hermes agent could not run the repo's tests while a Claude agent could. The init file puts Node 22 first, for
// this profile only (terminal.shell_init_files, honoured on Windows when explicit: tools/environments/local.py).
const initPath = `${configPath.replace(/config\.yaml$/u, '')}node22.sh`;
writeFileSync(initPath, 'export PATH="/c/nvm4w/nodejs:$PATH"\n');
const original = readFileSync(configPath, 'utf8');
const head = original.split(/^(?:terminal|mcp_servers):/mu)[0].replace(/\s*$/u, '\n');
const block = [
  'terminal:',
  '  shell_init_files:',
  `    - ${initPath}`,
  'mcp_servers:',
  '  aify-dashboard:',
  '    command: C:/nvm4w/nodejs/node.exe',
  '    args:',
  '      - --experimental-strip-types',
  `      - ${SVC_DIR}/app/server/src/bridge/main.ts`,
  '      - serve',
  `    cwd: C:/Docker/aify-trial-arms/${arm}/aify-project-graph`,
  '    env:',
  `      AIFY_DASHBOARD_URL: ${SVC_URL}`,
  `      AIFY_DASHBOARD_API_KEY: ${q(env.API_KEY)}`,
  `      AIFY_AGENT_ID: ${agentId}`,
  '',
].join('\n');
writeFileSync(configPath, head + block);
console.log(`${profile}: arm ${arm}, agent ${agentId}, cwd C:/Docker/aify-trial-arms/${arm}/aify-project-graph (key written, not shown)`);
