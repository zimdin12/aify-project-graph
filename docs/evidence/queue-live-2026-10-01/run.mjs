// The provider request queue, served for real for the first time: calls queued on the dashboard, claimed and
// answered by this provider's one-shot server. Run from this repo:
//   node docs/evidence/queue-live-2026-10-01/run.mjs
//
// The service half (aify-dashboard 36b6217: PROVIDER_CALLS resolve, stamp, subgraph) PASSES IN TESTS, and nothing
// has ever claimed a queued call. This queues real calls on a scratch service built from that commit and serves them
// with scripts/serve-provider-requests.mjs.
//
// ⛔ PRE-REGISTERED, written before the first run. The run FAILS if any of these does not hold:
//   Q1 every queued call is accepted (201), and a queued `signals` is refused (400): 36b6217 removed it
//   Q2 one server run answers EVERY claimed call and the service stores each (exit 0, one STORED line per call)
//   Q3 the stored rows say what the provider said: ok calls carry provenance with providerCommit = HEAD and
//      exhaustive = false; subgraph is stored as a failure with its problem; an empty `anchors` is a failure
//   Q4 stamp and resolve answers, read back from the database: alpha stamped at HEAD; the two `run` methods
//      `ambiguous` with both candidates; a missing file `gone`; an unsupported anchor kind `unwatched`
//   Q5 the WORKING TREE DOES NOT MATTER: with alpha edited and b.js deleted in the tree but not committed, a stamp of
//      alpha equals the clean one and b.js resolves `found`
//   Q6 CONTROL for Q5: once the edit is COMMITTED, the stamp of alpha differs, so the instrument can see a change
//   Q7 an empty queue: a server run claims 0 and exits 0
//
// ⛔ THE SERVER IS 36b6217 BY CONSTRUCTION (`git archive`), never their working tree. Their node_modules is reached
// through a junction that is removed FIRST on cleanup, with their packages checked present before anything is deleted.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const Database = createRequire(import.meta.url)('better-sqlite3');
const DASHBOARD = process.env.DASHBOARD_CHECKOUT ?? 'C:/Docker/aify-dashboard';
const FIX = '36b6217';
const APG = process.cwd();
const ROOT = join(tmpdir(), 'aify-queue-live-proof');
const SERVER = join(ROOT, 'dashboard');
const LINK = join(SERVER, 'node_modules');
const THEIR_MODULES = join(DASHBOARD, 'node_modules');
const REPO = join(ROOT, 'repo');
const DB = join(ROOT, 'dashboard.db');
const PORT = 9793;
const LIVE_PORT = 9700;
const HOST_KEY = 'queue-proof-host';
const NL = String.fromCharCode(10);
const A_JS = ['export function gamma(v) {', '  return v * 2;', '}', '', 'export function alpha(v) {', '  return gamma(v) + 1;', '}', '',
  'export class First {', '  run() { return 1; }', '}', '', 'export class Second {', '  run() { return 2; }', '}', ''].join(NL);
const B_JS = ['export function beta(v) {', '  return v - 1;', '}', ''].join(NL);

const say = (...parts) => console.log(...parts);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const failures = [];
const check = (label, ok, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
};
async function answers(port) {
  try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}
function removeJunctionSafely() {
  let isLink = false;
  try { isLink = lstatSync(LINK).isSymbolicLink(); } catch { return; }
  if (!isLink) throw new Error(`REFUSING to clean up: ${LINK} is not a link`);
  rmdirSync(LINK);
  if (!existsSync(join(THEIR_MODULES, '@hono'))) throw new Error('THEIR node_modules IS GONE AFTER UNLINKING — stop');
}
function cleanUp() {
  removeJunctionSafely();
  let stillLinked = true;
  try { lstatSync(LINK); } catch { stillLinked = false; }
  if (stillLinked) throw new Error('REFUSING to delete the scratch area: the junction is still there');
  rmSync(ROOT, { recursive: true, force: true });
}

say('== guards ==');
const fixSha = run('git', ['-C', DASHBOARD, 'rev-parse', `${FIX}^{commit}`]).stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(fixSha)) throw new Error(`REFUSING — ${FIX} does not resolve`);
say(`server code: git archive of ${fixSha} (their working tree is NOT used)`);
const liveAnswers = await answers(LIVE_PORT);
const scratchTaken = await answers(PORT);
say(`port probe: live ${LIVE_PORT} answers=${liveAnswers} (positive control), scratch ${PORT} answers=${scratchTaken}`);
if (!liveAnswers) throw new Error(`REFUSING — the port probe's positive control (${LIVE_PORT}) did not answer`);
if (scratchTaken) throw new Error(`REFUSING — something already listens on ${PORT}`);
if (!existsSync(join(THEIR_MODULES, '@hono'))) throw new Error('REFUSING — their node_modules is not where expected');

