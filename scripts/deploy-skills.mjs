#!/usr/bin/env node
// Deploy the shipped skills to EVERY runtime install root on this host, then READ BACK what landed.
//
// ⛔ THIS IS NOT `sync-skills.mjs`. That one mirrors bodies WITHIN the repo across the four runtime
// trees, and its "deployment: all N shipped skills present" line asks only whether a file EXISTS.
// The installed skill an agent actually reads was ~7KB behind the repo while that check was green.
//
//   node scripts/deploy-skills.mjs --check   # report drift, exit 1 if anything is out of sync
//   node scripts/deploy-skills.mjs           # deploy, then read back and verify
//   node scripts/deploy-skills.mjs --force   # also overwrite DIVERGED installations
//
// ⛔⛔ THE FIRST VERSION COVERED CLAUDE CODE ONLY, AND I REPORTED THE OTHER RUNTIMES AS AN "EMPTY
// POPULATION". MEASURED, THAT WAS FALSE:
//
//     ~/.codex/skills                    14 of our skills installed, ~8KB behind
//     ~/.hermes/skills                   14 installed, 26,012 bytes
//     $HERMES_HOME/skills                14 installed, 26,963 bytes   <- DIFFERENT VINTAGE
//
// Two Hermes roots at different vintages, and which one the runtime reads depends on an environment
// variable. "Empty population" was not a measurement; it was an assumption I had not checked, made
// in the same breath as a rule saying an empty population is a finding rather than a pass.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { classifyInstallation, summariseDeployment, detectShadowRoots } from './lib/skill-deployment.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');
const HOME = homedir();

/**
 * The declared installation population, per the install docs.
 *
 * `candidates` exists because a runtime can have MORE THAN ONE plausible root; the selected one is
 * what the docs and environment name, and any other that EXISTS is reported as a possible shadow
 * rather than ignored.
 */
// ⭐ EVERY CANDIDATE ROOT THAT EXISTS IS A TARGET — not one "selected" root with the others flagged
// as shadows. Operator ruling, and it is the better design: if all live roots carry current content
// then it stops mattering which one the runtime reads, and they cannot silently drift apart. The
// earlier version deployed to one root and WARNED about the other, which left a real stale copy on
// disk and made every run carry a caveat nobody could act on.
//
// ⚠ It also means NOTHING IS DELETED. Replacing the skill directories we own leaves anything else
// in that root untouched, which the shadow-and-delete approach could not promise.
//
// install.hermes.md already records why this matters, measured 2026-08-07: HERMES_HOME was
// %LOCALAPPDATA%\hermes while BOTH documented defaults were wrong, so an install "reported success"
// into a directory Hermes never reads. Its own note — "agreeing with yourself is not the same as
// being right" — is exactly the failure a single-root deploy reproduces.
const RUNTIMES = [
  {
    runtime: 'claude-code',
    sourceRoot: join(REPO, 'integrations', 'claude-code'),
    candidates: [join(HOME, '.claude', 'skills')],
  },
  {
    runtime: 'codex',
    sourceRoot: join(REPO, 'integrations', 'codex'),
    candidates: [join(HOME, '.codex', 'skills'), join(process.env.CODEX_HOME || join(HOME, '.codex'), 'skills')],
  },
  {
    runtime: 'hermes',
    sourceRoot: join(REPO, 'integrations', 'hermes'),
    candidates: [join(HOME, '.hermes', 'skills'), join(process.env.HERMES_HOME || join(HOME, '.hermes'), 'skills')],
  },
  {
    runtime: 'cursor',
    sourceRoot: join(REPO, 'integrations', 'cursor'),
    candidates: [join(HOME, '.cursor', 'skills')],
  },
];

/** The invocation key is the frontmatter `name:`, which is not always the directory name. */
function nameOf(file) {
  const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(readFileSync(file, 'utf8').slice(0, 2000));
  return m ? m[1] : null;
}

/** Source skills for one runtime tree, DISCOVERED from disk — never a hardcoded roster. */
function discoverSources(sourceRoot) {
  const out = [];
  const parent = join(sourceRoot, 'skill', 'SKILL.md');
  if (existsSync(parent)) out.push({ name: nameOf(parent), path: parent });
  const dir = join(sourceRoot, 'skills');
  if (existsSync(dir)) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name, 'SKILL.md');
      if (existsSync(p)) out.push({ name: nameOf(p) ?? e.name, path: p });
    }
  }
  return out;
}

