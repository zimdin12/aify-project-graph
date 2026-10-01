// The provider's sweeps against the dashboard's real sweep route, from this side of the seam. Run from this repo:
//   node docs/evidence/sweeps-live-2026-10-01/run.mjs
//
// aify-dashboard ec55995 (schema 43) added sweep identity: reserve before measuring, carry the id on the post, and
// the service orders one reporter's reports by a cursor. Their side: 28 of 28 mutations red, PASSES IN TESTS. No
// provider had posted a sweep for real. This is the first, on a scratch service.
//
// ⛔ PRE-REGISTERED, written before the first run. The run FAILS if any of these does not hold:
//   D   a --dry-run reserves nothing: the first real reservation afterwards is #1 with no predecessor
//   P1  a real CLI sweep is APPLIED (exit 0)
//   P2  the same payload posted twice under one sweep id: applied, then REPEAT (both exit 0)
//   P3  a sweep reserved BEFORE a later one was applied, posted after it: 409 stale_sweep, exit 3
//   P4  a sweep reserved, then a reconfirm that writes a DIFFERENT baseline, then its post: 409 stale_baseline,
//       exit 2, flagged re-read
//       ⚠ CHANGED AFTER RUN 1, which is kept as output-run1.txt. Run 1's P4 reconfirmed UNCHANGED code at the same
//       commit, so the baseline it wrote was identical, the reservation's baseline digest did not move, and the
//       post was applied: P4 FAILED. That was this scenario's error, not the service's: a reconfirm that changes
//       no baseline leaves the reservation's measurement valid. Recorded as observation O1. P4 now reconfirms a
//       real change, which is what the pre-registered claim was about.
//   P7  an unswept post from this reporter after adoption: 409 sweeps_adopted, exit 2, NOT flagged re-read
//   ABA three CLI sweeps at ONE head (clean, the anchored file deleted with --allow-dirty, restored): each exit 0
//       and APPLIED, alpha reads unchanged, gone, unchanged, and each names the previous applied sweep as its
//       predecessor
// Marks after each ABA step are RECORDED, not predicted: their semantics are the dashboard's to state.
//
// ⛔ THE SERVER IS ec55995 BY CONSTRUCTION. Their working tree has uncommitted edits in server/ (their next
// increment), so running it in place would test something else. `git archive ec55995` exports the committed tree,
// read-only, into a scratch directory. Their node_modules is reached through a directory junction. On cleanup the
// junction itself is removed first, and their node_modules is checked to still exist BEFORE the scratch directory
// is deleted, so a recursive delete can never follow it into their packages.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAnchor, splitBatch } from '../../../scripts/lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from '../../../scripts/lib/dashboard-signals-client.mjs';
import { makeInstruments } from '../../../scripts/lib/provider-runtime.mjs';
import { outcomeOfPost } from '../../../scripts/lib/sweep-outcome.mjs';

const DASHBOARD = process.env.DASHBOARD_CHECKOUT ?? 'C:/Docker/aify-dashboard';
const FIX = 'ec55995';
const APG = process.cwd();
const ROOT = join(tmpdir(), 'aify-sweeps-live-proof');
const SERVER = join(ROOT, 'dashboard');
const LINK = join(SERVER, 'node_modules');
const THEIR_MODULES = join(DASHBOARD, 'node_modules');
const REPO = join(ROOT, 'repo');
const PORT = 9792;
const LIVE_PORT = 9700;
const HOST_KEY = 'sweeps-proof-host';
const REPORTER = 'apg@sweeps-proof/win32/00000000';
const NL = String.fromCharCode(10);
const SOURCE = ['export function gamma(v) {', '  return v * 2;', '}', '', 'export function alpha(v) {', '  return gamma(v) + 1;', '}', ''].join(NL);

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

say('== guards ==');
const fixSha = run('git', ['-C', DASHBOARD, 'rev-parse', `${FIX}^{commit}`]).stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(fixSha)) throw new Error(`REFUSING — ${FIX} does not resolve in ${DASHBOARD}`);
say(`server code: git archive of ${fixSha} (their working tree is NOT used)`);
const liveAnswers = await answers(LIVE_PORT);
const scratchTaken = await answers(PORT);
say(`port probe: live ${LIVE_PORT} answers=${liveAnswers} (positive control), scratch ${PORT} answers=${scratchTaken}`);
if (!liveAnswers) throw new Error(`REFUSING — the port probe's positive control (${LIVE_PORT}) did not answer`);
if (scratchTaken) throw new Error(`REFUSING — something already listens on ${PORT}`);
if (!existsSync(join(THEIR_MODULES, '@hono'))) throw new Error('REFUSING — their node_modules is not where expected');

