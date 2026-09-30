// Does an acknowledgement of a `changed` mark HOLD across commits that change nothing modelled, and RE-OPEN on a
// different change? Run from this repo:
//   node docs/evidence/ack-holds-proof-2026-10-01/run.mjs
//
// The dashboard's step 1 (aify-dashboard 28001b3, schema 39) keys a code mark's condition on the provider's
// CANDIDATE stamp, so the same finding at a later commit keeps its acknowledgement. Their tests pass: PASSES IN
// TESTS. This is the check from the provider's side of the seam, on the provider's real entry points, against
// their real server at that commit.
//
// ⛔ PRE-REGISTERED, written before the first run. The run FAILS if any of these does not hold:
//   A1  a new commit touching only README        -> `changed`, candidate SAME, mark STILL acknowledged, version
//                                                    unchanged, lastReportedAt MOVED (the report arrived)
//   A2  an unrelated function added to the file  -> as A1: the file changed, the finding did not
//   B   alpha instead calls a DIFFERENT function -> `changed`, candidate DIFFERENT, mark RE-OPENED, version moved
// B is the control that makes A mean something: a mark that never re-opened would pass A1 and A2.
// lastReportedAt is the control that makes "still acknowledged" mean something: a sweep that never reached the
// mark would also leave it acknowledged.
//
// ⛔ SCRATCH ON BOTH SIDES. Its own directory and port, a scratch database, a throwaway key that is never
// printed, a new git repo. And their server runs from their shared working tree, so the run REFUSES unless
// `server/` is clean and identical to 28001b3, checked before the service starts and after it stops.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DASHBOARD = process.env.DASHBOARD_CHECKOUT ?? 'C:/Docker/aify-dashboard';
const FIX = '28001b3';
const APG = process.cwd();
const ROOT = join(tmpdir(), 'aify-ack-holds-proof');
const REPO = join(ROOT, 'repo');
const PORT = 9790;
const LIVE_PORT = 9700;
const HOST_KEY = 'ack-holds-proof-host';
const REPORTER = 'apg-ack-holds-proof';
const NL = String.fromCharCode(10);
const UNRELATED = ['export function delta(value) {', '  return value;', '}', ''];
const source = ({ alphaCalls, extra = [] }) => [
  'export function gamma(value) {', '  return value * 2;', '}', '',
  'export function beta(value) {', '  return value - 1;', '}', '',
  'export function alpha(value) {', `  return ${alphaCalls};`, '}', '',
  ...extra,
].join(NL);

