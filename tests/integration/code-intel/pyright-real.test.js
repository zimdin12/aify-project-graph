// Real pyright integration. Bundled plugin dep, so normally runs; self-skips if
// the package can't be resolved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeIntelReferences, codeIntelSymbols } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { _resetSessions, shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';
import { createPyrightProvider, pythonSpawnFor } from '../../../mcp/stdio/code-intel/providers/pyright.js';

const spawn = pythonSpawnFor(process.cwd());
const serverAvailable = spawn.command === process.execPath && fs.existsSync(spawn.args[0]);
const d = serverAvailable ? describe : describe.skip;

let repo;
function writeFixture() {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pyreal-'));
  fs.writeFileSync(path.join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n\ndef double(x):\n    return add(x, x)\n\nprint(add(1, 2))\nprint(double(4))\n');
}

d('pyright (real) — live verbs', () => {
  beforeAll(() => { _resetSessions(); writeFixture(); });
  afterAll(async () => { await shutdownAllSessions(); _resetSessions(); });

  it('codeIntelSymbols returns the outline (language inferred from .py)', async () => {
    const r = await codeIntelSymbols({ repoRoot: repo, file: 'calc.py' });
    expect(r.status).toBe('ok');
    const names = (r.symbols || []).map((s) => s.name || s.qname);
    expect(names).toContain('add');
    expect(names).toContain('double');
  }, 30000);

  it('codeIntelReferences resolves callers but is NEVER exhaustive (Python dynamic dispatch)', async () => {
    const r = await codeIntelReferences({ repoRoot: repo, file: 'calc.py', line: 1, col: 5, waitForReadyMs: 6000 });
    expect(r.status).toBe('ok');
    expect((r.referenceLocations || []).length).toBeGreaterThan(0); // found the call sites
    expect(r.evidence.exhaustive).toBe(false);                      // honest: a floor, not a ceiling
    // the duck-typing caveat is surfaced so an agent verifies before deleting
    expect((r.evidence.warnings || []).join(' ')).toMatch(/duck typing|dynamic|getattr|floor/i);
  }, 30000);
});

d('pyright (real) — collection', () => {
  afterAll(async () => { await shutdownAllSessions(); _resetSessions(); });
  it('collect(scope:all) yields relative-path records with mtime freshness', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-pycol-'));
    fs.writeFileSync(path.join(r, 'm.py'), 'def f():\n    return 1\n\ndef g():\n    return f()\n');
    const env = await createPyrightProvider().collect({ projectRoot: r, scope: 'all', operations: ['symbols', 'references'] });
    expect(env.status).toBe('ok');
    expect(env.provider).toBe('pyright');
    const refs = env.records.filter((rec) => rec.kind === 'reference' && rec.file);
    expect(refs.every((rec) => !rec.file.startsWith('file:'))).toBe(true);
    expect(env.session.freshnessBasis).toBe('mtime');
  }, 30000);
});
