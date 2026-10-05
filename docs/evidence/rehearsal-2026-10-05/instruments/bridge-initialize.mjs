// Ask a pinned dashboard bridge for its MCP initialize answer and print its `instructions` (never the key).
// Usage: node bridge-initialize.mjs <service-dir> <url>   e.g. C:/Docker/aify-trial-service-c26fd99 http://127.0.0.1:9782
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [dir, url] = process.argv.slice(2);
const key = readFileSync(`${dir}/service.env`, 'utf8').match(/^API_KEY=(.*)$/mu)?.[1]?.trim();
if (!key) { console.error('no API_KEY'); process.exit(3); }
const child = spawn('C:/nvm4w/nodejs/node.exe', ['--experimental-strip-types', `${dir}/app/server/src/bridge/main.ts`, 'serve'], {
  cwd: 'C:/Docker/aify-trial-arms/A/aify-project-graph',
  env: { ...process.env, AIFY_DASHBOARD_URL: url, AIFY_DASHBOARD_API_KEY: key, AIFY_AGENT_ID: 'rh-probe-init' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const done = (code, msg) => { console.log(msg); child.kill(); process.exit(code); };
child.stdout.on('data', (d) => {
  buf += d;
  for (const line of buf.split('\n')) {
    try {
      const m = JSON.parse(line);
      if (m.id === 1) done(0, JSON.stringify({ server: m.result?.serverInfo, instructionsChars: m.result?.instructions?.length ?? 0, instructions: m.result?.instructions ?? null }, null, 1));
    } catch { /* partial line */ }
  }
});
setTimeout(() => done(1, 'TIMEOUT: no initialize answer in 20 s'), 20000);
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })}\n`);
