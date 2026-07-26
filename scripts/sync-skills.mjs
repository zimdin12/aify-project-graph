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
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
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
      drifted.push(`${runtime}/${rel} (MISSING)`);
      continue;
    }
    const current = readFileSync(path, 'utf8');
    const { frontmatter, body } = splitDoc(current);
    if (body === canonicalBody && current === frontmatter + body) continue;

    drifted.push(`${runtime}/${rel}`);
    if (!check) writeFileSync(path, frontmatter + canonicalBody, 'utf8');
  }
}

if (!drifted.length) {
  console.log(`skills in sync — ${docs.length} docs × ${TARGETS.length} runtimes`);
  process.exit(0);
}

console.log(`${check ? 'DRIFT' : 'synced'} (${drifted.length}):`);
for (const d of drifted) console.log(`  ${d}`);
if (check) {
  console.log('\nRun: node scripts/sync-skills.mjs');
  process.exit(1);
}
