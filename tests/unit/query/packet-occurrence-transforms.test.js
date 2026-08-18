// graph-senior-dev's FOUR MINIMUM REGRESSIONS against 6a5e22a, written before the fix.
//
// ⛔ v7 closed all six of their original probes and still did not hold. Their four new
// findings, and what each one says about how I had been working:
//
//   A  The feature-matched branch still hand-assembles a population-free `DEFINED IN` header
//      with two-space rows. I fixed buildSymbolPointerPacket, saw "showing 1 of 1" in real
//      output, and reported the finding fixed GENERALLY. One branch, general claim — the
//      fourth-route mistake for the third time, made in the message announcing I had learned
//      it. This is a CURRENT production route, not a mutation.
//   B  Tagged populations were branded but never validated: exactly(0) with one row renders
//      "showing 1 of 0", a population statement that is not internally possible. And the
//      brand symbol was enumerable, so {...exactly(1), total: 0} kept the brand.
//   C  The prefix allowance applied to candidate lists too, so truncating after serialization
//      recreated the clamp lie: "showing 3 of 9" above one row, accepted.
//   D  And the same allowance did NOT cover the transform it existed for. Real skeletonization
//      REWRITES rows, so a healthy clamped bounded list was FALSELY ACCUSED.
//
// ★ C and D together are the argument: inferring an allowed transform from text is
// simultaneously too permissive and too weak. That is why the fix carries typed occurrences
// through the clamp instead of tuning the inference.
//
// ⚠ D also needs the real transform AND the final seal in ONE test. My previous clamp test
// called clampToBudget and never passed the result through sealPacketOutput — it stopped one
// boundary short of what it claimed to cover, which is the same shape as the mk(), mk() test
// that missed identity reuse the round before.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import * as L from '../../../mcp/stdio/query/verbs/packet-lists.js';

const strict = process.env.APG_PACKET_SEAL_STRICT === '1';
let repoRoot;

