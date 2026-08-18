// A READER-FACING LIST IS AN OBJECT UNTIL IT IS SERIALIZED, AND OWNERSHIP IS OBJECT IDENTITY.
//
// ⛔ FIVE EARLIER VERSIONS OF THIS GUARANTEE WERE WRONG. graph-senior-dev-hermes broke every
// one by EXECUTING a mutation on the exact carrier, never by argument. The disguises changed;
// the mistake did not:
//
//   v1 grouped by FUNCTION      — a new branch inside graphPacket inherited credit.
//   v2 counted renderer calls   — a concurrent packet lent its count (the server has no queue).
//   v3 counted per-request      — a DUMMY call with unrelated arguments laundered a bare list.
//   v4 registered TEXT          — the registrar was exported so any route minted a credential,
//                                 and the "vocabulary-free" detector carried an undocumented
//                                 80-char header bound that production output already crossed.
//   v5 hid the mint             — but the bounded emitter took a FREE-FORM LABEL, so a route
//                                 spelled 'CANDIDATES' through it with no population facts;
//                                 and greedy prefix receipts FALSELY ACCUSED valid provenance.
//
// ★ Every version tried to recover ownership from TEXT after the fact. Text has no author. I
// preregistered that if v5 fell the conclusion was architectural rather than another patch —
// it fell, and this is the architecture, chosen by dev's recommendation and my own rule.
//
// ⇒ v6: candidateList()/boundedList() return typed occurrences; renderPacketLines() is the
// only place one becomes text and consumes each exactly once. Identity cannot be forged,
// borrowed, spelled or prefix-matched. The list GRAMMAR is no longer an authority anywhere —
// it survives only to refuse raw strings, never to grant credit.
//
// ⚠ SCOPE: this enforces that nothing hand-assembled is serialized or returned. It does not
// prove no bad route exists unexecuted, and it never claimed to.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import * as L from '../../../mcp/stdio/query/verbs/packet-lists.js';

const SRC = join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js');
const strict = process.env.APG_PACKET_SEAL_STRICT === '1';  // whole suite, via vitest.config.js

async function expectRefused(fn, why) {
  const { out, scope } = await L.withSealScope(fn);
  if (strict) expect(() => L.sealPacketOutput(out, scope), why).toThrow(/PACKET SEAL/);
  else expect(L.sealPacketOutput(out, scope), why).toContain(L.SEAL_CAVEAT);
}
async function expectAccepted(fn, why) {
  const { out, scope } = await L.withSealScope(fn);
  expect(L.sealPacketOutput(out, scope), why).toBe(out);
}

