// ONE REHEARSAL RUN: launch it, keep its raw record, its patch and its clock, then reset the arm root.
// Usage: node run-arm.mjs <claude|hermes> <A|B> <T1|T2>
// Writes runs/<runtime>-<arm>-<task>/. Measuring is a separate step (measure-runs.mjs), so a refusal there never
// costs the raw record. Refuses to start when the arm root is dirty or the run directory already exists.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import Database from 'file:///C:/Docker/aify-project-graph/node_modules/better-sqlite3/lib/index.js';

const [runtime, arm, task] = process.argv.slice(2);
if (!/^(claude|hermes)$/u.test(runtime ?? '') || !/^[AB]$/u.test(arm ?? '') || !/^(T1|T2|T1P|T1I)$/u.test(task ?? '')) {
  console.error('usage: run-arm.mjs <claude|hermes> <A|B> <T1|T2|T1P|T1I>'); process.exit(2);
}
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const ROOT = `C:/Docker/aify-trial-arms/${arm}/aify-project-graph`;
const ID = `rh-${runtime}-${arm}-${task}`.toLowerCase();
const OUT = `${HERE}runs/${ID}`;
const PROMPTS = {
  T1: 'graph_callers can answer `NO CALLERS from "<dir>"` for a directory scope that does contain a caller. Reproduction: a target with about 120 heuristic callers in one directory and a single LSP_VERIFIED caller in another directory; asking graph_callers with `file` set to that other directory answers NO CALLERS. Find the cause and fix it, with a test.',
  T2: 'graph_health reports `lspVerifiedPctOfVerifiableInScopeCalls: 4995`, from 949 verified over 19 verifiable. Find the cause and fix it, with tests.',
};
// The A-prompted arm: T1 plus the one line fixed in PROTOCOL.md (cfb83c20) before either prompted run.
PROMPTS.T1P = `${PROMPTS.T1}

This project has a dashboard with project context, available through the aify-dashboard tools.`;
// (c'): T1 unchanged, run against the 9782 service whose bridge sends instructions (SVC_DIR/SVC_URL select it).
PROMPTS.T1I = PROMPTS.T1;
const git = (...args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

if (existsSync(OUT)) { console.error(`${OUT} exists; a run is never repeated into the same directory`); process.exit(3); }
const dirty = git('status', '--porcelain').stdout;
if (dirty.trim() !== '') { console.error(`arm root ${ROOT} is dirty:\n${dirty}`); process.exit(3); }
mkdirSync(OUT, { recursive: true });
const base = git('rev-parse', 'HEAD^{tree}').stdout.trim();

let cmd; let args; let stdoutFile; let hermesProfile = null;
if (runtime === 'claude') {
  const cfg = spawnSync('node', [`${HERE}set-claude-arm.mjs`, arm, ID], { encoding: 'utf8' }).stdout.trim();
  cmd = 'claude';
  args = ['-p', PROMPTS[task], '--strict-mcp-config', `--mcp-config=${cfg}`, '--model', 'claude-sonnet-5-5', '--effort', 'medium',
    '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
  stdoutFile = `${OUT}/stream.jsonl`;
} else {
  hermesProfile = arm === 'A' ? 'rha' : 'rhb';
  const set = spawnSync('node', [`${HERE}set-hermes-arm.mjs`, hermesProfile, arm, ID], { encoding: 'utf8' });
  if (set.status !== 0) { console.error(set.stderr); process.exit(4); }
  cmd = `${process.env.LOCALAPPDATA}/hermes/bin/hermes.exe`;
  args = ['-p', hermesProfile, '-z', PROMPTS[task], '-m', 'gpt-6.1-sol', '--reasoning', 'medium', '--in', ROOT, '--usage-file', `${OUT}/usage.json`];
  stdoutFile = `${OUT}/out.txt`;
}

const startMs = Date.now();
const run = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 60 * 60 * 1000 });
const endMs = Date.now();
writeFileSync(stdoutFile, run.stdout ?? '');
writeFileSync(`${OUT}/stderr.txt`, run.stderr ?? '');
writeFileSync(`${OUT}/clock.json`, JSON.stringify({ startMs, endMs }));

// The agent's patch, untracked files included, then the root back to its base.
git('add', '-A');
writeFileSync(`${OUT}/patch.diff`, git('diff', '--cached', 'HEAD').stdout);
writeFileSync(`${OUT}/patch-stat.txt`, git('diff', '--cached', '--stat', 'HEAD').stdout);
git('reset', '-q', '--hard', 'HEAD');
// -x: ignored files too (an agent's .aify-graph/, caches), so nothing a run made reaches the next run; -e keeps the
// dependency copy, which is not the run's.
git('clean', '-fdxq', '-e', 'node_modules');
const after = git('rev-parse', 'HEAD^{tree}').stdout.trim();

const meta = { runtime, arm, task, id: ID, root: ROOT, baseTree: base, treeAfterReset: after, exit: run.status, signal: run.signal, error: run.error?.message ?? null, wallMs: endMs - startMs };
if (runtime === 'hermes') {
  const usage = existsSync(`${OUT}/usage.json`) ? JSON.parse(readFileSync(`${OUT}/usage.json`, 'utf8')) : null;
  meta.sessionId = usage?.session_id ?? null;
  if (meta.sessionId) {
    const db = new Database(`${process.env.LOCALAPPDATA}/hermes/profiles/${hermesProfile}/state.db`, { readonly: true, fileMustExist: true });
    const rows = db.prepare('select id, role, tool_call_id, tool_name, tool_calls, content from messages where session_id = ? order by id').all(meta.sessionId);
    writeFileSync(`${OUT}/state-usage-rows.json`, JSON.stringify(db.prepare('select * from session_model_usage where session_id = ?').all(meta.sessionId), null, 1));
    db.close();
    writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows, null, 1));
    // Spill files are pruned after 24 hours: keep a copy of every one this run's rows point at.
    mkdirSync(`${OUT}/spill`, { recursive: true });
    meta.spills = [];
    for (const m of rows.map((r) => String(r.content ?? '')).join('\n').matchAll(/^Full output saved to: (.+?)\s*$/gmu)) {
      const name = m[1].split(/[\\/]/u).pop();
      try { copyFileSync(m[1], `${OUT}/spill/${name}`); meta.spills.push({ path: m[1], kept: name }); } catch (e) { meta.spills.push({ path: m[1], kept: null, error: e.message }); }
    }
  }
} else {
  const init = (run.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((l) => l?.type === 'system' && l.subtype === 'init');
  meta.sessionId = init?.session_id ?? null;
  meta.initServers = (init?.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`);
  meta.initModel = init?.model ?? null;
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta));