function readInstalled(root, name) {
  const path = join(root, name, 'SKILL.md');
  if (!existsSync(path)) return null;
  try { return { path, bytes: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs }; }
  catch (err) { return { path, error: err.code || String(err) }; }
}

const classifyAll = (sources, root) => sources.map((s) => classifyInstallation({
  name: s.name,
  source: { path: s.path, bytes: readFileSync(s.path, 'utf8'), mtimeMs: statSync(s.path).mtimeMs },
  installed: readInstalled(root, s.name),
}));

const report = [];
let anyRootPresent = false;
let overallOk = true;

for (const rt of RUNTIMES) {
  const sources = discoverSources(rt.sourceRoot);
  if (sources.length === 0) {
    // Fails closed: an empty source set would make every installation trivially "in sync".
    report.push({ runtime: rt.runtime, state: 'no_source_tree', ok: false, selected: rt.selected });
    overallOk = false;
    continue;
  }

  // Deduplicated, because two candidates can resolve to the same directory when the env var simply
  // repeats the default — deploying twice would be harmless but double-counts the population.
  const liveRoots = [...new Set(rt.candidates)].filter((p) => existsSync(p));

  if (liveRoots.length === 0) {
    // ⚠ ITS OWN STATE. A runtime that is not installed here has nothing to deploy, which is NOT the
    // same as being in sync — and must never be counted toward success. It is reported so the
    // reader can see exactly what the "everything is deployed" claim does and does not cover.
    report.push({
      runtime: rt.runtime, state: 'runtime_not_installed', ok: null,
      candidates: rt.candidates, sources: sources.length,
      note: 'no install root on this host — nothing deployed, and this is NOT counted as in-sync',
    });
    continue;
  }

  anyRootPresent = true;
  const rootReports = [];

  for (const root of liveRoots) {
    let rows = classifyAll(sources, root);
    let deployed = 0;
    let refused = 0;

    if (!CHECK_ONLY) {
      for (const r of rows) {
        if (r.ok) continue;
        if ((r.state === 'diverged' || r.state === 'unreadable') && !FORCE) { refused += 1; continue; }
        const src = sources.find((s) => s.name === r.name);
        const dest = join(root, r.name, 'SKILL.md');
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src.path, 'utf8'));
        deployed += 1;
      }
      // ⭐ RE-CLASSIFY FROM DISK. The verdict must come from reading the artifact back, never from
      // the fact that a write call returned without throwing.
      rows = classifyAll(sources, root);
    }

    const summary = summariseDeployment(rows);
    if (!summary.ok) overallOk = false;
    rootReports.push({
      root, ok: summary.ok, deployed, refused, total: summary.total, byState: summary.byState,
      failures: summary.failures.map((f) => ({ name: f.name, state: f.state, sourceBytes: f.sourceBytes, installedBytes: f.installedBytes })),
    });
  }

  // ⭐ COVERAGE CONTROL, not a warning. Now that every live root is a target, an uncovered candidate
  // should be IMPOSSIBLE — so this asserts it rather than assuming it. If a root ever exists and is
  // not deployed to, that is a defect in this list, and it fails the run instead of printing a
  // caveat nobody can act on.
  const uncovered = detectShadowRoots({ selected: null, candidates: rt.candidates, existsFn: (p) => existsSync(p) && !liveRoots.includes(p) });
  if (uncovered.shadows.length > 0) overallOk = false;

  report.push({
    runtime: rt.runtime,
    state: 'checked',
    ok: rootReports.every((r) => r.ok) && uncovered.shadows.length === 0,
    rootsCovered: liveRoots,
    uncoveredRoots: uncovered.shadows,
    roots: rootReports,
  });
}

// ⛔ NO ROOT PRESENT AT ALL IS A FINDING, NOT A PASS — the vacuous-truth trap at the runtime level.
if (!anyRootPresent) overallOk = false;

console.log(JSON.stringify({
  mode: CHECK_ONLY ? 'CHECK' : 'DEPLOY + READBACK',
  ok: overallOk,
  anyRootPresent,
  runtimes: report,
  note: 'runtime_not_installed rows are reported and NOT counted toward success; shadowedBy names alternate roots that exist and may be what the runtime actually reads.',
}, null, 2));

process.exit(overallOk ? 0 : 1);
