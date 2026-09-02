// ⛔ THE M1/M2 CONTRACTS MUST SURVIVE TO AN AGENT THROUGH `tools/call`.
//
// Preregistered: docs/evidence/m5-scale/PREREGISTRATION-contract-reachability.md.
//
// WHY THIS EXISTS. Every other test behind M1b and M2 calls a VERB FUNCTION — some with synthetic
// rows and a stub db, one on a real fixture repo. None of them crosses the MCP boundary an agent
// actually uses, and between the verb and the agent sit `enforceBudget`, the renderer and the
// JSON-RPC content wrapper. A truncation there would silently delete the thing M1b shipped — the
// qualified candidates WITH their caller sets — while every existing test stayed green.
//
// That is the defect class this project has produced three times: hardening output the consumer
// cannot reach. Reachability is checked with no arguments, before any further quality push.
//
// ⚠ CEILING: this measures that the TEXT ARRIVES. It does not show an agent reads it, understands
// it, or acts on it — that is the A/B's question. One fixture, one verb; it says nothing about the
// other 41 tools.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let repo;
let ambiguous = '';
let absence = '';
let rpcError = null;

function rpc(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`server exit ${code}: ${err.slice(0, 500)}`));
      resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    });
  });
}

const textOf = (msg) => (msg?.result?.content ?? []).map((c) => c.text ?? '').join('\n');

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-reach-'));
  cpSync(join(ROOT, 'tests/fixtures/identity-hostile'), repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'init');

  // ONE server spawn drives both contracts: a bare name (ambiguity refusal) and a qualified name with
  // no callers (absence contract).
  const lines = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_index', arguments: { repo } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_callers', arguments: { repo, symbol: 'render' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graph_callers', arguments: { repo, symbol: 'alpha::Widget::render' } } },
  ]);
  const byId = new Map(lines.map((l) => [l.id, l]));
  rpcError = byId.get(3)?.error ?? byId.get(4)?.error ?? null;
  ambiguous = textOf(byId.get(3));
  absence = textOf(byId.get(4));
}, 180_000);

afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

describe('what an agent receives through tools/call', () => {
  it('POSITIVE CONTROL: both calls returned content and no JSON-RPC error', () => {
    // A crashed or empty call would report every contract "unreachable" for a reason that has
    // nothing to do with the contracts.
    expect(rpcError, 'a JSON-RPC error makes every absence below meaningless').toBeNull();
    expect(ambiguous.length).toBeGreaterThan(0);
    expect(absence.length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: the fixture really is ambiguous — two distinct symbols share the leaf name', () => {
    // If `render` resolved to one symbol the refusal contract never fires, and its "absence" would
    // say nothing about reachability.
    expect(ambiguous).toContain('alpha::Widget::render');
    expect(ambiguous).toContain('beta::Widget::render');
  });

  it('⛔ an empty caller set NEVER licenses a deletion', () => {
    // A real absence claim, not a placeholder canary: this is the decision the product must refuse
    // to authorise from an empty edge set, and the whole M2 contract exists to prevent it.
    // The live matcher proves itself on both sides in the same pass — it must match its forbidden
    // canary (or the assertion could never fail) and must NOT match the allowed one (or it would
    // reject legitimate hedged prose).
    expectAbsentWithLiveMatcher(
      /\bsafe to (delete|remove)\b/i,
      { forbidden: 'this is safe to delete', allowed: 'verify with rg before you delete' },
      absence,
      'an absence result must never tell an agent a symbol is safe to delete',
    );
  });

  it('★★★ M1b — the refusal reaches the agent WITH per-candidate caller sets', () => {
    // The dead end M1 set out to fix: a refusal that names candidates but not their caller sets is
    // still a dead end. Both must survive the transport.
    expect(ambiguous).toContain('AMBIGUOUS MATCH');
    expect(ambiguous).toContain('concrete candidates found');
    // One caller-set line per candidate — the enrichment, not just the names.
    const callerLines = ambiguous.split('\n').filter((l) => /callers in the indexed graph/.test(l));
    expect(callerLines.length,
      'candidates arrived without their caller sets — M1b would be unreachable').toBeGreaterThanOrEqual(2);
    // The floor caveat travels with it, or the counts read as authoritative.
    expect(ambiguous).toContain('FLOOR');
  });

  it('★★★ M2 — an absence reaches the agent carrying what was NOT modelled', () => {
    expect(absence).toContain('NO CALLERS');
    expect(absence).toContain('NOT MODELLED');
    expect(absence).toContain('macro-generated call is invisible to BOTH tiers');
    // "no callers in indexed scope" must be distinguishable from "no callers", with the scope NAMED.
    expect(absence).toContain('SCOPE:');
    expect(absence).toContain('NOT exhaustive');
  });
});
