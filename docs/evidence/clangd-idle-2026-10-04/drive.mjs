// Drive N concurrent code-intel sessions against one C++ repo and record clangd's footprint from the OS.
//
//   node drive.mjs --apg <repo> --subject <repo> --sessions N --observe-idle <s> --out <dir> [--env K=V ...]
//
// Every second it records, from the operating system and never from APG:
//   - clangd processes that did not exist before the run (WSL `ps`: clangd runs under WSL with APG_CLANGD_WSL=1):
//     count, summed RSS (GB) and summed %CPU;
//   - the host's free memory (os.freemem, the OS's own figure).
// After every session prints DONE it keeps sampling for --observe-idle seconds and records when the count of OUR
// clangds first reaches 0. Then it kills the sessions and reports any of our clangds still alive (orphans), killing
// only those PIDs: other agents may run their own clangd in the same WSL.
import { spawn, execFileSync } from 'node:child_process';
import { freemem, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const envPairs = args.flatMap((a, i) => (a === '--env' ? [args[i + 1]] : []));
const apg = opt('--apg');
const subject = opt('--subject');
const sessions = Number(opt('--sessions', '1'));
const observeIdleS = Number(opt('--observe-idle', '0'));
const out = opt('--out');
if (!apg || !subject || !out || !Number.isInteger(sessions) || sessions < 1) throw new Error('missing or bad arguments');
mkdirSync(out, { recursive: true });

const GB = 1024 ** 3;
// BOTH SIDES. A first run read 0 clangds on the WSL side while the calls returned real references, so a clangd ran
// somewhere this did not look. Each process is tagged with its side; Windows PIDs are prefixed so they never collide.
const wslClangds = () => {
  const text = execFileSync('wsl.exe', ['-e', 'ps', '-ww', '-eo', 'pid=,rss=,pcpu=,comm='], { encoding: 'utf8', env: { ...process.env, COLUMNS: '200' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return text.split('\n').map((l) => l.trim().split(/\s+/u)).filter((f) => String(f[3] ?? '').startsWith('clangd'))
    .map(([pid, rss, pcpu]) => ({ pid: `wsl:${pid}`, side: 'wsl', rssKB: Number(rss), pcpu: Number(pcpu) }));
};
// tasklist gives the working set in KB as text ("123,456 K"); CPU is not in it, so Windows CPU is left out, not guessed.
const tasklist = (image) => {
  const text = execFileSync('tasklist', ['/FO', 'CSV', '/NH', '/FI', `IMAGENAME eq ${image}`], { encoding: 'utf8' });
  return text.split('\n').filter((l) => l.startsWith('"')).map((l) => l.split('","').map((c) => c.replace(/"/gu, '')))
    .map((c) => ({ pid: `win:${c[1]}`, side: 'win', rssKB: Number(String(c[4]).replace(/[^0-9]/gu, '')), pcpu: 0 }));
};
const allClangds = () => [...wslClangds(), ...tasklist('clangd.exe')];
const vmmemGB = () => +(tasklist('vmmemWSL').reduce((a, p) => a + p.rssKB, 0) / 1048576).toFixed(2);
const baseline = new Set(allClangds().map((p) => p.pid));
// POSITIVE CONTROL of the instrument, before anything runs: a sampler that can never see a clangd reports 0 for every
// run. The WSL `ps` must list at least one process at all, and tasklist must find this node process.
const instrumentCheck = {
  wslPsLines: execFileSync('wsl.exe', ['-e', 'ps', '-eo', 'pid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').length,
  tasklistSeesNode: tasklist('node.exe').some((p) => p.pid === `win:${process.pid}`),
};
if (instrumentCheck.wslPsLines < 1 || !instrumentCheck.tasklistSeesNode) throw new Error(`instrument cannot see processes: ${JSON.stringify(instrumentCheck)}`);

const env = { ...process.env, ...Object.fromEntries(envPairs.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])) };
const t0 = Date.now();
const workers = [];
const doneAt = new Map();
const callLog = [];
for (let i = 0; i < sessions; i += 1) {
  const label = `s${i + 1}`;
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'session-worker.mjs'), apg, subject, label], { env });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      try { const j = JSON.parse(line); if (j.done) doneAt.set(label, Date.now() - t0); else callLog.push({ t: Date.now() - t0, ...j }); } catch { /* ignore non-JSON */ }
    }
  });
  child.stderr.on('data', () => {});
  workers.push(child);
}

