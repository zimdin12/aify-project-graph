// Write the MCP config one Claude rehearsal run gets: the pinned dashboard bridge, and nothing else.
// Usage: node set-claude-arm.mjs <A|B> <agentId>   -> prints the path of the written config (never the key).
// Claude Code starts a stdio server in its own working directory, so the run's cwd (the arm root) picks the project.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// Which scratch service: 9781 (c28f08b, no bridge instructions) by default; SVC_DIR/SVC_URL select another, e.g. 9782.
const SVC_DIR = process.env.SVC_DIR || "C:/Docker/aify-trial-service";
const SVC_URL = process.env.SVC_URL || "http://127.0.0.1:9781";

const [arm, agentId] = process.argv.slice(2);
if (!/^[AB]$/u.test(arm ?? '') || !/^[a-z0-9-]+$/u.test(agentId ?? '')) { console.error('usage: set-claude-arm.mjs <A|B> <agent-id>'); process.exit(2); }
const env = Object.fromEntries(readFileSync(`${SVC_DIR}/service.env`, 'utf8')
  .split(/\r?\n/u).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.API_KEY) { console.error('no API_KEY in service.env'); process.exit(3); }
const dir = new URL('./arms/', import.meta.url);
mkdirSync(dir, { recursive: true });
const out = new URL(`claude-${arm}-${agentId}.json`, dir);
writeFileSync(out, JSON.stringify({
  mcpServers: {
    'aify-dashboard': {
      command: 'C:/nvm4w/nodejs/node.exe',
      args: ['--experimental-strip-types', `${SVC_DIR}/app/server/src/bridge/main.ts`, 'serve'],
      env: { AIFY_DASHBOARD_URL: SVC_URL, AIFY_DASHBOARD_API_KEY: env.API_KEY, AIFY_AGENT_ID: agentId },
    },
  },
}, null, 2));
console.log(decodeURIComponent(out.pathname).replace(/^\/([A-Za-z]:)/u, '$1'));
