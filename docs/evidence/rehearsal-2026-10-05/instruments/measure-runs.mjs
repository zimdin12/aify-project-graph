// Measure every finished rehearsal run in runs/: tokens, time, layer use, and the carrier check, each from the run's
// own record. Usage: node measure-runs.mjs   (writes runs/<id>/measure.json and prints one summary line per run)
//
// The carrier check (dashboard-manager, 2026-10-05): a run counts only if no APG tool appears in ANY of its calls,
// and, for Claude, the init record lists aify-dashboard alone. Otherwise the run is VOID, not relabelled.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { measureHermesRun } from 'file:///C:/Docker/aify-project-graph/scripts/lib/hermes-run-usage.mjs';
import { authoredNodeIds } from 'file:///C:/Docker/aify-project-graph/scripts/lib/trial-layer-use.mjs';
import { countHermesLayerUse, callsInRow } from 'file:///C:/Docker/aify-project-graph/scripts/lib/hermes-layer-use.mjs';

const REPO = 'C:/Docker/aify-project-graph';
const MAP_COMMIT = '550643ef';
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const RUNS = `${HERE}runs`;
const ids = authoredNodeIds(JSON.parse(execFileSync('git', ['-C', REPO, 'show', `${MAP_COMMIT}:.aify-graph/functionality.json`], { encoding: 'utf8' })));
const APG = /^mcp__aify[-_]project[-_]graph__/u;
const CREDENTIAL = /service\.env|\.key\b|credentials?\.json|\.aify[\\/]+(?:services|credentials)|auth\.json/giu;
/** Absolute paths a run's write tools targeted (relative ones resolve inside the root by construction). */
function writeTargets(runtime, record) {
  if (runtime === 'claude') {
    return record.split('\n').filter(Boolean).flatMap((l) => { try { return JSON.parse(l)?.message?.content ?? []; } catch { return []; } })
      .filter((c) => c?.type === 'tool_use' && ['Edit', 'Write', 'NotebookEdit'].includes(c.name)).map((c) => c.input?.file_path ?? c.input?.notebook_path);
  }
  const rows = JSON.parse(record);
  return rows.filter((r) => r.role === 'assistant' && r.tool_calls).flatMap((r) => { const c = callsInRow(r); return c.ok ? c.calls : []; })
    .filter((c) => ['patch', 'write_file'].includes(c.name))
    .flatMap((c) => [c.input?.path, ...[...String(c.input?.patch ?? '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gmu)].map((x) => x[1])])
    .filter(Boolean);
}
const node = (script, args) => {
  const r = spawnSync('node', [`${REPO}/scripts/${script}`, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return { exit: r.status, ...JSON.parse(r.stdout) }; } catch { return { exit: r.status, unparsed: r.stdout.slice(0, 500), stderr: r.stderr.slice(0, 500) }; }
};

for (const id of existsSync(RUNS) ? readdirSync(RUNS).sort() : []) {
  const dir = `${RUNS}/${id}`;
  if (!existsSync(`${dir}/meta.json`)) { console.log(`${id}  RUNNING (no meta.json yet)`); continue; }
  const meta =JSON.parse(readFileSync(`${dir}/meta.json`, 'utf8'));
  const m = { id, runtime: meta.runtime, arm: meta.arm, task: meta.task, wallMs: meta.wallMs, exit: meta.exit, sessionId: meta.sessionId };
  if (meta.runtime === 'claude') {
    m.tokens = node('measure-claude-run.mjs', [`${dir}/stream.jsonl`, `${dir}/clock.json`]);
    m.layer = meta.sessionId ? node('measure-layer-use.mjs', [meta.sessionId, '--map-commit', MAP_COMMIT]) : { ok: false, reason: 'no_session' };
    const names = readFileSync(`${dir}/stream.jsonl`, 'utf8').split('\n').filter(Boolean)
      .flatMap((l) => { try { return JSON.parse(l)?.message?.content ?? []; } catch { return []; } })
      .filter((c) => c?.type === 'tool_use').map((c) => c.name);
    m.toolCalls = names.length;
    m.apgCalls = names.filter((n) => APG.test(n)).length;
    m.carrier = { initServers: meta.initServers, initDashboardAlone: JSON.stringify(meta.initServers) === JSON.stringify(['aify-dashboard:connected']) };
    m.void = !m.carrier.initDashboardAlone || m.apgCalls > 0;
  } else {
    const rows = JSON.parse(readFileSync(`${dir}/rows.json`, 'utf8'));
    const usageFile = JSON.parse(readFileSync(`${dir}/usage.json`, 'utf8'));
    m.tokens = measureHermesRun({ usageFile, rows: JSON.parse(readFileSync(`${dir}/state-usage-rows.json`, 'utf8')) });
    const kept = new Map((meta.spills ?? []).filter((s) => s.kept).map((s) => [s.path, `${dir}/spill/${s.kept}`]));
    m.layer = countHermesLayerUse({ rows, ids, readPersisted: (p) => (kept.has(p) ? readFileSync(kept.get(p), 'utf8') : null) });
    const calls = rows.filter((r) => r.role === 'assistant' && r.tool_calls).flatMap((r) => { const c = callsInRow(r); return c.ok ? c.calls : [{ name: `UNPARSED:${c.reason}` }]; });
    m.toolCalls = calls.length;
    m.apgCalls = calls.filter((c) => APG.test(c.name)).length;
    m.apgInSearchResults = rows.filter((r) => r.role === 'tool').reduce((n, r) => n + (String(r.content ?? '').match(/mcp__aify_project_graph__/gu) ?? []).length, 0);
    m.void = m.apgCalls > 0 || calls.some((c) => c.name.startsWith('UNPARSED'));
  }
  // Containment (dashboard-manager, 2026-10-05): approvals were off, so a run could reach anything the user can.
  // A run that read a credential is VOID and reported; every write must land inside its own arm root.
  const record = readFileSync(meta.runtime === 'claude' ? `${dir}/stream.jsonl` : `${dir}/rows.json`, 'utf8');
  m.credentialHits = (record.match(CREDENTIAL) ?? []).length;
  const norm = (p) => String(p).replaceAll('\\', '/').toLowerCase();
  const root = norm(meta.root);
  m.writesOutsideRoot = writeTargets(meta.runtime, record).filter((p) => /^[a-z]:\//u.test(norm(p)) && !norm(p).startsWith(root));
  m.void = m.void || m.credentialHits > 0 || m.writesOutsideRoot.length > 0;
  m.patchBytes = readFileSync(`${dir}/patch.diff`, 'utf8').length;
  writeFileSync(`${dir}/measure.json`, JSON.stringify(m, null, 1));
  const t = m.tokens;
  console.log([id, `void=${m.void}`, `wall=${Math.round(m.wallMs / 1000)}s`, `tokensOk=${t?.ok ?? t?.exit === 0}`, `layer=${m.layer?.layerCalls ?? m.layer?.reason}/${m.layer?.seenCalls ?? '-'}`, `calls=${m.toolCalls}`, `apg=${m.apgCalls}`, `patch=${m.patchBytes}B`].join('  '));
}