function removeJunctionSafely() {
  let isLink = false;
  try { isLink = lstatSync(LINK).isSymbolicLink(); } catch { return; }
  if (!isLink) throw new Error(`REFUSING to clean up: ${LINK} is not a link`);
  rmdirSync(LINK); // removes the junction itself, never its target
  if (!existsSync(join(THEIR_MODULES, '@hono'))) throw new Error('THEIR node_modules IS GONE AFTER UNLINKING — stop');
}
function cleanUp() {
  removeJunctionSafely();
  let stillLinked = true;
  try { lstatSync(LINK); } catch { stillLinked = false; }
  if (stillLinked) throw new Error('REFUSING to delete the scratch area: the junction is still there');
  rmSync(ROOT, { recursive: true, force: true });
}

if (existsSync(ROOT)) cleanUp();
mkdirSync(SERVER, { recursive: true });
const archive = run('git', ['-C', DASHBOARD, 'archive', '--format=tar', `-o${join(ROOT, 'dash.tar')}`, fixSha, 'server', 'package.json', 'VERSION', 'config']);
if (archive.status !== 0) throw new Error(`git archive: ${archive.stderr}`);
// Relative path, from inside the target: GNU tar reads `C:...` as a remote host.
const untar = run('tar', ['-xf', '../dash.tar'], { cwd: SERVER });
if (untar.status !== 0) throw new Error(`tar: ${untar.stderr}`);
symlinkSync(THEIR_MODULES, LINK, 'junction');