const say = (...parts) => console.log(...parts);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const failures = [];
const check = (label, ok, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

function assertServerIsTheFix(when) {
  const dirty = run('git', ['-C', DASHBOARD, 'status', '--porcelain', '--', 'server/']);
  const moved = run('git', ['-C', DASHBOARD, 'diff', '--quiet', FIX, 'HEAD', '--', 'server/']);
  const head = run('git', ['-C', DASHBOARD, 'rev-parse', '--short', 'HEAD']).stdout.trim();
  if (dirty.status !== 0) throw new Error(`${when}: could not read the dashboard's git status`);
  if (dirty.stdout.trim() !== '') throw new Error(`${when}: REFUSING — server/ has uncommitted changes:${NL}${dirty.stdout}`);
  if (moved.status !== 0) throw new Error(`${when}: REFUSING — server/ differs between ${FIX} and HEAD ${head}`);
  return `${when}: server/ clean, identical to ${FIX} (checkout HEAD ${head})`;
}

/** True when something answers on the port. The live service is the positive control for the probe itself. */
async function answers(port) {
  try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

say('== guards ==');
say(assertServerIsTheFix('before start'));
const liveAnswers = await answers(LIVE_PORT);
const scratchTaken = await answers(PORT);
say(`port probe: live ${LIVE_PORT} answers=${liveAnswers} (positive control), scratch ${PORT} answers=${scratchTaken}`);
if (!liveAnswers) throw new Error(`REFUSING — the port probe's positive control (${LIVE_PORT}) did not answer, so "${PORT} is free" would mean nothing`);
if (scratchTaken) throw new Error(`REFUSING — something already listens on ${PORT}`);

if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(REPO, 'src'), { recursive: true });
const git = (...args) => {
  const r = run('git', args, { cwd: REPO });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/** Write the files, commit them, and return the short sha. */
const commitWith = (files, message) => {
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(REPO, rel), text);
  git('add', '-A');
  git('-c', 'user.name=ack proof', '-c', 'user.email=proof@localhost', 'commit', '-q', '-m', message);
  return git('rev-parse', '--short', 'HEAD');
};
git('init', '-q');
say(`C1 ${commitWith({ 'src/proof.js': source({ alphaCalls: 'value + 1' }), 'README.md': `scratch${NL}` }, 'alpha calls nothing')}`);

const key = randomBytes(24).toString('hex');
const env = {
  ...process.env, PORT: String(PORT), BIND_HOST: '127.0.0.1', API_KEY: key,
  PUBLIC_ORIGINS: `http://127.0.0.1:${PORT}`, DATABASE_PATH: join(ROOT, 'dashboard.db'),
  UI_ROOT: join(DASHBOARD, 'ui', 'dist'),
};
delete env.COMMS_BASE_URL;
delete env.BACKUP_DIR;
const log = [];
const child = spawn(process.execPath, ['--experimental-strip-types', join(DASHBOARD, 'server', 'src', 'main.ts')], {
  cwd: DASHBOARD, env, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => log.push(String(c)));
child.stderr.on('data', (c) => log.push(String(c)));

let failure = null;
try {
  for (let i = 0; i < 200 && !/listening on http/u.test(log.join('')); i += 1) {
    if (child.exitCode !== null) throw new Error(`the scratch service exited: ${log.join('').slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/listening on http/u.test(log.join(''))) throw new Error('the scratch service never announced it was listening');

  const base = `http://127.0.0.1:${PORT}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-aify-agent': 'ack-proof-setup' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const health = await api('GET', '/health');
  say(`service: schema ${health.body?.db?.schema?.at}`);

  const canonical = REPO.replace(/\\/gu, '/');
  const project = await api('POST', '/api/v1/projects', { root: { raw: canonical, canonical, machineId: 'aify:ack-proof' }, name: 'ack proof' });
  const projectId = project.body?.project?.id ?? project.body?.id;
  if (typeof projectId !== 'string') throw new Error(`registering the project: ${project.status} ${JSON.stringify(project.body)}`);
  const graph = await api('POST', `/api/v1/projects/${projectId}/graphs`, {
    slug: 'ack', template: 'blank',
    document: { title: 'ack proof', purpose: 'one anchored function', nodes: [{ id: 'alpha', layer: 'things', kind: 'thing', label: 'alpha', anchor: { project: 'aify-ack-proof', path: 'src/proof.js', name: 'alpha', kind: 'symbol' } }], edges: [] },
  });
  if (graph.status !== 201) throw new Error(`creating the graph: ${graph.status} ${JSON.stringify(graph.body)}`);
  const graphId = graph.body.graph.id;

  const providerEnv = {
    ...process.env, APG_DASHBOARD_URL: base, APG_DASHBOARD_PROJECT: projectId, APG_DASHBOARD_HOST: HOST_KEY,
    APG_DASHBOARD_KEY: key, APG_DASHBOARD_REPORTER: REPORTER,
  };
  const provider = (script, args = []) => {
    const r = run(process.execPath, [join(APG, 'scripts', script), ...args], { cwd: REPO, env: providerEnv });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** Post a sweep through the provider's real entry point; return alpha's status and the candidate it printed. */
  const sweep = () => {
    const posted = provider('post-watch-signals.mjs');
    const lines = posted.out.split(NL);
    const at = lines.findIndex((l) => /symbol:alpha/u.test(l));
    const status = at >= 0 ? lines[at].trim().split(/\s+/u)[0] : '(no row)';
    const candidate = at >= 0 ? (lines[at + 1].match(/stamp \S+ ([0-9a-f]+)/u)?.[1] ?? '(none)') : '(none)';
    const verdict = lines.find((l) => l.startsWith('ACCEPTED') || l.startsWith('REFUSED')) ?? posted.out.slice(-300);
    say(`  sweep exit ${posted.status}: ${status}, candidate ${candidate}`);
    say(`  ${verdict}`);
    return { status, candidate };
  };
  const readMark = async () => {
    const marks = await api('GET', `/api/v1/graphs/${graphId}/marks`);
    const found = (marks.body?.all ?? []).filter((m) => m.target === 'alpha' && m.reason === 'code_changed');
    if (found.length !== 1) throw new Error(`expected exactly one code_changed mark on alpha, found ${found.length}: ${JSON.stringify(marks.body)}`);
    const m = found[0];
    say(`  mark: version ${m.version}, acknowledgedAt ${m.acknowledgedAt}, lastReportedAt ${m.lastReportedAt}`);
    return m;
  };
  const pause = () => new Promise((r) => setTimeout(r, 1100));

  say(`${NL}== 1. baseline: reconfirm alpha at C1 ==`);
  const watchId = (await api('GET', `/api/v1/host/${HOST_KEY}/projects/${projectId}/watch-set`)).body.items[0].watchId;
  const rc = provider('reconfirm-anchor.mjs', ['--watch', watchId]);
  say(`  reconfirm exit ${rc.status}: ${rc.out.split(NL).find((l) => l.startsWith('CONFIRMED')) ?? rc.out.slice(-300)}`);

  const c2 = commitWith({ 'src/proof.js': source({ alphaCalls: 'gamma(value) + 1' }) }, 'alpha calls gamma');
  say(`${NL}== 2. C2 ${c2}: alpha starts calling gamma ==`);
  const s2 = sweep();
  check('C2 is `changed`', s2.status === 'changed');
  const m2 = await readMark();
  check('C2 raised an OPEN mark', m2.acknowledgedAt === null);

  say(`${NL}== 3. acknowledge that mark ==`);
  const ack = await api('POST', `/api/v1/graphs/${graphId}/marks/acknowledge`, { target: 'alpha', reason: 'code_changed', version: m2.version });
  say(`  acknowledge: ${ack.status}`);
  const m3 = await readMark();
  check('the mark is acknowledged', ack.status === 200 && m3.acknowledgedAt !== null);

  await pause();
  const c3 = commitWith({ 'README.md': `scratch, edited${NL}` }, 'README only');
  say(`${NL}== A1. C3 ${c3}: README only ==`);
  const s4 = sweep();
  const m4 = await readMark();
  check('A1 is `changed` with the SAME candidate', s4.status === 'changed' && s4.candidate === s2.candidate, `${s4.candidate} vs ${s2.candidate}`);
  check('A1 report REACHED the mark (lastReportedAt moved)', m4.lastReportedAt > m3.lastReportedAt);
  check('A1 mark STILL acknowledged, version unchanged', m4.acknowledgedAt !== null && m4.version === m3.version);

  await pause();
  const c4 = commitWith({ 'src/proof.js': source({ alphaCalls: 'gamma(value) + 1', extra: UNRELATED }) }, 'an unrelated function beside alpha');
  say(`${NL}== A2. C4 ${c4}: an unrelated function added to the same file ==`);
  const s5 = sweep();
  const m5 = await readMark();
  check('A2 is `changed` with the SAME candidate', s5.status === 'changed' && s5.candidate === s2.candidate, `${s5.candidate} vs ${s2.candidate}`);
  check('A2 report REACHED the mark', m5.lastReportedAt > m4.lastReportedAt);
  check('A2 mark STILL acknowledged, version unchanged', m5.acknowledgedAt !== null && m5.version === m3.version);

  await pause();
  const c5 = commitWith({ 'src/proof.js': source({ alphaCalls: 'beta(value) + 1', extra: UNRELATED }) }, 'alpha calls beta instead');
  say(`${NL}== B. C5 ${c5}: alpha calls beta instead of gamma ==`);
  const s6 = sweep();
  const m6 = await readMark();
  check('B is `changed` with a DIFFERENT candidate', s6.status === 'changed' && s6.candidate !== s2.candidate && s6.candidate !== '(none)', `${s6.candidate} vs ${s2.candidate}`);
  check('B RE-OPENED the mark, version moved', m6.acknowledgedAt === null && m6.version > m5.version);
} catch (error) {
  failure = error;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  say(`${NL}== guard ==`);
  try { say(assertServerIsTheFix('after stop')); } catch (error) { failure = failure ?? error; say(error.message); }
  rmSync(ROOT, { recursive: true, force: true });
}
if (failure) { console.error(`RUN FAILED: ${failure.message}`); process.exit(1); }
say(`${NL}${failures.length === 0 ? 'ALL PRE-REGISTERED CHECKS HELD' : `${failures.length} CHECK(S) FAILED: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
