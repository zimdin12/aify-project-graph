// Does the dashboard's fix (b) stop a RE-POINTED anchor from being reported as a code change? Run from this repo:
//   node docs/evidence/repoint-proof-2026-10-01/run.mjs
//
// The defect, measured 2026-10-01 through this repo's resolver: edit an anchor to name a DIFFERENT function
// (same kind, same file, NO code change) and the sweep reported `changed` — "the code behind this changed" —
// because a stamp did not record what it was a stamp OF, and a watchId survives document revisions. The dashboard
// fixed it at ed1f440 by snapshotting the whole anchor into the baseline row and sending `stamp: null` when the
// current anchor differs. Their tests pass (8 of 8 named mutations red). This is the check from the OTHER side of
// the seam, on the provider's real entry points, against their real server.
//
// ⛔ SCRATCH ON BOTH SIDES. Its own directory and port (NOT the v0.9 run's, whose setup deletes its directory), a
// scratch database, a throwaway key, a new git repo. Nothing touches the operator's service or any real repository.
//
// ⛔ AND THEIR SERVER RUNS FROM THEIR WORKING TREE, which is shared and has had mutation testing editing it. So the
// run REFUSES unless `server/` is clean and unchanged since ed1f440, checked immediately before the service starts
// and again after it stops. A verification of a mutant would be worse than none.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DASHBOARD = process.env.DASHBOARD_CHECKOUT ?? 'C:/Docker/aify-dashboard';
const FIX = 'ed1f440';
const APG = process.cwd();
const ROOT = join(tmpdir(), 'aify-repoint-proof');
const REPO = join(ROOT, 'repo');
const PORT = 9789;
const HOST_KEY = 'repoint-proof-host';
const REPORTER = 'apg-repoint-proof';
const NL = String.fromCharCode(10);
const SOURCE = [
  'export function alpha(value) {', '  return value + 1;', '}', '',
  'export function beta(value) {', '  return value - 1;', '}', '',
].join(NL);

const say = (...parts) => console.log(...parts);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

/** Their server source must be exactly the fix. Returns a description, or throws. */
function assertServerIsTheFix(when) {
  const dirty = run('git', ['-C', DASHBOARD, 'status', '--porcelain', '--', 'server/']);
  const moved = run('git', ['-C', DASHBOARD, 'diff', '--quiet', FIX, 'HEAD', '--', 'server/']);
  const head = run('git', ['-C', DASHBOARD, 'rev-parse', '--short', 'HEAD']).stdout.trim();
  if (dirty.status !== 0) throw new Error(`${when}: could not read the dashboard's git status`);
  if (dirty.stdout.trim() !== '') throw new Error(`${when}: REFUSING — server/ has uncommitted changes:${NL}${dirty.stdout}`);
  if (moved.status !== 0) throw new Error(`${when}: REFUSING — server/ differs between ${FIX} and HEAD ${head}`);
  return `${when}: server/ clean, identical to ${FIX} (checkout HEAD ${head})`;
}

say('== guard ==');
say(assertServerIsTheFix('before start'));

