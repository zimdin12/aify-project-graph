// Real typescript-language-server integration. The server is a bundled plugin
// dep, so this normally runs; it self-skips if the package can't be resolved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeIntelReferences, codeIntelSymbols } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { codeIntelHierarchy } from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';
import { _resetSessions, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';
import { createTsLangServerProvider, tsSpawnFor } from '../../../mcp/stdio/code-intel/providers/ts-langserver.js';

// Skip cleanly if the bundled server isn't installed (e.g. fresh checkout w/o npm i).
const spawn = tsSpawnFor(process.cwd());
const serverAvailable = spawn.command === process.execPath && fs.existsSync(spawn.args[0]);
const d = serverAvailable ? describe : describe.skip;

let repo;
function writeFixture() {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsreal-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020', module: 'commonjs' }, include: ['src'] }));
  fs.writeFileSync(path.join(repo, 'src', 'math.ts'), 'export function add(a: number, b: number): number { return a + b; }\nexport function double(x: number): number { return add(x, x); }\n');
  fs.writeFileSync(path.join(repo, 'src', 'main.ts'), "import { add, double } from './math';\nconsole.log(add(1, 2));\nconsole.log(double(4));\n");
}

d('typescript-language-server (real) — live verbs', () => {
  beforeAll(() => { _resetSessions(); writeFixture(); });
  afterAll(async () => { await shutdownAllSessions(); _resetSessions(); });

  it('codeIntelSymbols returns the file outline (language inferred from .ts)', async () => {
    const r = await codeIntelSymbols({ repoRoot: repo, file: 'src/math.ts' });
    expect(r.status).toBe('ok');
    const names = (r.symbols || []).map((s) => s.name || s.qname);
    expect(names).toContain('add');
    expect(names).toContain('double');
  });

  it('codeIntelReferences resolves cross-file callers + is exhaustive WITH a tsconfig', async () => {
    // `add` is defined at math.ts:1, identifier at col 17.
    const r = await codeIntelReferences({ repoRoot: repo, file: 'src/math.ts', line: 1, col: 17, waitForReadyMs: 6000 });
    expect(r.status).toBe('ok');
    const files = (r.referenceLocations || []).map((x) => x.file);
    expect(files).toContain('src/main.ts'); // cross-file caller found
    // ⛔ SUPERSEDED 2026-08-19. A tsconfig — like a compile DB — states which files the language
    // server MAY index, not which it actually DID. graph-senior-dev executed the C++ instance:
    // both sources in the DB, one uncompilable, its caller absent, exhaustive:true returned.
    // The mechanism is not asserted for tsserver (nobody has executed it there); what IS true
    // for both is that we do not OBSERVE per-file index success, so a completeness claim is
    // over an unobserved population either way. Declining to claim is not the same as claiming
    // a defect.
    // ⇒ Precision is unaffected and still asserted above: the cross-file caller IS found.
    expect(r.evidence.exhaustive, 'the index population is unattested for tsserver too').toBe(false);
    expect(r.evidence.cause).toBe('index_population_unattested');
    expect(r.evidence.precision, 'each returned location is still compiler-resolved').toBe('compiler_resolved');
  }, 30000);

  it('codeIntelHierarchy (callers) builds a call tree for a TS symbol', async () => {
    const r = await codeIntelHierarchy({ repoRoot: repo, file: 'src/math.ts', line: 1, col: 17, kind: 'callers', depth: 1 });
    expect(r.status).toBe('ok');
    // tsserver advertises callHierarchy; a root must resolve (not a false "no root").
    expect(r.tree).not.toBeNull();
  }, 30000);
});

d('typescript-language-server (real) — collection → importable records', () => {
  afterAll(async () => { await shutdownAllSessions(); _resetSessions(); });
  it('collect(scope:all) yields relative-path symbol/definition/reference records', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tscol-'));
    fs.mkdirSync(path.join(r, 'src'), { recursive: true });
    fs.writeFileSync(path.join(r, 'tsconfig.json'), '{"include":["src"]}');
    fs.writeFileSync(path.join(r, 'src', 'a.ts'), 'export function f() { return 1; }\nexport function g() { return f(); }\n');
    const env = await createTsLangServerProvider().collect({ projectRoot: r, scope: 'all', operations: ['symbols', 'definitions', 'references'] });
    expect(env.status).toBe('ok');
    expect(env.provider).toBe('ts-langserver');
    const refs = env.records.filter((rec) => rec.kind === 'reference' && rec.file);
    expect(refs.length).toBeGreaterThan(0);
    // paths are repo-relative, not file:// URIs
    expect(refs.every((rec) => rec.file.startsWith('src/'))).toBe(true);
    expect(env.session.freshnessBasis).toBe('tsconfig_hash');
  }, 30000);
});
