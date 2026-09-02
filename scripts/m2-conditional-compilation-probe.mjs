// THE clangd HALF of the conditional-compilation finding, reproducible on demand.
//
// The tracked fixture `tests/fixtures/conditional-compilation` carries no compile_commands.json,
// because its `directory`/`file` entries are absolute and a committed one would be wrong on every
// other machine. This generates one, runs a real collection, and prints both tiers side by side.
//
//   node scripts/m2-conditional-compilation-probe.mjs
//
// ⛔ POSITIVE CONTROL IS THE POINT. `visibleCall()` is always compiled and MUST come back
// lsp-verified. Without it, "clangd produced no edge for hiddenCall" is indistinguishable from
// "clangd produced nothing", which is the vacuous zero this repo keeps catching.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-condcomp-probe-'));
fs.cpSync(path.join(REPO, 'tests/fixtures/conditional-compilation'), dir, { recursive: true });

const posix = (p) => p.split(path.sep).join('/');
// Deliberately NO -DFEATURE_X: the branch under test must be inactive.
fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify([{
  directory: posix(dir),
  file: posix(path.join(dir, 'src/lib.cpp')),
  command: 'clang++ -std=c++17 -nostdinc++ -c src/lib.cpp',
}], null, 1), 'utf8');

const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');

const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
const { graphCollectCodeIntel } = await import('../mcp/stdio/query/verbs/collect_code_intel.js');
const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');

await graphIndex({ repoRoot: dir });
const col = await graphCollectCodeIntel({ repoRoot: dir, language: 'cpp', scope: 'all' });
console.log(`collect: status=${col?.status} records=${col?.imported?.recordsImported ?? 0} edges=${col?.imported?.edgesCreated ?? 0}`);

// Read the EDGE lines only. The trust caveat contains the phrase `no callers`, which fooled an
// earlier version of this probe into classifying a listed caller set as an absence.
const edgeLines = async (symbol) => String(await graphCallers({ repoRoot: dir, symbol, top_k: 20, depth: 1 }))
  .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('EDGE '));

const visible = await edgeLines('demo::visibleCall');
const hidden = await edgeLines('demo::hiddenCall');
console.log('\nPOSITIVE CONTROL demo::visibleCall');
for (const l of visible) console.log(`   ${l}`);
console.log('UNDER TEST       demo::hiddenCall');
for (const l of hidden) console.log(`   ${l}`);

const lspVerified = (lines) => lines.some((l) => l.includes('lsp✓'));
console.log('\nVERDICT:');
if (!lspVerified(visible)) {
  console.log('  VOID — the always-compiled call is not lsp-verified, so clangd produced nothing usable.');
  console.log('  Nothing can be concluded about the inactive branch.');
} else if (lspVerified(hidden)) {
  console.log('  ⛔ clangd DID verify a call inside an inactive #ifdef branch. The shipped caveat is wrong.');
} else {
  console.log('  ✅ clangd verified the always-compiled call and NOT the inactive-branch one (UNDERCOUNT),');
  console.log('  while the heuristic tier reports the inactive-branch call (OVERCOUNT). Opposite directions.');
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* handle */ }
