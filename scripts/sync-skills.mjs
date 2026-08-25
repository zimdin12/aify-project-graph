// scripts/sync-skills.mjs
//
// We ship the same skills to four runtimes as four physical copies. Authoring
// happens in the claude-code tree; this propagates those bodies to the others,
// preserving each runtime's own YAML frontmatter (which may legitimately differ
// in quoting or runtime-specific fields).
//
// Pairs with tests/unit/integrations/skill-parity.test.js — when that test
// fails on body drift, run this. Idempotent.
//
//   node scripts/sync-skills.mjs           # write
//   node scripts/sync-skills.mjs --check   # report drift, exit 1 (CI-friendly)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INTEGRATIONS = join(REPO_ROOT, 'integrations');
const CANONICAL = 'claude-code';
const TARGETS = ['codex', 'cursor', 'hermes'];

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;

const splitDoc = (text) => {
  const normalized = text.replace(/\r\n/g, '\n');
  const m = FRONTMATTER.exec(normalized);
  return m
    ? { frontmatter: m[0], body: normalized.slice(m[0].length) }
    : { frontmatter: '', body: normalized };
};

// Every shipped skill doc: the main skill plus one per skills/<name>/.
const docs = ['skill/SKILL.md'];
for (const entry of readdirSync(join(INTEGRATIONS, CANONICAL, 'skills'), { withFileTypes: true })) {
  if (entry.isDirectory()) docs.push(`skills/${entry.name}/SKILL.md`);
}

const check = process.argv.includes('--check');
const drifted = [];

for (const rel of docs) {
  const canonicalBody = splitDoc(readFileSync(join(INTEGRATIONS, CANONICAL, rel), 'utf8')).body;
  for (const runtime of TARGETS) {
    const path = join(INTEGRATIONS, runtime, rel);
    if (!existsSync(path)) {
      // A NEW skill used to be reported and then skipped, so authoring one in the canonical
      // tree shipped it to exactly one runtime until the parity test failed and someone did the
      // mkdir by hand. Reporting a gap you are able to close is a checker doing half its job.
      // In write mode, create it with the canonical frontmatter; --check still just reports.
      drifted.push(`${runtime}/${rel} (CREATED)`);
      if (!check) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, readFileSync(join(INTEGRATIONS, CANONICAL, rel), 'utf8'), 'utf8');
      }
      continue;
    }
    const current = readFileSync(path, 'utf8');
    const { frontmatter, body } = splitDoc(current);
    if (body === canonicalBody && current === frontmatter + body) continue;

    drifted.push(`${runtime}/${rel}`);
    if (!check) writeFileSync(path, frontmatter + canonicalBody, 'utf8');
  }
}


// ⛔ SYNCING IS NOT DEPLOYING, AND THAT DISTINCTION SHIPPED TWO INERT SKILLS.
//
// This script mirrors skill bodies claude-code -> codex/cursor/hermes INSIDE THE REPO. It has
// never written to the host's skills directory; that is a manual install step. So a skill added
// after the last install is INERT — present in the repo, invisible to every agent.
//
// Measured 2026-08-25: `find-the-doc` (shipped 3 days earlier AS the adoption lever) and
// `safe-to-delete` were in the repo and NOT in ~/.claude/skills. Zero invocations each — a
// REACHABILITY fact, not a preference one. Ten other skills were installed and still never
// invoked, which is the genuine non-use; conflating the two would have sent the next round of
// work at the wrong problem.
//
// This reports the drift rather than writing to a user's home directory unasked. `--deployed`
// names what is shipped but not installed, so "inert since the day it shipped" is visible
// instead of inferred a week later.
function reportDeploymentDrift() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) { console.log('deployment check skipped: no HOME/USERPROFILE'); return 0; }
  const hostSkills = join(home, '.claude', 'skills');
  const srcSkills = join(INTEGRATIONS, CANONICAL, 'skills');
  let shipped = [];
  try { shipped = readdirSync(srcSkills, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { console.log('deployment check skipped: no canonical skills dir'); return 0; }
  const missing = shipped.filter((name) => !existsSync(join(hostSkills, name, 'SKILL.md')));
  // POSITIVE CONTROL: if NOTHING is deployed the host simply has no install, which is a different
  // fact from "these specific skills are missing" and must not be reported as drift.
  const anyDeployed = shipped.some((name) => existsSync(join(hostSkills, name, 'SKILL.md')));
  if (!anyDeployed) { console.log(`deployment: no skills installed at ${hostSkills} — this host has no install, not drift`); return 0; }
  if (!missing.length) { console.log(`deployment: all ${shipped.length} shipped skills present in ${hostSkills}`); return 0; }
  console.log(`
⛔ SHIPPED BUT NOT DEPLOYED (${missing.length}) — inert for every agent on this host:`);
  for (const m of missing) console.log(`  ${m}`);
  console.log(`
Fix: copy integrations/${CANONICAL}/skills/* to ${hostSkills} (install.claude.md Step 3).`);
  return missing.length;
}

const notDeployed = reportDeploymentDrift();

if (!drifted.length) {
  console.log(`skills in sync — ${docs.length} docs × ${TARGETS.length} runtimes`);
  process.exit(check && notDeployed ? 1 : 0);
}

console.log(`${check ? 'DRIFT' : 'synced'} (${drifted.length}):`);
for (const d of drifted) console.log(`  ${d}`);
if (check) {
  console.log('\nRun: node scripts/sync-skills.mjs');
  process.exit(1);
}
