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
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../helpers/live-matcher.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SYM = 'alpha::Widget::render';

// EVERY consumer of the M2 absence contract — derived from the callers of `buildAbsenceTrustLine`
// (lsp-evidence.js:396), not a hand-picked sample. `consequences.js:1150` mentions it in a COMMENT
// only and is deliberately not here.
//
// ⛔ graph_neighbors needs `edge_types: ['CALLS']`. Without it the symbol has structural CONTAINS and
// DEFINES edges, the result is non-empty, and the absence branch never fires — the verb would look
// "unreachable" when it had simply never been asked the question.
const ABSENCE_CONSUMERS = Object.freeze([
  { verb: 'graph_callers', noun: 'CALLERS', args: (repo) => ({ repo, symbol: SYM }) },
  { verb: 'graph_callees', noun: 'CALLEES', args: (repo) => ({ repo, symbol: SYM }) },
  { verb: 'graph_impact', noun: 'IMPACT', args: (repo) => ({ repo, symbol: SYM }) },
  { verb: 'graph_neighbors', noun: 'NEIGHBORS', args: (repo) => ({ repo, symbol: SYM, edge_types: ['CALLS'] }) },
  { verb: 'graph_trace', noun: 'NO STATIC PATH', args: (repo) => ({ repo, from: SYM, to: 'beta::Widget::render' }) },
]);

let repo;
let ambiguous = '';
let absence = '';
let rpcError = null;
let listed = new Set();
let consumerText = new Map();
let staleNoMatch = '';

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
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graph_callers', arguments: { repo, symbol: SYM } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} },
    ...ABSENCE_CONSUMERS.map((c, i) => ({
      jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: { name: c.verb, arguments: c.args(repo) },
    })),
  ]);
  const byId = new Map(lines.map((l) => [l.id, l]));
  rpcError = byId.get(3)?.error ?? byId.get(4)?.error ?? null;
  ambiguous = textOf(byId.get(3));
  absence = textOf(byId.get(4));
  listed = new Set((byId.get(5)?.result?.tools ?? []).map((t) => t.name));
  consumerText = new Map(ABSENCE_CONSUMERS.map((c, i) => [c.verb, textOf(byId.get(10 + i))]));

  // ⛔ THE DISCLOSURES ADDED SINCE THIS GATE WAS WRITTEN WERE NEVER CHECKED HERE. The NO MATCH
  // staleness caveat is verified at VERB-FUNCTION level only, and this file exists precisely because
  // enforceBudget and the renderer sit between a verb and the agent — a truncation there drops a
  // contract silently while the suite stays green. That is the gap I closed once for M1b/M2 and then
  // let reopen for every disclosure added afterwards.
  //
  // A SECOND spawn, because the index must be stale: HEAD moves past the indexed commit, so the
  // caveat is TRUE. On the fresh state above it is correctly silent, which is why it cannot be
  // observed in the same sequence.
  writeFileSync(join(repo, 'src', 'later.cpp'), 'int later() { return 7; }\n');
  execFileSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8', stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'after the index'], { encoding: 'utf8', stdio: 'pipe' });
  const staleLines = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_callers', arguments: { repo, symbol: 'definitelyNotIndexedSymbolXyz' } } },
  ]);
  staleNoMatch = textOf(new Map(staleLines.map((l) => [l.id, l])).get(2));
}, 240_000);

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

describe('the absence contract reaches an agent from EVERY consumer, not just the one I picked', () => {
  // The previous finding proved the contract arrives from graph_callers — the verb I happened to
  // choose — and said so in its ceiling. M2 is recorded DONE with FIVE consumers, and "one consumer
  // works" has been mistaken for "the contract is delivered" in this project before.
  const MARKER = 'NOT MODELLED: a macro-generated call is invisible to BOTH tiers';

  it('POSITIVE CONTROL: every consumer actually returned an ABSENCE', () => {
    // The contract fires only on an empty result. A verb that returned edges was never asked the
    // question, and calling its silence "unreachable" would be an artefact of the query, not a
    // property of the product. This control caught exactly that: graph_neighbors first came back
    // with CONTAINS/DEFINES edges.
    for (const { verb, noun } of ABSENCE_CONSUMERS) {
      expect(consumerText.get(verb), `${verb} did not produce an absence — it was never asked`)
        .toContain(noun);
    }
  });

  it('★★★ all five consumers carry the NOT MODELLED clause to the agent', () => {
    const missing = ABSENCE_CONSUMERS
      .filter(({ verb }) => !consumerText.get(verb)?.includes(MARKER))
      .map(({ verb }) => verb);
    expect(missing, 'a shipped contract that does not arrive is undelivered, not merely untested')
      .toEqual([]);
  });

  it('★★★ the NO MATCH staleness caveat REACHES the agent too', () => {
    // Added because this gate covered only the contracts it was born with. Every disclosure shipped
    // afterwards was verified at verb-function level and never across the MCP boundary — the exact
    // gap this file exists to close, reopened by my own later work.
    expect(staleNoMatch, 'the call did not answer').toContain('NO MATCH');
    expect(staleNoMatch, 'a bare NO MATCH reads as a fact about the REPOSITORY')
      .toMatch(/behind HEAD|staleness could NOT be determined/i);
    expect(staleNoMatch, 'the agent must be told this is not proof of absence')
      .toMatch(/NOT proof/i);
  });

  it('⚠ what this gate still CANNOT reach, named rather than implied', () => {
    // TRUST: UNAVAILABLE (both builders) is verified only at verb-function level, under a mocked
    // fault. Reaching it here would need the fault injected INSIDE a spawned server process, and
    // there is no hook for that. Stating the limit beats a gate that silently covers less than its
    // name suggests — and beats inventing a hook whose own correctness would then need proving.
    const NOT_REACHABLE_HERE = ['TRUST: UNAVAILABLE (absence)', 'TRUST: UNAVAILABLE (results)'];
    expect(NOT_REACHABLE_HERE).toHaveLength(2);
  });

  it('SURFACE: the primary delete-decision consumer is in the listing an agent sees', () => {
    // ⛔ TRANSPORT AND SURFACE ARE DIFFERENT NOUNS. tools/call reaches unlisted verbs, but a runtime
    // that defers tools behind a search step reaches only what is LISTED. Measured 2026-09-02:
    // graph_callees and graph_neighbors are callable and NOT in the default 16, so their (correct)
    // contract is delivered in principle and undelivered in practice there.
    //
    // That gating is deliberate — "agents under-pick from big lists" — so the unlisted set is
    // recorded in the finding rather than pinned here, where it would fight a legitimate change.
    // What must hold is that the listing works and the primary consumer is in it.
    expect(listed.size, 'an empty listing would score every verb unreachable for the wrong reason')
      .toBeGreaterThan(0);
    expect(listed.has('graph_callers'),
      'the verb a delete decision routes through must be reachable in the default surface').toBe(true);
  });
});
