// #20 probe: does the real teardown leave language-server processes behind?
// Starts APG's real live sessions (typescript, python, cpp) on this repository through getLiveSession, records
// every descendant process of this probe, runs shutdownAllSessions(), and lists which recorded pids still exist.
// Usage: node docs/evidence/issue-20-teardown/probe.mjs <repo-root>
import { execFileSync } from 'node:child_process';
import { getLiveSession, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';

const repo = process.argv[2];
function processTable() {
  const cmd = process.platform === 'win32'
    ? ['powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress']]
    : ['ps', ['-eo', 'pid=,ppid=,comm=']];
  const out = execFileSync(cmd[0], cmd[1], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (process.platform === 'win32') return JSON.parse(out).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name }));
  return out.trim().split('\n').map((l) => { const [pid, ppid, ...n] = l.trim().split(/\s+/u); return { pid: +pid, ppid: +ppid, name: n.join(' ') }; });
}
function descendantsOf(root, table) {
  const found = [];
  let frontier = [root];
  while (frontier.length) {
    const next = table.filter((p) => frontier.includes(p.ppid) && p.pid !== root);
    found.push(...next);
    frontier = next.map((p) => p.pid);
  }
  return found;
}

for (const language of ['typescript', 'python', 'cpp']) {
  try { await getLiveSession({ language, projectRoot: repo }); console.log(`started ${language}`); }
  catch (e) { console.log(`could not start ${language}: ${e.code ?? e.message}`); }
}
const before = descendantsOf(process.pid, processTable()).filter((p) => !/^(powershell|conhost|ps)/iu.test(p.name));
console.log(`descendants before teardown: ${before.length}`);
for (const p of before) console.log(`  ${p.pid} ${p.name} (parent ${p.ppid})`);
const t0 = Date.now();
await shutdownAllSessions();
console.log(`shutdownAllSessions resolved in ${Date.now() - t0} ms`);
await new Promise((r) => setTimeout(r, 3000));
const alive = new Set(processTable().map((p) => p.pid));
const survivors = before.filter((p) => alive.has(p.pid));
console.log(`still running 3 s later: ${survivors.length}`);
for (const p of survivors) console.log(`  ${p.pid} ${p.name}`);
// Clean up anything that survived, so the probe leaves nothing behind.
for (const p of survivors) { try { process.kill(p.pid); } catch { /* gone */ } }
process.exit(0);