describe('governed list emission', () => {
  it('★★★ dev v5 #1: the bounded surface CANNOT spell a candidate category', () => {
    // `emitBoundedList('CANDIDATES', […])` produced candidate-shaped output with no population
    // statement and strict graphPacket fulfilled. A free-form label IS a credential oracle: it
    // lets the caller pick which category its text is read as. The kind is now a closed set,
    // checked at construction, so the laundering route does not compile into an object at all.
    expect(() => L.boundedList('CANDIDATES', { items: ['x'], total: 1, truncated: false }))
      .toThrow(/not a bounded list kind/);
    expect(() => L.boundedListAll('MATCHES', ['x'])).toThrow(/not a bounded list kind/);
    // A legitimate bounded kind still works — the negative half.
    expect(L.boundedListAll('READ FIRST', ['a.cpp']).toText()).toMatch(/^READ FIRST:\n- a\.cpp$/);
  });

  it('★★★ dev v5 #2: two lists sharing a prefix are NOT falsely accused', async () => {
    // v5 consumed the first receipt whose text started with a clamped block, so with A and B
    // sharing a prefix a valid output order made the seal reject a genuinely owned block.
    // Object identity has no matching step to be greedy about — the machinery is gone.
    await expectAccepted(async () => {
      const A = L.candidateList({ rows: ['- same.cpp', '- A.cpp'], symbol: 'X', statedTotal: 2 });
      const B = L.candidateList({ rows: ['- same.cpp', '- B.cpp'], symbol: 'X', statedTotal: 2 });
      return L.renderPacketLines([B, A]);
    }, 'valid provenance must never be refused');
  });

  it('★★★ dev v3: a DUMMY renderer call launders nothing', async () => {
    await expectRefused(async () => {
      L.renderCandidateDisclosures({ shown: 1, total: 1, symbol: 'Unrelated', languages: ['js'] });
      return 'CANDIDATES:\n- src/hidden.cpp:1';
    }, 'a sibling renderer call must not authorise an unrelated list');
  });

  it('★★★ dev v4: an INVENTED header is still refused', async () => {
    // ALSO IN is real production output; MATCHES/LOCATIONS were dev's probes; the rest are
    // mine. The grammar has no vocabulary to be missing a word from — and grants nothing.
    for (const header of ['ALSO IN', 'MATCHES', 'LOCATIONS', 'FOUND IN', 'SOMETHING NEW']) {
      // eslint-disable-next-line no-await-in-loop
      await expectRefused(async () => `${header}:\n- src/hidden.cpp:1`, `"${header}:" must not pass`);
    }
  });

  it('★★★ dev v4 #2: a 145-character floor header is still seen', () => {
    // v4 bounded the header at 80 chars — a vocabulary of WORDS swapped for an undocumented
    // LENGTH, which this file's own output exceeds by 65 characters.
    const real = 'CANDIDATES — showing 5 of AT LEAST 50 (grouped from 50 of 60 matching rows'
      + ' — retrieval was capped BEFORE grouping, so the population is a FLOOR):';
    expect(real.length, 'fixture must exceed the old cap or it proves nothing').toBeGreaterThan(80);
    expect(L.extractListBlocks(`${real}\n- src/hidden.cpp:1`)).toHaveLength(1);
  });

  it('★★★ dev v2: a concurrent packet cannot lend its serialization', async () => {
    // A yields mid-flight as an await inside graphPacketInner does; B does real work meanwhile.
    // server.js has no queue, so this interleaving is the normal case, not a violation of the
    // skills' advice.
    const tick = () => new Promise((r) => { setTimeout(r, 5); });
    const [bad, good] = await Promise.all([
      L.withSealScope(async () => { await tick(); return 'CANDIDATES:\n- src/hidden.cpp:1'; }),
      L.withSealScope(async () => {
        const t = await graphPacket({ repoRoot: process.cwd(), target: 'graphPacket', mode: 'orient' });
        await tick();
        return t;
      }),
    ]);
    expect(bad.scope.serialized, 'the hand-built packet must have serialized nothing').toBe(0);
    if (strict) expect(() => L.sealPacketOutput(bad.out, bad.scope)).toThrow(/PACKET SEAL/);
    else expect(L.sealPacketOutput(bad.out, bad.scope)).toContain(L.SEAL_CAVEAT);
    // ⚠ The half that caught a bug of my own: nested scopes once collected the count inward,
    // so the outer check accused its own healthy output.
    expect(L.sealPacketOutput(good.out, good.scope), 'healthy concurrent packet must not be accused')
      .toBe(good.out);
  }, 60000);

  it('★★★ a hand-assembled list is refused AT SERIALIZATION, before any clamping', async () => {
    // The earlier design validated after clampToBudget, which rewrites bounded sections — so
    // any scheme that re-identified blocks in clamped text was always going to accuse a
    // healthy packet. Validating here removes the possibility rather than tuning it.
    const { scope } = await L.withSealScope(async () => {
      if (strict) {
        expect(() => L.renderPacketLines(['CANDIDATES:\n- src/hidden.cpp:1'])).toThrow(/PACKET SEAL/);
      } else {
        expect(L.renderPacketLines(['CANDIDATES:\n- x'])).toContain(L.SEAL_CAVEAT);
      }
      return '';
    });
    expect(scope.serialized, 'nothing legitimate was serialized').toBe(0);
  });

  it('★★★ a candidate list CANNOT exist without a population statement', () => {
    // v4's emitter took an omittable `disclosures` argument and dev simply left it off.
    // candidateList has no such argument: header AND disclosures derive from the population
    // facts, so even the unattested case says that it is unattested.
    expect(L.candidateList({ rows: ['- h.cpp'], symbol: 'X', statedTotal: undefined }).toText())
      .toMatch(/total population UNKNOWN/);
    const floor = L.candidateList({
      rows: ['- a.cpp'], symbol: 'X', statedTotal: 50, populationIsFloor: true, rowsSeen: [null, '50', '60'],
    }).toText();
    expect(floor).toMatch(/AT LEAST 50/);
    expect(floor).toMatch(/population is a FLOOR/);
  });

  it('★★ two identical lists are two occurrences', async () => {
    // v5 held admissions in a Set, so one receipt authorised unlimited copies. Objects have
    // no such collapse: each must be constructed and each is consumed once.
    await expectAccepted(async () => {
      const mk = () => L.candidateList({ rows: ['- same.cpp'], symbol: 'X', statedTotal: 1 });
      return L.renderPacketLines([mk(), mk()]);
    }, 'two genuinely built identical lists are both owned');
  });

  it('★★ prose and disclosure lines are not lists', async () => {
    await expectAccepted(async () => 'READ FIRST: nothing here is a list\nplain prose',
      'a packet with no list-shaped block must pass');
    await expectAccepted(async () => '  ⚠ UNRANKED, showing 3 of 12 — order is arrival, not relevance.',
      'a disclosure line is not a list');
  });

  it('★★ the shape detector finds what it claims to (liveness)', () => {
    // Every refusal above depends on this seeing the block. If it silently stopped matching,
    // they would all pass vacuously — a green from a blind detector.
    expect(L.extractListBlocks('CANDIDATES:\n- a\n- b')).toEqual(['CANDIDATES:\n- a\n- b']);
    expect(L.extractListBlocks('X:\n- a\n\nY:\n- b')).toHaveLength(2);
    expect(L.extractListBlocks('no lists here')).toEqual([]);
  });

  it('★★★ the seal is WIRED into the exported entry point', async () => {
    // ⚠ The one structural assertion, and nothing behavioural replaces it: remove the call
    // from graphPacket and every test above still passes, because a door never called never
    // complains.
    const src = readFileSync(SRC, 'utf8');
    const wrapper = /export async function graphPacket\(([\s\S]*?)\n}/.exec(src);
    expect(wrapper, 'exported graphPacket wrapper not found').not.toBeNull();
    expect(wrapper[1]).toMatch(/sealPacketOutput\(/);
    expect(wrapper[1]).toMatch(/withSealScope\(/);

    const out = await graphPacket({ repoRoot: process.cwd(), target: 'graphPacket', mode: 'orient' });
    expect(typeof out).toBe('string');
    expect(out, 'a real packet must not be accused').not.toContain('[packet seal]');
  }, 60000);

  it('★★★ no route pushes a header and its rows as separate statements', () => {
    // ⚠ Deliberately STATIC, and downgraded to a heuristic now that objects are the carrier —
    // dev is right that it must not become the replacement authority. It exists because the
    // runtime path only sees routes that RUN: `LAST TOUCHED:` and `CO-CONSUMER FILES:` were
    // hand-built on the live-enrichment path, which no test exercises, and the suite was fully
    // green while a real graph_packet(live=true) call would have been caveated.
    const src = readFileSync(SRC, 'utf8').split('\n');
    const headerPush = /lines\.push\(\s*[`'"]([^`'"]*:)\s*[`'"]\s*\)/;
    const rowPush = /lines\.push\(\s*[`'"]- /;
    const offenders = [];
    src.forEach((line, i) => {
      const m = headerPush.exec(line);
      if (m && rowPush.test(src.slice(i + 1, i + 6).join(' '))) offenders.push(`${i + 1}: ${m[1]}`);
    });
    expect(offenders, 'build these with candidateList()/boundedList()').toEqual([]);
  });

  it('★ non-string output passes through untouched', () => {
    expect(L.sealPacketOutput(null, { serialized: 0 })).toBeNull();
    expect(L.sealPacketOutput({ a: 1 }, { serialized: 0 })).toEqual({ a: 1 });
  });
});