mkdirSync(join(REPO, 'src'), { recursive: true });
const git = (...args) => { const r = run('git', args, { cwd: REPO }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
writeFileSync(join(REPO, 'src', 'proof.js'), SOURCE);
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=p', '-c', 'user.email=p@localhost', 'commit', '-q', '-m', 'alpha calls gamma');
let head = git('rev-parse', 'HEAD');

const key = randomBytes(24).toString('hex');
const env = {
  ...process.env, PORT: String(PORT), BIND_HOST: '127.0.0.1', API_KEY: key, PUBLIC_ORIGINS: `http://127.0.0.1:${PORT}`,
  DATABASE_PATH: join(ROOT, 'dashboard.db'), UI_ROOT: join(DASHBOARD, 'ui', 'dist'),
};
delete env.COMMS_BASE_URL;
delete env.BACKUP_DIR;
const log = [];
const child = spawn(process.execPath, ['--experimental-strip-types', join(SERVER, 'server', 'src', 'main.ts')], { cwd: SERVER, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (c) => log.push(String(c)));
child.stderr.on('data', (c) => log.push(String(c)));

let failure = null;
try {
  for (let i = 0; i < 300 && !/listening on http/u.test(log.join('')); i += 1) {
    if (child.exitCode !== null) throw new Error(`the scratch service exited: ${log.join('').slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!/listening on http/u.test(log.join(''))) throw new Error('the scratch service never announced it was listening');
  const base = `http://127.0.0.1:${PORT}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-aify-agent': 'sweeps-proof-setup' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  say(`service: schema ${(await api('GET', '/health')).body?.db?.schema?.at}`);

  const canonical = REPO.replace(/\\/gu, '/');
  const project = await api('POST', '/api/v1/projects', { root: { raw: canonical, canonical, machineId: 'aify:sweeps-proof' }, name: 'sweeps proof' });
  const projectId = project.body?.project?.id ?? project.body?.id;
  if (typeof projectId !== 'string') throw new Error(`registering the project: ${project.status} ${JSON.stringify(project.body)}`);
  const graph = await api('POST', `/api/v1/projects/${projectId}/graphs`, {
    slug: 'sweeps', template: 'blank',
    document: { title: 'sweeps proof', purpose: 'one anchored function', nodes: [{ id: 'alpha', layer: 'things', kind: 'thing', label: 'alpha', anchor: { project: 'aify-sweeps-proof', path: 'src/proof.js', name: 'alpha', kind: 'symbol' } }], edges: [] },
  });
  if (graph.status !== 201) throw new Error(`creating the graph: ${graph.status} ${JSON.stringify(graph.body)}`);
  const graphId = graph.body.graph.id;

  const providerEnv = { ...process.env, APG_DASHBOARD_URL: base, APG_DASHBOARD_PROJECT: projectId, APG_DASHBOARD_HOST: HOST_KEY, APG_DASHBOARD_KEY: key, APG_DASHBOARD_REPORTER: REPORTER };
  const cli = (script, args = []) => {
    const r = run(process.execPath, [join(APG, 'scripts', script), ...args], { cwd: REPO, env: providerEnv });
    const out = `${r.stdout}${r.stderr}`;
    const lines = out.split(NL);
    const sweepLine = lines.find((l) => l.startsWith('sweep '))?.trim() ?? '(no sweep line)';
    const m = sweepLine.match(/#(\d+), after (?:#(\d+)|none applied yet)/u);
    const alphaAt = lines.findIndex((l) => /symbol:alpha/u.test(l));
    const status = alphaAt >= 0 ? lines[alphaAt].trim().split(/\s+/u)[0] : '(no row)';
    const verdict = lines.find((l) => /^(APPLIED|REPEAT|STALE|REFUSED|UNRECOGNISED|CONFIRMED|NOTHING SENT|--dry-run)/u.test(l)) ?? out.slice(-300);
    say(`  ${script} ${args.join(' ')} -> exit ${r.status}; ${sweepLine}; alpha ${status}`);
    say(`  ${verdict.slice(0, 200)}`);
    return { exit: r.status, sweepId: m ? Number(m[1]) : null, predecessor: m ? (m[2] === undefined ? null : Number(m[2])) : undefined, status, verdict, out };
  };
  // Client-level steps use the same modules the CLI uses, against the same service.
  const client = new DashboardSignalsClient({ baseUrl: base, apiKey: key, hostKey: HOST_KEY, projectId, reporterId: REPORTER });
  const measure = (items) => {
    const resolved = items.map((item) => resolveAnchor({ repoRoot: REPO, item, deps: makeInstruments(REPO) }));
    const b = splitBatch(resolved, items.map((i) => i.watchId));
    if (!b.complete) throw new Error('incomplete batch in the harness');
    return b;
  };
  const postOutcome = async (payload) => {
    try { return { ...outcomeOfPost({ reply: await client.postSignals(payload) }) }; } catch (error) {
      if (!(error instanceof SignalsRefused)) throw error;
      return { ...outcomeOfPost({ refusal: error }), code: error.code, reread: error.shouldReread };
    }
  };
  const marks = async () => (await api('GET', `/api/v1/graphs/${graphId}/marks`)).body?.all?.map((m) => `${m.reason}${m.acknowledgedAt === null ? '' : '(ack)'}`).join(', ') || 'none';

  say(`${NL}== D. a dry run reserves nothing ==`);
  const dry = cli('post-watch-signals.mjs', ['--dry-run']);
  check('D dry run exits 0', dry.exit === 0);

  say(`${NL}== baseline: reconfirm alpha ==`);
  const watchId = (await client.readWatchSet()).items[0].watchId;
  check('reconfirm exits 0', cli('reconfirm-anchor.mjs', ['--watch', watchId]).exit === 0);

  say(`${NL}== P1. a real CLI sweep ==`);
  const p1 = cli('post-watch-signals.mjs');
  check('D the first real reservation is #1 with no predecessor (the dry run reserved nothing)', p1.sweepId === 1 && p1.predecessor === null, `#${p1.sweepId} after ${p1.predecessor}`);
  check('P1 applied, exit 0', p1.exit === 0 && p1.verdict.startsWith('APPLIED'));

  say(`${NL}== P2. the same payload twice under one sweep id ==`);
  const r2 = await client.reserveSweep({ head });
  const b2 = measure(r2.items);
  const payload2 = { head, watchRevision: r2.watchRevision, results: b2.results, unwatched: b2.unwatched, sweep: { id: r2.sweepId, predecessor: r2.predecessor } };
  const first = await postOutcome(payload2);
  const again = await postOutcome(payload2);
  say(`  #${r2.sweepId}: ${first.line.slice(0, 80)} | again: ${again.line.slice(0, 80)}`);
  check('P2 first post applied', first.exit === 0 && first.line.startsWith('APPLIED'));
  check('P2 the identical post is a REPEAT, exit 0', again.exit === 0 && again.line.startsWith('REPEAT'));

  say(`${NL}== P3. reserved before a later sweep was applied, posted after it ==`);
  const r3 = await client.reserveSweep({ head });
  const b3 = measure(r3.items);
  const later = cli('post-watch-signals.mjs');
  check('P3 the later CLI sweep applied', later.exit === 0 && later.sweepId > r3.sweepId);
  const stale = await postOutcome({ head, watchRevision: r3.watchRevision, results: b3.results, unwatched: b3.unwatched, sweep: { id: r3.sweepId, predecessor: r3.predecessor } });
  say(`  #${r3.sweepId}: ${stale.line.slice(0, 160)}`);
  check('P3 409 stale_sweep maps to exit 3', stale.code === 'stale_sweep' && stale.exit === 3);

  say(`${NL}== P4. reserved, then a reconfirm of a REAL change, then posted ==`);
  const r4 = await client.reserveSweep({ head });
  const b4 = measure(r4.items);
  const h4 = head;
  writeFileSync(join(REPO, 'src', 'proof.js'), SOURCE.replace('return gamma(v) + 1;', 'return gamma(v) + Math.abs(v);'));
  git('add', '-A'); git('-c', 'user.name=p', '-c', 'user.email=p@localhost', 'commit', '-q', '-m', 'alpha also references Math.abs');
  head = git('rev-parse', 'HEAD');
  check('P4 the reconfirm in between exits 0', cli('reconfirm-anchor.mjs', ['--watch', watchId]).exit === 0);
  const sb = await postOutcome({ head: h4, watchRevision: r4.watchRevision, results: b4.results, unwatched: b4.unwatched, sweep: { id: r4.sweepId, predecessor: r4.predecessor } });
  say(`  #${r4.sweepId}: ${sb.line.slice(0, 160)}`);
  check('P4 409 stale_baseline maps to exit 2, flagged re-read', sb.code === 'stale_baseline' && sb.exit === 2 && sb.reread === true);

  say(`${NL}== P7. an unswept post after adoption ==`);
  const r7set = await client.readWatchSet();
  const b7 = measure(r7set.items);
  const unswept = await postOutcome({ head, watchRevision: r7set.watchRevision, results: b7.results, unwatched: b7.unwatched });
  say(`  ${unswept.line.slice(0, 160)}`);
  check('P7 409 sweeps_adopted maps to exit 2, NOT flagged re-read', unswept.code === 'sweeps_adopted' && unswept.exit === 2 && unswept.reread === false);

  say(`${NL}== ABA. three CLI sweeps at ONE head ==`);
  const a1 = cli('post-watch-signals.mjs');
  say(`  marks: ${await marks()}`);
  rmSync(join(REPO, 'src', 'proof.js'));
  const b1 = cli('post-watch-signals.mjs', ['--allow-dirty']);
  say(`  marks: ${await marks()}`);
  git('checkout', '--', 'src/proof.js');
  const a2 = cli('post-watch-signals.mjs');
  say(`  marks: ${await marks()}`);
  check('ABA all three exit 0 and APPLIED', [a1, b1, a2].every((s) => s.exit === 0 && s.verdict.startsWith('APPLIED')));
  check('ABA alpha reads unchanged, gone, unchanged', [a1, b1, a2].map((s) => s.status).join(',') === 'unchanged,gone,unchanged', [a1, b1, a2].map((s) => s.status).join(','));
  check('ABA each names the previous applied sweep as its predecessor', b1.predecessor === a1.sweepId && a2.predecessor === b1.sweepId, `${a1.sweepId}<-${b1.predecessor}, ${b1.sweepId}<-${a2.predecessor}`);
  check('ABA one head throughout', git('rev-parse', 'HEAD') === head);
} catch (error) {
  failure = error;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 800));
  say(`${NL}== cleanup ==`);
  try { cleanUp(); say(`junction removed first, their node_modules still present: ${existsSync(join(THEIR_MODULES, '@hono'))}; scratch deleted: ${!existsSync(ROOT)}`); } catch (error) { failure = failure ?? error; say(error.message); }
}
if (failure) { console.error(`RUN FAILED: ${failure.message}`); process.exit(1); }
say(`${NL}${failures.length === 0 ? 'ALL PRE-REGISTERED CHECKS HELD' : `${failures.length} CHECK(S) FAILED: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