// ── A fresh scratch area, ours alone.
if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(REPO, 'src'), { recursive: true });
writeFileSync(join(REPO, 'src', 'proof.js'), SOURCE);
const git = (...args) => {
  const r = run('git', args, { cwd: REPO });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=repoint proof', '-c', 'user.email=proof@localhost', 'commit', '-q', '-m', 'alpha and beta');
const head = git('rev-parse', 'HEAD');

// ── Their server, on a scratch database, with a throwaway key that is never printed.
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
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-aify-agent': 'repoint-proof-setup' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const health = await api('GET', '/health');
  say(`service: gitSha ${String(health.body?.gitSha).slice(0, 8)}, schema ${health.body?.db?.schema?.at}`);

  const canonical = REPO.replace(/\\/gu, '/');
  const project = await api('POST', '/api/v1/projects', { root: { raw: canonical, canonical, machineId: 'aify:repoint-proof' }, name: 'repoint proof' });
  const projectId = project.body?.project?.id ?? project.body?.id;
  if (typeof projectId !== 'string') throw new Error(`registering the project: ${project.status} ${JSON.stringify(project.body)}`);
  const anchorFor = (name) => ({ project: 'aify-repoint-proof', path: 'src/proof.js', name, kind: 'symbol' });
  // ONE node, id "alpha". The id is what the watchId is derived from, so it stays fixed while its anchor moves.
  const graph = await api('POST', `/api/v1/projects/${projectId}/graphs`, {
    slug: 'repoint', template: 'blank',
    document: { title: 'repoint proof', purpose: 'one node, re-pointed', nodes: [{ id: 'alpha', layer: 'things', kind: 'thing', label: 'alpha', anchor: anchorFor('alpha') }], edges: [] },
  });
  if (graph.status !== 201) throw new Error(`creating the graph: ${graph.status} ${JSON.stringify(graph.body)}`);
  const graphId = graph.body.graph.id;
  let revision = graph.body.graph.revision;
  const edit = async (fields) => {
    const r = await api('POST', `/api/v1/graphs/${graphId}/edit`, { base: revision, ops: [{ op: 'updateNode', id: 'alpha', fields }] });
    if (r.status !== 200) throw new Error(`editing the graph: ${r.status} ${JSON.stringify(r.body)}`);
    revision = r.body.graph.revision;
  };

  // The provider's real entry points, run the way a provider runs them: in the repo, configured by environment.
  const providerEnv = {
    ...process.env, APG_DASHBOARD_URL: base, APG_DASHBOARD_PROJECT: projectId, APG_DASHBOARD_HOST: HOST_KEY,
    APG_DASHBOARD_KEY: key, APG_DASHBOARD_REPORTER: REPORTER,
  };
  const provider = (script, args = []) => {
    const r = run(process.execPath, [join(APG, 'scripts', script), ...args], { cwd: REPO, env: providerEnv });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const watchSet = async () => (await api('GET', `/api/v1/host/${HOST_KEY}/projects/${projectId}/watch-set`)).body;
  const alphaItem = async () => (await watchSet()).items.find((i) => i.watchId.endsWith(':alpha'));
  const verdictLine = (out) => out.split(NL).find((l) => /symbol:/u.test(l))?.trim() ?? '(no verdict line)';
  const stampOf = (item) => (item.stamp === null ? 'null' : `${item.stamp.hash.slice(0, 12)} @ ${item.stamp.commit.slice(0, 8)}`);

  say(`${NL}== 1. baseline: reconfirm the node while it names alpha ==`);
  const watchId = (await alphaItem()).watchId;
  const rc = provider('reconfirm-anchor.mjs', ['--watch', watchId]);
  say(`reconfirm exit ${rc.status}: ${rc.out.split(NL).find((l) => l.startsWith('CONFIRMED')) ?? rc.out.slice(-300)}`);
  say(`stamp now: ${stampOf(await alphaItem())}`);

  say(`${NL}== 2. CONTROL: sweep the untouched anchor ==`);
  const c1 = provider('post-watch-signals.mjs', ['--dry-run']);
  say(`verdict: ${verdictLine(c1.out)}`);

  say(`${NL}== 3. CONTROL: edit an UNRELATED field (the label) — the baseline must SURVIVE ==`);
  await edit({ label: 'alpha, relabelled' });
  say(`revision ${revision}; stamp now: ${stampOf(await alphaItem())}`);
  const c2 = provider('post-watch-signals.mjs', ['--dry-run']);
  say(`verdict: ${verdictLine(c2.out)}`);

  say(`${NL}== 4. RE-POINT: the same node now names beta. No code changed. ==`);
  await edit({ anchor: anchorFor('beta') });
  const after = await alphaItem();
  say(`revision ${revision}; same watchId: ${after.watchId === watchId}; anchor.name ${after.anchor.name}; stamp now: ${stampOf(after)}`);
  const dry = provider('post-watch-signals.mjs', ['--dry-run']);
  say(`verdict (dry run): ${verdictLine(dry.out)}`);

  say(`${NL}== 5. POST that sweep, and read what the page is told ==`);
  const posted = provider('post-watch-signals.mjs');
  say(posted.out.split(NL).find((l) => l.startsWith('ACCEPTED') || l.startsWith('REFUSED')) ?? posted.out.slice(-400));
  const marks = await api('GET', `/api/v1/graphs/${graphId}/marks`);
  say(`marks on the graph: ${JSON.stringify(marks.body)}`);
} catch (error) {
  failure = error;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  say(`${NL}== guard ==`);
  try { say(assertServerIsTheFix('after stop')); } catch (error) { failure = failure ?? error; say(error.message); }
  rmSync(ROOT, { recursive: true, force: true });
}
if (failure) {
  console.error(`RUN FAILED: ${failure.message}`);
  process.exit(1);
}
