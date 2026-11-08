// `apg index [dir]`: enable a project's code graph with one explicit command (#2).
//
// The dashboard tells an agent how to enable a graph instead of a read building one; these are the steps it relays,
// and `enableSteps` is their one source. Unlike scripts/reindex.mjs, the git-hook payload that must never fail a git
// operation, this command is a step someone runs on purpose, so a failed build exits non-zero with its reason.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const APG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..').replaceAll('\\', '/');

/** The two commands that enable and then keep current a graph for `repoRoot`, with this host's real paths. PURE. */
export function enableSteps(repoRoot) {
  const repo = String(repoRoot).replaceAll('\\', '/');
  return [`node "${APG}/bin/apg.js" index "${repo}"`, `node "${APG}/scripts/install-graph-hook.mjs" "${repo}"`];
}

/** @returns {Promise<number>} the exit code */
export async function runIndexCmd(argv, { print = console.log, build = buildGraph } = {}) {
  const top = gitTopLevel(resolve(argv[0] ?? process.cwd()));
  if (top === null) {
    print(`apg index: ${resolve(argv[0] ?? process.cwd())} is not a git repository, so nothing was written`);
    return 1;
  }
  if (excludeIfNotIgnored(top)) print(`apg index: added .aify-graph/ to ${gitPath(top, 'info/exclude')}`);
  try {
    await build(top);
  } catch (error) {
    print(`apg index: the build failed: ${error?.message ?? error}`);
    return 1;
  }
  print(`apg index: built ${top}/.aify-graph`);
  print(`keep it current on every commit, pull and checkout: ${enableSteps(top)[1]}`);
  return 0;
}

// The same refresh the hook payload runs (scripts/reindex.mjs): the graph, then the briefs that read it.
async function buildGraph(repoRoot) {
  const { ensureFresh } = await import('../../mcp/stdio/freshness/orchestrator.js');
  const { generateBrief } = await import('../../mcp/stdio/brief/generator.js');
  const { writeUnresolvedCategorization } = await import('../../mcp/stdio/freshness/unresolved-categorization.js');
  await ensureFresh({ repoRoot });
  generateBrief({ repoRoot });
  await writeUnresolvedCategorization({ repoRoot });
}

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();

function gitTopLevel(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel']); } catch { return null; }
}

function gitPath(top, name) {
  return resolve(top, git(top, ['rev-parse', '--git-path', name]));
}

/** Add `.aify-graph/` to the local exclude file when nothing ignores it yet. Returns whether it wrote. */
function excludeIfNotIgnored(top) {
  try {
    git(top, ['check-ignore', '-q', '.aify-graph/']);
    return false; // exit 0: already ignored
  } catch (error) {
    if (error?.status !== 1) throw error; // 1 is "not ignored"; anything else is git failing, and is not hidden
  }
  const file = gitPath(top, 'info/exclude');
  mkdirSync(dirname(file), { recursive: true });
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}.aify-graph/\n`);
  return true;
}