// The field-report fixture: a symbol anchored to a feature, so the packet takes the
// FEATURE-MATCHED branch — the one that was never converted.
async function anchoredRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-occtx-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
    features: [{
      id: 'fluid-runtime',
      name: 'fluid-runtime',
      anchors: { symbols: ['FluidRuntimeStatus'], files: [] },
    }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
          VALUES ('frs', 'Struct', 'FluidRuntimeStatus', 'game/UnifiedFluidRuntime.h', 378, 402, 'cpp', 1, '{}')`);
  db.close();
  return repo;
}

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('occurrence transforms and the routes that bypassed them', () => {
  it('★★★ A: the FEATURE-MATCHED branch states its population too', async () => {
    // The route I claimed was covered. One exact definition, so the honest header is
    // "1 of 1" — the same statement the pointer branch already makes.
    repoRoot = await anchoredRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'FluidRuntimeStatus' }));

    expect(text, 'harness sanity: this fixture MUST take the feature-matched path')
      .toMatch(/MATCHED VIA|fluid-runtime/);
    expect(text, 'harness sanity: and must actually list the definition')
      .toMatch(/game\/UnifiedFluidRuntime\.h/);
    // The finding itself.
    expect(text, 'a symbol list on ANY branch must state its population')
      .toMatch(/DEFINED IN[^\n]*showing 1 of 1/);
    // And it must be a real list the detector can see — dev's point that the two-space rows
    // put this route outside the grammar entirely.
    expect(text, 'rows must be governed list rows, not two-space indented text')
      .toMatch(/\n- game\/UnifiedFluidRuntime\.h/);
  }, 20_000);

  it('★★★ B: an impossible population is refused at construction', () => {
    // "showing 1 of 0" is not a sampling disclosure, it is a contradiction.
    expect(() => L.candidateList({ rows: ['- a.js'], symbol: 'X', population: L.exactly(0) }))
      .toThrow(/population|total/i);
    expect(() => L.exactly(-1)).toThrow(/population|negative|integer/i);
    expect(() => L.exactly(1.5)).toThrow(/integer/i);
    expect(() => L.atLeast('9')).toThrow(/integer/i);
  });

  it('★★★ B: a forged or spread population is refused', () => {
    // The brand was an ENUMERABLE symbol, so a spread copied it and the forgery kept the
    // brand while replacing the number.
    const forged = { ...L.exactly(1), total: 0 };
    expect(() => L.candidateList({ rows: ['- a.js'], symbol: 'X', population: forged }))
      .toThrow(/population/i);
    expect(() => L.candidateList({
      rows: ['- a.js'], symbol: 'X', population: { kind: 'exact', total: 99 },
    })).toThrow(/population/i);
  });

  it('★★★ C: truncating a candidate list after serialization is refused', async () => {
    // The prefix allowance let a header saying "showing 3 of 9" survive above one row —
    // the clamp lie, recreated by the mechanism meant to permit clamping.
    const { out, scope } = await L.withSealScope(async () => {
      const b = L.candidateList({
        rows: ['- a.js', '- b.js', '- c.js'], symbol: 'X', population: L.exactly(9),
      });
      return L.renderPacketLines([b]);
    });
    const truncated = out.split('\n').slice(0, 2).join('\n');
    if (strict) {
      expect(() => L.sealPacketOutput(truncated, scope)).toThrow(/PACKET SEAL/);
    } else {
      expect(L.sealPacketOutput(truncated, scope)).toContain(L.SEAL_CAVEAT);
    }
  });

  it('★★★ D: a REAL skeletonized bounded list survives the seal', async () => {
    // ⚠ The transform AND the final seal in one test. The previous version called the clamp
    // and stopped, so it could not see that skeletonization rewrites rows and therefore was
    // refused as unowned — a healthy packet accused by its own budget clamp.
    const rows = Array.from({ length: 20 }, (_, i) => `dir/file${i}.js`);
    const { out, scope } = await L.withSealScope(async () => {
      const entries = L.clampOccurrences([L.boundedListAll('READ FIRST', rows)], 19, null);
      return L.renderPacketLines(entries);
    });
    expect(out, 'the clamp must actually have fired at this budget').not.toContain('dir/file19.js');
    expect(L.sealPacketOutput(out, scope), 'a legitimately clamped list must NOT be accused')
      .toBe(out);
  });
});

// ── round 9: graph-senior-dev's two remaining blockers ───────────────────────────────────
//
// ⛔ BLOCKER 1 IS THE RECURRING SHAPE, NOW INSIDE THE CONSTRUCTOR PAIR I JUST BUILT.
// requirePopulationCoversShown was called by candidateList and NOT by symbolList, so the
// repair I published — "a total may not be smaller than the rows it covers" — was true for
// candidates and false for DEFINED IN / ALSO IN. One branch, general claim, for the fourth
// time in this thread. The fix is not a second call site; it is a shared path that a sibling
// CANNOT be added around, and this table is driven so that a future kind is covered by
// construction rather than by my remembering.
//
// ⛔ BLOCKER 2 is B3 one layer in. The tagged population froze the object and then ALIASED the
// caller's rowsSeen array: exactness travels with the value, its evidence did not. A caller
// could mutate the array afterwards and change the rendered bytes while Object.isFrozen(p)
// was true — and ['60','50'] rendered "grouped from 60 of 50 matching rows", which is not a
// disclosure but a contradiction.
describe('round 9 — population coverage and floor evidence', () => {
  for (const kind of ['CANDIDATES', 'DEFINED IN', 'ALSO IN']) {
    it(`★★★ B1: an impossible total is refused for ${kind}`, () => {
      const build = () => (kind === 'CANDIDATES'
        ? L.candidateList({ rows: ['- a.js'], symbol: 'X', population: L.exactly(0) })
        : L.symbolList(kind, ['- a.js'], { symbol: 'X', population: L.exactly(0) }));
      expect(build, `${kind} must not claim a population smaller than its rows`)
        .toThrow(/PACKET SEAL/);
    });
  }

  it('★★★ B2: impossible floor evidence is refused', () => {
    // "grouped from 60 of 50" — more rows seen than existed.
    expect(() => L.atLeast(1, { rowsSeen: ['60', '50'] })).toThrow(/rows|evidence|seen/i);
    expect(() => L.atLeast(1, { rowsSeen: ['1'] })).toThrow(/rows|evidence|two/i);
    expect(() => L.atLeast(1, { rowsSeen: ['-1', '50'] })).toThrow(/rows|evidence|integer/i);
    expect(() => L.atLeast(1, { rowsSeen: ['x', '50'] })).toThrow(/rows|evidence|integer/i);
    // The legitimate shape still works, and packet.js passes regex captures, i.e. strings.
    expect(() => L.atLeast(9, { rowsSeen: ['50', '60'] })).not.toThrow();
  });

  it('★★★ B2: mutating the caller\'s array after atLeast cannot change the rendered bytes', () => {
    const rowsSeen = ['1', '2'];
    const p = L.atLeast(1, { rowsSeen });
    const before = L.renderOccurrenceForTest(
      L.candidateList({ rows: ['- a.js'], symbol: 'X', population: p }),
    );
    rowsSeen.splice(0, 2, '60', '50');
    const after = L.renderOccurrenceForTest(
      L.candidateList({ rows: ['- a.js'], symbol: 'X', population: p }),
    );
    expect(after, 'the evidence must be copied, not aliased').toBe(before);
    expect(after, 'and must not carry the contradiction').not.toMatch(/from 60 of 50/);
  });
});
