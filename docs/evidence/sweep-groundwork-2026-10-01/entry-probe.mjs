// Run from this repo:  node docs/evidence/sweep-groundwork-2026-10-01/entry-probe.mjs
// Drive both entry points against a scratch repo and an address where nothing listens. The dirty refusal must
// come BEFORE any network call (exit 4). A clean tree, and a dirty one with --allow-dirty, must get as far as
// the network and fail there instead. That pair is what shows the guard sits in front of the read.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APG = process.cwd();
const repo = mkdtempSync(join(tmpdir(), 'apg-entry-probe-'));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', env: {
  ...process.env, APG_DASHBOARD_URL: 'http://127.0.0.1:9', APG_DASHBOARD_PROJECT: 'p', APG_DASHBOARD_KEY: 'k',
  APG_DASHBOARD_REPORTER: undefined,
} });
const git = (...a) => { const r = run('git', a); if (r.status !== 0) throw new Error(r.stderr); };
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src', 'a.js'), 'export function a() { return 1; }\n');
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=p', '-c', 'user.email=p@p', 'commit', '-q', '-m', 'c');

const cases = [];
const probe = (label, script, args) => {
  const r = run(process.execPath, [join(APG, 'scripts', script), ...args]);
  const out = `${r.stdout}${r.stderr}`;
  const reporter = out.match(/reporter\s+(\S+)/u)?.[1] ?? '(none)';
  const sentNothing = /NOTHING SENT: \d+ uncommitted/u.test(out);
  const network = /fetch failed|ECONNREFUSED|connect/iu.test(out);
  cases.push({ label, exit: r.status, sentNothing, network, reporter });
};
probe('sweep, clean', 'post-watch-signals.mjs', []);
probe('reconfirm, clean', 'reconfirm-anchor.mjs', ['--watch', 'w']);
writeFileSync(join(repo, 'src', 'a.js'), 'export function a() { return 2; }\n');
probe('sweep, DIRTY', 'post-watch-signals.mjs', []);
probe('reconfirm, DIRTY', 'reconfirm-anchor.mjs', ['--watch', 'w']);
probe('sweep, DIRTY --allow-dirty', 'post-watch-signals.mjs', ['--allow-dirty']);
probe('reconfirm, DIRTY --allow-dirty', 'reconfirm-anchor.mjs', ['--watch', 'w', '--allow-dirty']);
probe('sweep, unknown flag', 'post-watch-signals.mjs', ['--alow-dirty']);
for (const c of cases) console.log(`${c.label.padEnd(32)} exit ${String(c.exit).padEnd(4)} refusedDirty=${c.sentNothing} reachedNetwork=${c.network} reporter=${c.reporter}`);
rmSync(repo, { recursive: true, force: true });
