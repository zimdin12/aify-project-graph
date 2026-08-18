// THE SIX PROBES graph-senior-dev EXECUTED AGAINST 88b9535, AS REGRESSIONS.
//
// ⛔ Every one of these was a GREEN FALSE PASS under APG_PACKET_SEAL_STRICT=1 on 88b9535.
// They are written here first, confirmed RED against the old implementation, and only then
// fixed — so the file records a falsification rather than a claim.
//
// The claim they falsified: "no reader-facing list of symbols can leave graph_packet without
// the population statement that belongs to it." It failed six ways, and two of them are the
// same mistake I had already written down elsewhere:
//
//   · `serialized > 0` licensed the ENTIRE final text — existential credit, the exact
//     reasoning five earlier versions were built to remove, rebuilt in the backstop.
//   · "consumes each exactly once" was in my commit message and was false: a counter, no
//     identity tracking. My own test used mk(), mk() so it could not fail.
//   · population was an integer plus a boolean DEFAULTING TO EXACT, while a comment two files
//     away says "the exactness must travel WITH the value".
import { describe, it, expect } from 'vitest';
import * as L from '../../../mcp/stdio/query/verbs/packet-lists.js';

const strict = process.env.APG_PACKET_SEAL_STRICT === '1';

async function seal(fn) {
  const { out, scope } = await L.withSealScope(fn);
  return () => L.sealPacketOutput(out, scope);
}
async function expectRefused(fn, why) {
  const run = await seal(fn);
  if (strict) expect(run, why).toThrow(/PACKET SEAL/);
  else expect(run(), why).toContain(L.SEAL_CAVEAT);
}

describe('list occurrences — the six executed false passes', () => {
  it('★★★ B1: one legitimate serialization must NOT license a later raw list', async () => {
    // Render something real, then append a hand-built candidate list. On 88b9535 the seal saw
    // scope.serialized === 1 and accepted the whole text, both blocks. Existential credit.
    await expectRefused(async () => {
      const legit = L.renderPacketLines([L.boundedListAll('READ FIRST', ['anchor.js'])]);
      return `${legit}\nCANDIDATES:\n- hidden.js`;
    }, 'an appended list must not inherit an earlier serialization');
  });

  it('★★★ B2a: a bounded formatter must not smuggle a nested list', async () => {
    // The formatter's return value was trusted verbatim and ListBlock flattened embedded
    // newlines, so one owned container carried a second, unowned, reader-facing list.
    expect(() => L.boundedListAll('READ FIRST', ['anchor'], () => 'anchor.js\nCANDIDATES:\n- hidden.js'))
      .toThrow(/PACKET SEAL|single line|newline/i);
  });

  it('★★★ B2b: a candidate row must not smuggle a nested list', async () => {
    // Rendered "showing 1 of 1" above TWO symbol rows across two blocks.
    expect(() => L.candidateList({
      rows: ['- visible.js\nCANDIDATES:\n- hidden.js'],
      symbol: 'Visible',
      population: L.exactly(1),
    })).toThrow(/PACKET SEAL|single line|newline/i);
  });

  it('★★★ B3: an occurrence must be immutable after its population is derived', () => {
    const b = L.candidateList({ rows: ['- a.js'], symbol: 'X', population: L.exactly(1) });
    // Mutating the header removed the population statement entirely on 88b9535.
    expect(() => { b.header = 'CANDIDATES:'; }).toThrow();
    // Pushing a row made "showing 1 of 1" sit above two rows.
    expect(() => { b.rows.push('- b.js'); }).toThrow();
    // And the constructor must not alias the caller's array — mutating the source afterwards
    // is the same defect with an extra step.
    const rows = ['- a.js'];
    const c = L.candidateList({ rows, symbol: 'X', population: L.exactly(1) });
    rows.push('- b.js');
    expect(L.renderOccurrenceForTest(c), 'the occurrence must not follow the caller\'s array')
      .not.toContain('- b.js');
  });

  it('★★★ B4: the SAME occurrence identity cannot be serialized twice', async () => {
    // "Consumes each exactly once" was false: a counter, not identity tracking. Note the
    // fixture reuses ONE object — the old test built two, which is why it never failed.
    const b = L.candidateList({ rows: ['- a.js'], symbol: 'X', population: L.exactly(1) });
    // ⚠ Refused at SERIALIZATION, not at the seal — earlier than I first asserted. Recording
    // the correction rather than relaxing the assertion: the identity is consumed the moment
    // it is emitted, so the second emission cannot be a legitimate one and there is no reason
    // to let it reach the output before saying so.
    await L.withSealScope(async () => {
      if (strict) expect(() => L.renderPacketLines([b, b])).toThrow(/serialized twice/);
      else expect(L.renderPacketLines([b, b])).toContain(L.SEAL_CAVEAT);
      return '';
    });
    // And the same occurrence in two SEPARATE scopes is fine — consumption is per packet.
    const one = await L.withSealScope(async () => L.renderPacketLines([b]));
    const two = await L.withSealScope(async () => L.renderPacketLines([b]));
    expect(one.out, 'a fresh packet may serialize it again').toBe(two.out);
  });

  it('★★★ B5: a floor cannot be rendered as an exact total', () => {
    // Population is now a TAGGED VALUE. There is no integer-plus-default-false-boolean form
    // in which a floor can be passed and silently rendered exact.
    const floor = L.renderOccurrenceForTest(L.candidateList({
      rows: ['- a.js'], symbol: 'X', population: L.atLeast(50, { rowsSeen: ['50', '60'] }),
    }));
    expect(floor).toMatch(/AT LEAST 50/);
    expect(floor, 'a floor must never render as an exact total').not.toMatch(/showing 1 of 50:/);
    // And an unknown population must say so rather than defaulting to anything.
    expect(L.renderOccurrenceForTest(L.candidateList({
      rows: ['- a.js'], symbol: 'X', population: L.unknownPopulation(),
    }))).toMatch(/UNKNOWN/);
    // A bare integer is not a population — the shape that allowed the defect is rejected.
    expect(() => L.candidateList({ rows: ['- a.js'], symbol: 'X', population: 50 }))
      .toThrow(/population/i);
  });

  it('★★★ B6: DEFINED IN and ALSO IN carry a population, they are not bounded', () => {
    // Confirmed twice from two directions: from the output by a first-time reader, and from
    // the design side by me. A symbol list that states no population is read as one anyway.
    expect(L.BOUNDED_KINDS.has('DEFINED IN'), 'DEFINED IN must not be a bounded kind').toBe(false);
    expect(L.BOUNDED_KINDS.has('ALSO IN'), 'ALSO IN must not be a bounded kind').toBe(false);
    const t = L.renderOccurrenceForTest(L.symbolList('DEFINED IN', ['- a.cpp'], {
      symbol: 'Foo', population: L.exactly(1),
    }));
    expect(t, 'a symbol list must state its population').toMatch(/1 of 1|showing 1/);
  });

  it('★★ the reconciliation is one-to-one, not merely non-empty', async () => {
    // The positive half of B1/B4: two genuinely distinct occurrences both serialize fine.
    const { out, scope } = await L.withSealScope(async () => L.renderPacketLines([
      L.candidateList({ rows: ['- a.js'], symbol: 'X', population: L.exactly(1) }),
      L.boundedListAll('READ FIRST', ['anchor.js']),
    ]));
    expect(L.sealPacketOutput(out, scope), 'genuine occurrences must not be refused').toBe(out);
  });
});
