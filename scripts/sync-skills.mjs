// scripts/sync-skills.mjs
//
// We ship the same skills to four runtimes as four physical copies. Authoring
// happens in the claude-code tree; this propagates those bodies to the others,
// preserving each runtime's own YAML frontmatter (which may legitimately differ
// in quoting or runtime-specific fields).
//
// ⛔ THE DESCRIPTION IS SYNCED TOO, BECAUSE IT IS NOT DECORATION — IT IS THE REACH SURFACE.
//
// An agent reads the description to decide whether to invoke the skill at all, so a better
// description IS the feature. Preserving it per runtime meant every improvement stranded in the
// canonical tree, and `--check` reported "skills in sync" while it had:
//
//     graph-anchor-drift   claude-code names the failure mode ("reports NOTHING GOVERNS THIS —
//                          the answer looks the same as a genuinely unowned file"); the other
//                          three carried the older generic text
//     graph-pull-context   same shape
//
// So codex, cursor and hermes agents were deciding whether to invoke these skills from the WEAKER
// text, and the checker was structurally unable to say so.
//
// ⚠ MEASURED BEFORE CHANGING IT: across all four trees the ONLY frontmatter keys are `name` and
// `description` — the "runtime-specific fields" the rationale above protects do not exist today.
// Quoting differences are real, so the canonical description LINE is written verbatim, which makes
// quoting canonical too and removes one more axis of drift.
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

// ⚠ EVERY shipped description is a single line — verified across all 68 (4 runtimes x 17 docs)
// before this was written. A YAML block scalar or a wrapped value would silently defeat a
// line-based swap, so this returns null for anything that is not one line and the caller reports
// it rather than mangling the file.
function descriptionLine(frontmatter) {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((l) => /^description:/.test(l));
  if (index < 0) return null;
  if (/^description:\s*[|>]/.test(lines[index])) return null;  // block scalar
  if (/^\s+\S/.test(lines[index + 1] ?? '')) return null;      // wrapped continuation line
  return { index, text: lines[index], lines };
}

// Replace the target's description line with the canonical one. Returns the frontmatter unchanged
// when they already agree, and null when either side is not a simple single-line description —
// never a partial edit.
function withCanonicalDescription(targetFm, canonicalFm) {
  const canon = descriptionLine(canonicalFm);
  const mine = descriptionLine(targetFm);
  if (!canon || !mine) return null;
  if (mine.text === canon.text) return targetFm;
  const lines = [...mine.lines];
  lines[mine.index] = canon.text;
  return lines.join('\n');
}

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
  const canonicalDoc = splitDoc(readFileSync(join(INTEGRATIONS, CANONICAL, rel), 'utf8'));
  const canonicalBody = canonicalDoc.body;
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
    const synced = withCanonicalDescription(frontmatter, canonicalDoc.frontmatter);
    if (synced === null) {
      // Not a simple single-line description on one side or the other. Report rather than edit —
      // a partial frontmatter rewrite is worse than a named refusal.
      drifted.push(`${runtime}/${rel} (DESCRIPTION NOT SINGLE-LINE — fix by hand)`);
      continue;
    }
    if (body === canonicalBody && current === synced + body) continue;

    drifted.push(`${runtime}/${rel}${synced !== frontmatter ? ' (description)' : ''}`);
    if (!check) writeFileSync(path, synced + canonicalBody, 'utf8');
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