if (existsSync(ROOT)) cleanUp();
mkdirSync(SERVER, { recursive: true });
if (run('git', ['-C', DASHBOARD, 'archive', '--format=tar', `-o${join(ROOT, 'dash.tar')}`, fixSha, 'server', 'package.json', 'VERSION', 'config']).status !== 0) throw new Error('git archive failed');
if (run('tar', ['-xf', '../dash.tar'], { cwd: SERVER }).status !== 0) throw new Error('tar failed');
symlinkSync(THEIR_MODULES, LINK, 'junction');

mkdirSync(join(REPO, 'src'), { recursive: true });
const git = (...args) => { const r = run('git', args, { cwd: REPO }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const commit = (m) => { git('add', '-A'); git('-c', 'user.name=p', '-c', 'user.email=p@localhost', 'commit', '-q', '-m', m); return git('rev-parse', 'HEAD'); };
writeFileSync(join(REPO, 'src', 'a.js'), A_JS);
writeFileSync(join(REPO, 'src', 'b.js'), B_JS);
git('init', '-q');
let head = commit('alpha, two run methods, beta');

const key = randomBytes(24).toString('hex');
const env = { ...process.env, PORT: String(PORT), BIND_HOST: '127.0.0.1', API_KEY: key, PUBLIC_ORIGINS: `http://127.0.0.1:${PORT}`, DATABASE_PATH: DB, UI_ROOT: join(DASHBOARD, 'ui', 'dist') };
delete env.COMMS_BASE_URL;
delete env.BACKUP_DIR;
const log = [];
const child = spawn(process.execPath, ['--experimental-strip-types', join(SERVER, 'server', 'src', 'main.ts')], { cwd: SERVER, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (c) => log.push(String(c)));
child.stderr.on('data', (c) => log.push(String(c)));

let failure = null;
const queued = {};
let projectId;
try {
  for (let i = 0; i < 300 && !/listening on http/u.test(log.join('')); i += 1) {
    if (child.exitCode !== null) throw new Error(`the scratch service exited: ${log.join('').slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/listening on http/u.test(log.join(''))) throw new Error('the scratch service never announced it was listening');
  const base = `http://127.0.0.1:${PORT}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-aify-agent': 'queue-proof-operator' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  say(`service: schema ${(await api('GET', '/health')).body?.db?.schema?.at}`);
  const canonical = REPO.replace(/\\/gu, '/');
  const project = await api('POST', '/api/v1/projects', { root: { raw: canonical, canonical, machineId: 'aify:queue-proof' }, name: 'queue proof' });
  projectId = project.body?.project?.id ?? project.body?.id;
  if (typeof projectId !== 'string') throw new Error(`registering the project: ${project.status} ${JSON.stringify(project.body)}`);

  const providerEnv = { ...process.env, APG_DASHBOARD_URL: base, APG_DASHBOARD_PROJECT: projectId, APG_DASHBOARD_HOST: HOST_KEY, APG_DASHBOARD_KEY: key };
  const serve = () => {
    const r = run(process.execPath, [join(APG, 'scripts', 'serve-provider-requests.mjs')], { cwd: REPO, env: providerEnv });
    const out = `${r.stdout}${r.stderr}`;
    const stored = out.split(NL).filter((l) => l.trim().startsWith('STORED')).length;
    const claimedN = Number(out.match(/claimed\s+(\d+)/u)?.[1] ?? NaN);
    say(`  serve -> exit ${r.status}, claimed ${claimedN}, stored ${stored}`);
    for (const l of out.split(NL).filter((x) => /STORED|REFUSED|NOT OK/u.test(x))) say(`    ${l.trim().slice(0, 170)}`);
    return { exit: r.status, stored, claimedN };
  };
  const enqueue = async (label, call, args) => {
    const r = await api('POST', '/api/v1/provider/requests', { projectId, call, args });
    say(`  queue ${label.padEnd(18)} ${call.padEnd(9)} -> ${r.status} ${r.body?.requestId ?? r.body?.code ?? ''}`);
    if (r.status === 201) queued[label] = r.body.requestId;
    return r.status;
  };
  const A = (name, path = 'src/a.js', kind = 'symbol') => ({ path, name, kind });

  say(`${NL}== Q1. queue the calls ==`);
  const statuses = [
    await enqueue('stamp-clean', 'stamp', { anchors: [A('alpha'), A('run'), A('gone', 'src/missing.js')] }),
    await enqueue('resolve', 'resolve', { anchors: [A('alpha'), A('run'), A('x', 'src/missing.js'), A('x', 'src/a.js', 'paragraph')] }),
    await enqueue('subgraph', 'subgraph', { query: { around: A('alpha') } }),
    await enqueue('stamp-empty', 'stamp', { anchors: [] }),
  ];
  const signalsStatus = await enqueue('signals', 'signals', { items: [] });
  check('Q1 every supported call accepted (201)', statuses.every((s) => s === 201), statuses.join(','));
  check('Q1 a queued `signals` refused (400)', signalsStatus === 400, String(signalsStatus));

  say(`${NL}== Q2. one server run ==`);
  const first = serve();
  check('Q2 exit 0, every queued call claimed and stored', first.exit === 0 && first.claimedN === 4 && first.stored === 4, `claimed ${first.claimedN}, stored ${first.stored}`);

  say(`${NL}== Q5. a dirty tree changes nothing ==`);
  writeFileSync(join(REPO, 'src', 'a.js'), A_JS.replace('return gamma(v) + 1;', 'return gamma(v) + Math.abs(v);'));
  rmSync(join(REPO, 'src', 'b.js'));
  await enqueue('stamp-dirty', 'stamp', { anchors: [A('alpha')] });
  await enqueue('resolve-dirty', 'resolve', { anchors: [A('beta', 'src/b.js')] });
  const dirty = serve();
  check('Q5 the dirty run answered both (exit 0)', dirty.exit === 0 && dirty.stored === 2);

  say(`${NL}== Q6. CONTROL: commit the edit, stamp again ==`);
  git('checkout', '--', 'src/b.js');
  head = commit('alpha also references Math.abs');
  await enqueue('stamp-committed', 'stamp', { anchors: [A('alpha')] });
  const committed = serve();
  check('Q6 the committed run answered (exit 0)', committed.exit === 0 && committed.stored === 1);

  say(`${NL}== Q7. an empty queue ==`);
  const empty = serve();
  check('Q7 claims 0 and exits 0', empty.exit === 0 && empty.claimedN === 0);
} catch (error) {
  failure = error;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 800));
}

// Q3 and Q4, from the service's own database: what it STORED, not what the server script printed.
if (failure === null) {
  try {
    say(`${NL}== Q3/Q4. read back from the service's database ==`);
    const db = new Database(DB, { readonly: true });
    const row = (label) => db.prepare('select call, succeeded, result, problem, provenance, answered_at as answeredAt from provider_requests where id = ?').get(queued[label]);
    const value = (label) => JSON.parse(row(label).result);
    const prov = (label) => JSON.parse(row(label).provenance);
    for (const label of Object.keys(queued)) {
      const r = row(label);
      say(`  ${label.padEnd(16)} ${r.call.padEnd(9)} succeeded=${r.succeeded} answered=${r.answeredAt !== null} problem=${r.problem ?? '-'}`);
    }
    const firstHead = run('git', ['rev-parse', 'HEAD~1'], { cwd: REPO }).stdout.trim();
    check('Q3 ok answers carry provenance at the commit read, exhaustive false',
      ['stamp-clean', 'resolve', 'stamp-dirty', 'resolve-dirty'].every((l) => prov(l).providerCommit === firstHead && prov(l).exhaustive === false)
        && prov('stamp-committed').providerCommit === head && prov('stamp-committed').exhaustive === false);
    check('Q3 subgraph stored as a failure with its problem', row('subgraph').succeeded === 0 && row('subgraph').problem === 'subgraph is not supported by this provider yet');
    check('Q3 an empty anchors list stored as a failure', row('stamp-empty').succeeded === 0 && /empty/u.test(row('stamp-empty').problem ?? ''));
    const stamps = value('stamp-clean').stamps;
    check('Q4 alpha stamped at the commit', stamps[0].stamp?.commit === firstHead && /^[0-9a-f]{64}$/u.test(stamps[0].stamp?.hash ?? ''));
    check('Q4 stamp refuses the ambiguous `run` and the missing file', stamps[1].refused === 'ambiguous_anchor' && stamps[2].refused === 'gone');
    const results = value('resolve').results;
    check('Q4 resolve: found, ambiguous with BOTH candidates, gone, unwatched',
      results.map((r) => r.status).join(',') === 'found,ambiguous,gone,unwatched'
        && results[1].candidates?.length === 2 && results[3].reasonCode === 'unsupported_anchor_kind',
      results.map((r) => r.status).join(','));
    say(`  ambiguous candidates: ${JSON.stringify(results[1].candidates)}`);
    check('Q5 the dirty-tree stamp of alpha EQUALS the clean one', value('stamp-dirty').stamps[0].stamp?.hash === stamps[0].stamp.hash);
    check('Q5 b.js, deleted only in the tree, resolves found', value('resolve-dirty').results[0].status === 'found');
    check('Q6 CONTROL: the committed edit gives a DIFFERENT stamp', value('stamp-committed').stamps[0].stamp?.hash !== stamps[0].stamp.hash);
    db.close();
  } catch (error) {
    failure = error;
  }
}
say(`${NL}== cleanup ==`);
try { cleanUp(); say(`junction removed first, their node_modules still present: ${existsSync(join(THEIR_MODULES, '@hono'))}; scratch deleted: ${!existsSync(ROOT)}`); } catch (error) { failure = failure ?? error; say(error.message); }
if (failure) { console.error(`RUN FAILED: ${failure.message}`); process.exit(1); }
say(`${NL}${failures.length === 0 ? 'ALL PRE-REGISTERED CHECKS HELD' : `${failures.length} CHECK(S) FAILED: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
