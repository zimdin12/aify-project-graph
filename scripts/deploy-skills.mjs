#!/usr/bin/env node
// Deploy the shipped skills to the host, then READ BACK what landed.
//
// ⛔ THIS IS NOT `sync-skills.mjs`. That one mirrors bodies WITHIN the repo across the four runtime
// trees, and its "deployment: all N shipped skills present" line asks only whether a file EXISTS.
// The installed skill an agent actually reads was ~7KB behind the repo while that check was green.
//
//   node scripts/deploy-skills.mjs --check   # report drift, exit 1 if anything is out of sync
//   node scripts/deploy-skills.mjs           # deploy, then read back and verify
//   node scripts/deploy-skills.mjs --force   # also overwrite DIVERGED installations
//
// ⚠ `diverged` (installed differs and is NOT simply behind) is refused by default. It means somebody
// edited the installed copy by hand, or a newer tree deployed here — overwriting destroys that.
// Different cause, different remedy, so it is never folded into `stale`.
//
// ⭐ THE READBACK IS THE POINT. Writing a file and reporting success is a claim about an operation;
// reading the bytes back is evidence about the artifact. This repo has paid for that distinction
// more than once — a green badge is not a job that ran, a commit is not a push.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifyInstallation, summariseDeployment } from './lib/skill-deployment.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');

// The declared installation population for this host: Claude Code reads ~/.claude/skills/<name>/.
// Named explicitly rather than discovered, so a target that DISAPPEARS is reported as missing
// instead of silently dropping out of the denominator.
const INSTALL_ROOT = join(homedir(), '.claude', 'skills');

/** Source skills, derived from disk — never a hardcoded roster. */
function discoverSources() {
  const out = [];
  const parent = join(REPO, 'integrations', 'claude-code', 'skill', 'SKILL.md');
  if (existsSync(parent)) out.push({ name: nameOf(parent), path: parent });
  const dir = join(REPO, 'integrations', 'claude-code', 'skills');
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name, 'SKILL.md');
    if (existsSync(p)) out.push({ name: nameOf(p) ?? e.name, path: p });
  }
  return out;
}

/** The invocation key is the frontmatter `name:`, which is not always the directory name. */
function nameOf(file) {
  const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(readFileSync(file, 'utf8').slice(0, 2000));
  return m ? m[1] : null;
}

function readInstalled(name) {
  const path = join(INSTALL_ROOT, name, 'SKILL.md');
  if (!existsSync(path)) return null;
  try { return { path, bytes: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }; }
  catch (err) { return { path, error: err.code || String(err) }; }
}

const sources = discoverSources();
if (sources.length === 0) {
  // Fails closed: an empty source set would make every installation trivially "in sync".
  console.error('FATAL: discovered 0 source skills under integrations/claude-code — refusing to report.');
  process.exit(3);
}

let rows = sources.map((s) => classifyInstallation({
  name: s.name,
  source: { path: s.path, bytes: readFileSync(s.path, 'utf8'), mtimeMs: statSync(s.path).mtimeMs },
  installed: readInstalled(s.name),
}));

let deployed = 0;
let refused = 0;
if (!CHECK_ONLY) {
  for (const r of rows) {
    if (r.ok) continue;
    if (r.state === 'diverged' && !FORCE) { refused += 1; continue; }
    if (r.state === 'unreadable' && !FORCE) { refused += 1; continue; }
    const src = sources.find((s) => s.name === r.name);
    const dest = join(INSTALL_ROOT, r.name, 'SKILL.md');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src.path, 'utf8'));
    deployed += 1;
  }
  // ⭐ RE-CLASSIFY FROM DISK. The verdict must come from reading the artifact back, never from the
  // fact that a write call returned without throwing.
  rows = sources.map((s) => classifyInstallation({
    name: s.name,
    source: { path: s.path, bytes: readFileSync(s.path, 'utf8'), mtimeMs: statSync(s.path).mtimeMs },
    installed: readInstalled(s.name),
  }));
}

const summary = summariseDeployment(rows);

console.log(JSON.stringify({
  mode: CHECK_ONLY ? 'CHECK' : 'DEPLOY + READBACK',
  installRoot: INSTALL_ROOT,
  deployed,
  refused,
  refusedNote: refused ? 'diverged/unreadable installations are NOT overwritten without --force; inspect them first' : null,
  summary: { ok: summary.ok, total: summary.total, byState: summary.byState, reason: summary.reason },
  failures: summary.failures.map((f) => ({
    name: f.name, state: f.state, sourceBytes: f.sourceBytes, installedBytes: f.installedBytes, detail: f.detail,
  })),
}, null, 2));

process.exit(summary.ok ? 0 : 1);
