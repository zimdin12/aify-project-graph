#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'package.json',
  'AGENTS.md',
  'README.md',
  'install.claude.md',
  'install.codex.md',
  'install.opencode.md',
  'install.pi.md',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  'integrations/claude-code/skill/SKILL.md',
  'integrations/codex/skill/SKILL.md',
  'mcp/stdio/server.js'
];

async function exists(rel) {
  try { await access(join(root, rel)); return true; } catch { return false; }
}

async function readJson(rel) {
  return JSON.parse(await readFile(join(root, rel), 'utf8'));
}

const errors = [];
for (const rel of requiredFiles) {
  if (!(await exists(rel))) errors.push(`missing required file: ${rel}`);
}

let pkg = null;
try {
  pkg = await readJson('package.json');
  if (!pkg.engines?.node?.includes('20')) errors.push('package.json must declare Node >=20');
  if (!pkg.scripts?.test) errors.push('package.json must expose npm test');
} catch (err) {
  errors.push(`package.json is not valid JSON: ${err.message}`);
}

for (const rel of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json']) {
  try {
    const manifest = await readJson(rel);
    if (!manifest.name && !manifest.plugins) errors.push(`${rel} must declare name or plugins`);
  } catch (err) {
    errors.push(`${rel} is not valid JSON: ${err.message}`);
  }
}

for (const rel of ['install.claude.md', 'install.codex.md', 'install.opencode.md', 'install.pi.md']) {
  const text = await readFile(join(root, rel), 'utf8').catch(() => '');
  if (!text.includes('npm install')) errors.push(`${rel} must include npm install`);
  if (!text.includes('aify-project-graph')) errors.push(`${rel} must mention aify-project-graph`);
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  package: pkg?.name ?? 'aify-project-graph',
  runtimes: ['claude-code', 'codex', 'opencode', 'pi-linux'],
  manifests: ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.agents/plugins/marketplace.json']
}, null, 2));
