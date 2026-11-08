// #2: a graph is enabled by one explicit command, and a read on a project without one names that command.
//
// `apg index` builds at the git top level (never a nested graph), keeps `.aify-graph/` out of git through the local
// `.git/info/exclude` only when nothing ignores it yet, refuses a non-git directory without writing, and fails LOUDLY:
// unlike the hook payload, a failed build exits non-zero with its reason. The provider's subgraph read on a repository
// with no graph.sqlite refuses `no_index` with both commands and writes nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { runIndexCmd, enableSteps } from '../../../scripts/lib/apg-index.mjs';
import { answerRequest } from '../../../scripts/lib/provider-requests.mjs';
import { readSubgraph } from '../../../scripts/lib/provider-subgraph.mjs';

let base;
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
function repo() {
  const root = join(base, 'repo');
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), 'export function a() { return 1; }\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  git(root, 'init', '-q');
  // A project the dashboard serves has history; on an unborn branch the build fails, and says so (exit 1, reason).
  git(root, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'add', '.');
  git(root, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
  return root;
}
const quiet = () => { const lines = []; return { lines, print: (l) => lines.push(l) }; };
const excludeOf = (root) => readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');

beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'apg-index-')); });
afterEach(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* win lock */ } });

describe('apg index', () => {
  it('★★★ from a SUBDIRECTORY it builds at the git top level, excludes .aify-graph locally, and leaves .gitignore alone', async () => {
    const root = repo();
    const out = quiet();
    const code = await runIndexCmd([join(root, 'src', 'deep')], out);
    expect(code, out.lines.join('\n')).toBe(0);
    expect(existsSync(join(root, '.aify-graph', 'graph.sqlite')), 'the graph is at the top level').toBe(true);
    expect(existsSync(join(root, 'src', 'deep', '.aify-graph')), 'no nested graph').toBe(false);
    expect(excludeOf(root)).toMatch(/^\.aify-graph\/$/mu);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    expect(git(root, 'status', '--porcelain', '--ignored=no')).not.toMatch(/\.aify-graph/u);
    // The last line is how to keep it current, with this host's real paths.
    expect(out.lines.at(-1)).toContain(enableSteps(root)[1]);
  }, 120_000);

  it('★★★ a path ALREADY ignored is not added again', async () => {
    const root = repo();
    writeFileSync(join(root, '.gitignore'), '.aify-graph/\n');
    const before = existsSync(join(root, '.git', 'info', 'exclude')) ? excludeOf(root) : null;
    expect(await runIndexCmd([root], { print: () => {}, build: async () => {} })).toBe(0);
    const after = existsSync(join(root, '.git', 'info', 'exclude')) ? excludeOf(root) : null;
    expect(after).toBe(before);
  });

  it('★★★ a NON-GIT directory is refused and nothing is written', async () => {
    const plain = join(base, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'a.js'), 'x\n');
    let built = false;
    const out = quiet();
    const code = await runIndexCmd([plain], { ...out, build: async () => { built = true; } });
    expect(code).not.toBe(0);
    expect(built).toBe(false);
    expect(readdirSync(plain)).toEqual(['a.js']);
    expect(out.lines.join('\n')).toMatch(/not a git repository/u);
  });

  it('★★★ a FAILED build exits non-zero with its reason; the control build exits 0', async () => {
    const root = repo();
    const failed = quiet();
    expect(await runIndexCmd([root], { ...failed, build: async () => { throw new Error('disk full'); } })).not.toBe(0);
    expect(failed.lines.join('\n')).toMatch(/disk full/u);
    expect(await runIndexCmd([root], { print: () => {}, build: async () => {} })).toBe(0);
  });
});

describe('a subgraph read on a project with no graph names the enable steps', () => {
  it('★★★ no graph.sqlite (only code-intel/) refuses no_index with both commands, writes nothing, and meets the schema', () => {
    const root = repo();
    mkdirSync(join(root, '.aify-graph', 'code-intel'), { recursive: true });
    const answer = answerRequest({
      request: { call: 'subgraph', args: { path: 'src/a.js' } },
      resolveItem: () => { throw new Error('not used'); },
      readSubgraph: (parsed) => readSubgraph({ repoRoot: root, request: parsed, head: 'h'.repeat(40) }),
      head: 'h'.repeat(40),
    });
    expect(answer.ok).toBe(false);
    expect(answer.value.reasonCode).toBe('no_index');
    expect(answer.value.enable).toEqual(enableSteps(root));
    for (const step of enableSteps(root)) expect(answer.problem).toContain(step);
    expect(readdirSync(join(root, '.aify-graph'))).toEqual(['code-intel']);
    const schema = JSON.parse(readFileSync(new URL('../../../docs/schemas/provider-answer.v1.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(answer), JSON.stringify(validate.errors)).toBe(true);
  });
});