const samples = [];
let ours = new Set();
let zeroAfterDoneAt = null;
let lastDoneAt = null;
const sample = () => {
  const procs = allClangds().filter((p) => !baseline.has(p.pid));
  for (const p of procs) ours.add(p.pid);
  const s = {
    t: Date.now() - t0, count: procs.length, wsl: procs.filter((p) => p.side === 'wsl').length, win: procs.filter((p) => p.side === 'win').length,
    rssGB: +(procs.reduce((a, p) => a + p.rssKB, 0) / 1048576).toFixed(3), wslCpuPct: +procs.reduce((a, p) => a + p.pcpu, 0).toFixed(1),
    freeGB: +(freemem() / GB).toFixed(2), vmmemGB: vmmemGB(),
  };
  samples.push(s);
  if (doneAt.size === sessions && lastDoneAt === null) lastDoneAt = Math.max(...doneAt.values());
  if (lastDoneAt !== null && zeroAfterDoneAt === null && s.count === 0 && ours.size > 0) zeroAfterDoneAt = s.t;
  return s;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD_LIMIT_MS = 30 * 60_000;
while (doneAt.size < sessions && Date.now() - t0 < HARD_LIMIT_MS) { sample(); await sleep(1000); }
const allDone = doneAt.size === sessions;
const idleUntil = Date.now() + observeIdleS * 1000;
while (allDone && Date.now() < idleUntil) { sample(); await sleep(1000); }

for (const w of workers) { try { execFileSync('taskkill', ['/PID', String(w.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
await sleep(5000);
const orphans = allClangds().filter((p) => ours.has(p.pid));
for (const p of orphans) {
  const pid = p.pid.slice(4);
  try {
    if (p.side === 'wsl') execFileSync('wsl.exe', ['-e', 'kill', pid], { stdio: 'ignore' });
    else execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
  } catch { /* gone */ }
}

const active = samples.filter((s) => lastDoneAt === null || s.t <= lastDoneAt);
const peak = (xs, k) => xs.reduce((m, s) => Math.max(m, s[k]), 0);
const summary = {
  sessions, env: envPairs, instrumentCheck, allDone, doneAtMs: Object.fromEntries(doneAt), lastDoneAtMs: lastDoneAt,
  ourClangdsSeen: ours.size, ourClangdSides: [...ours].map((p) => p.slice(0, 3)), baselineClangds: baseline.size,
  activePeakCount: peak(active, 'count'), activePeakRssGB: peak(active, 'rssGB'), activePeakWslCpuPct: peak(active, 'wslCpuPct'),
  hostTotalGB: +(totalmem() / GB).toFixed(1), hostFreeMinGB: Math.min(...samples.map((s) => s.freeGB)), hostFreeAtStartGB: samples[0]?.freeGB ?? null,
  vmmemStartGB: samples[0]?.vmmemGB ?? null, vmmemPeakGB: peak(samples, 'vmmemGB'), vmmemEndGB: samples.at(-1)?.vmmemGB ?? null,
  observedIdleS: observeIdleS, idleZeroAfterLastCallMs: zeroAfterDoneAt === null || lastDoneAt === null ? null : zeroAfterDoneAt - lastDoneAt,
  countAtEndOfIdle: samples.at(-1)?.count ?? null, orphansAfterKill: orphans.length,
  callStatuses: callLog.reduce((a, c) => { a[c.status] = (a[c.status] ?? 0) + 1; return a; }, {}),
};
writeFileSync(join(out, 'samples.json'), JSON.stringify(samples));
writeFileSync(join(out, 'calls.jsonl'), callLog.map((c) => JSON.stringify(c)).join('\n') + '\n');
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
process.exit(0);
