// WHICH VERBS ACTUALLY CHANGE WHEN THE PUBLICATION STATE IS TORN?
//
// Preregistered: docs/evidence/m5-scale/PREREGISTRATION-tearing-contrast.md — population, identity
// rule, controls, claim ceiling and abandon rule fixed before this file existed, and both possible
// outcomes given a decided consequence in advance.
//
// ⛔ WHY IT EXISTS. `scripts/lib/ab-rubric.mjs` credits three gate-carrying verbs, and the test
// pinning that list explains it as verbs whose route "does not actually change under tearing". My
// route census measured a DIFFERENT property — which verbs CONSUME publication state — and found 29,
// including graph_callers. Reading `callers.js:35` (`if (freshness.blocker) return freshness.blocker`)
// made a change look certain.
//
// ⭐ MEASUREMENT FALSIFIED THAT. graph_callers is BYTE-IDENTICAL under tearing (563 -> 563 chars).
// The blocker path exists but does not fire for a static generation mismatch — it is for an
// unattested REBUILD. Consuming publication state does NOT imply changing under tearing, and the
// rubric's three names are correct. Reading source is not measuring behaviour; that substitution has
// now falsified three predictions in this project.
//
// ⇒ This file is the mechanical form of the rubric's assumption. If someone later wires publication
// state into graph_callers, this goes red and GATE_CARRYING_VERBS must be revisited — instead of the
// rubric silently under-crediting a route that had started to carry the gate.
//
// ⚠ CEILING: ONE tearing mode (generation mismatch), a small JS fixture, verb functions called
// directly. It says nothing about C++, about the other attestation classes (LEGACY_UNATTESTED,
// NEVER_COMPLETED, MANIFEST_UNUSABLE), or about whether a change is USEFUL to an agent — that is the
// A/B's question, not this probe's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let repo;
let manifestPath;
let attested; // the manifest exactly as a healthy rebuild wrote it

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-tearing-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });

  manifestPath = join(repo, '.aify-graph', 'manifest.json');
  attested = readFileSync(manifestPath, 'utf8');
}, 180_000);

afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

const restore = () => writeFileSync(manifestPath, attested, 'utf8');

// Tear by moving the MANIFEST's generation away from the database's — the exact comparison
// classifyAttestation makes (publication-schema.js:224), not a stand-in for it. Measured to SURVIVE
// the verb call: the manifest still reads the torn value afterwards, so no repair path erases it
// before the verb looks.
function tear() {
  const m = JSON.parse(attested);
  m.generation = (typeof m.generation === 'number' ? m.generation : 0) + 41;
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf8');
}

// ⛔ graph_health returns an OBJECT. My first version used String(), compared "[object Object]" to
// itself, and the positive control failed for a reason that had nothing to do with the product.
const ser = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const normalise = (v) => ser(v)
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<TS>')
  .replace(/\b\d+\s?ms\b/g, '<MS>')
  .replace(/apg-tearing-[A-Za-z0-9]+/g, '<TMP>')
  .replace(/\b[0-9a-f]{7,40}\b/g, '<SHA>')
  .trim();

async function call(name) {
  const fns = {
    graph_health: async () => (await import('../../../mcp/stdio/query/verbs/health.js')).graphHealth({ repoRoot: repo }),
    graph_callers: async () => (await import('../../../mcp/stdio/query/verbs/callers.js')).graphCallers({ repoRoot: repo, symbol: 'target' }),
    graph_search: async () => (await import('../../../mcp/stdio/query/verbs/search.js')).graphSearch({ repoRoot: repo, query: 'target' }),
  };
  return normalise(await fns[name]());
}

// Attested twice, then torn — the determinism control and the contrast come from the SAME pass, so a
// verb that was merely non-deterministic can never be reported as gate-carrying.
async function contrast(name) {
  restore(); const healthy = await call(name);
  restore(); const again = await call(name);
  tear(); const torn = await call(name);
  restore();
  return { deterministic: again === healthy, changed: torn !== healthy, healthy, torn };
}

// Preregistered population members this file does not exercise. Their entry points take a different
// shape and inventing a call would test my wiring rather than the product. NAMED, because a silently
// dropped member shrinks the population without shrinking the claim.
const NOT_EXERCISED = ['graph_status', 'graph_impact', 'graph_packet'];

describe('tearing the publication state: which verbs move?', () => {
  it('★ POSITIVE CONTROL: graph_health changes under tearing', async () => {
    // The abandon rule. If THE trust verb does not move, the probe is broken and nothing may be
    // concluded about any other verb — which is exactly what happened on the first run.
    const r = await contrast('graph_health');
    expect(r.deterministic, 'two attested runs must agree, or no difference means anything').toBe(true);
    expect(r.changed, 'tearing must move the trust verb, or this probe proves nothing').toBe(true);
    expect(r.torn).toContain('generation_mismatch');
    expect(r.healthy).toContain('attested');
  }, 120_000);

  it('★★★ graph_callers does NOT change under tearing — measured, against my prediction', async () => {
    // Consuming publication state does not imply changing under tearing. This pins the assumption
    // GATE_CARRYING_VERBS rests on; if callers ever starts carrying the gate, this fires.
    const r = await contrast('graph_callers');
    expect(r.deterministic).toBe(true);
    expect(r.changed,
      'if this is now true, graph_callers carries the gate and GATE_CARRYING_VERBS must be revisited')
      .toBe(false);
  }, 120_000);

  it('graph_search does NOT change under tearing either', async () => {
    const r = await contrast('graph_search');
    expect(r.deterministic).toBe(true);
    expect(r.changed).toBe(false);
  }, 120_000);

  it('the preregistered population members not exercised here are named, not dropped', () => {
    expect(NOT_EXERCISED).toEqual(['graph_status', 'graph_impact', 'graph_packet']);
  });
});
