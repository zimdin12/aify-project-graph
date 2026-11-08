// #19: the documented two-step CLI path works: `apg code-intel collect ... --json`, then scripts/import-code-intel.mjs.
//
// collect writes one v0.2 collection envelope; the import script read only v0.1 JSONL (one record per line) and
// refused the envelope with "record.kind must be a non-empty string". graph_collect_code_intel imports in-process and
// never hit this, so the CLI route, the one left when the MCP verbs retire (#8), was broken alone.
// Real clangd, real index, real files in a scratch git repository; gated on the product's resolver like the other
// real-server files.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clangdAvailable } from './clangd-gate.js';
import { openExistingDb } from '../../../mcp/stdio/storage/db.js';

const APG = fileURLToPath(new URL('../../../', import.meta.url));
const node = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180_000 });
const importScript = (repo, file) => node(join(APG, 'scripts', 'import-code-intel.mjs'), repo, file);
// Read the graph the way a reader would, not the import script's own report of what it did.
function lspVerifiedEdges(repo) {
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try { return db.get("SELECT COUNT(*) AS n FROM edges WHERE provenance = 'LSP_VERIFIED'").n; } finally { db.close(); }
}

let base;
beforeAll(() => { base = mkdtempSync(join(tmpdir(), 'apg-collect-import-')); });
afterAll(() => { try { rmSync(base, { recursive: true, force: true }); } catch { /* win lock */ } });

describe.skipIf(!clangdAvailable)('collect → import through the CLI (real clangd)', () => {
  it('★★★ the envelope `apg code-intel collect --json` prints imports, and its records land in the graph', () => {
    const repo = join(base, 'cpp');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'foo.cpp'), 'namespace ns { void foo(int); }\nvoid main_call() { ns::foo(7); }\n');
    writeFileSync(join(repo, 'src', 'bar.cpp'), 'namespace ns { void foo(int x) {} }\n');
    const dir = repo.replaceAll('\\', '/');
    writeFileSync(join(repo, 'compile_commands.json'), JSON.stringify(['foo', 'bar'].map((f) => ({
      directory: dir, command: `clang++ -std=c++17 -c src/${f}.cpp -o ${f}.o`, file: `src/${f}.cpp`,
    }))));
    writeFileSync(join(repo, '.gitignore'), '.aify-graph/\n');
    const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');

    expect(node(join(APG, 'bin', 'apg.js'), 'index', repo).status, 'apg index').toBe(0);
    const collect = node(join(APG, 'bin', 'apg.js'), 'code-intel', 'collect', 'cpp', '--project-root', repo, '--scope', 'all', '--json');
    expect(collect.status, collect.stderr).toBe(0);
    const envelope = JSON.parse(collect.stdout.slice(collect.stdout.indexOf('{')));
    expect(envelope.records.length, 'the collection found records to import').toBeGreaterThan(0);
    const file = join(base, 'collection.json');
    writeFileSync(file, JSON.stringify(envelope));
    expect(lspVerifiedEdges(repo), 'control: indexing alone writes no compiler-verified edge').toBe(0);

    const imported = importScript(repo, file);
    expect(imported.status, imported.stderr).toBe(0);
    const stats = JSON.parse(imported.stdout);
    expect(stats.schemaVersion).toBe('0.2');
    expect(stats.recordsImported).toBe(envelope.records.length);
    expect(lspVerifiedEdges(repo), 'the graph now holds compiler-verified edges').toBeGreaterThan(0);
  }, 240_000);
});

describe('import-code-intel.mjs keeps its validated v0.1 path (controls)', () => {
  it('★★ a valid v0.1 JSONL record imports', () => {
    const repo = join(base, 'v01'); mkdirSync(repo, { recursive: true });
    const file = join(base, 'ok.jsonl');
    writeFileSync(file, `${JSON.stringify({ kind: 'symbol', qname: 'ns::foo', file: 'src/foo.cpp' })}\n`);
    const run = importScript(repo, file);
    expect(run.status, run.stderr).toBe(0);
  });

  it('★★ a malformed v0.1 record is still refused by the v0.1 validator', () => {
    const repo = join(base, 'v01bad'); mkdirSync(repo, { recursive: true });
    const file = join(base, 'bad.jsonl');
    writeFileSync(file, `${JSON.stringify({ kind: 'symbol', name: 'x' })}\n`);
    const run = importScript(repo, file);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/symbol\.file must be a non-empty string/u);
  });
});
