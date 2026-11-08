// Every text an agent reads as instructions from this repo: README, AGENTS, the install guides, every shipped
// integration document, and the always-loaded MCP server instructions. DERIVED from the tree, so a new guide or skill
// is covered by every guard that uses this without editing the guard (#16).
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

export const SURFACES = [
  ...readdirSync(ROOT).filter((f) => /^(README|AGENTS)\.md$|^install.*\.md$/u.test(f)).map((f) => join(ROOT, f)),
  ...walk(join(ROOT, 'integrations')).filter((f) => f.endsWith('.md')),
  join(ROOT, 'mcp', 'stdio', 'server-instructions.js'),
];

export const repoPath = (file) => relative(ROOT, file).replaceAll('\\', '/');
