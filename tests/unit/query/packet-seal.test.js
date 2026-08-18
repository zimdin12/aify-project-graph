// A READER-FACING LIST MAY ONLY LEAVE graph_packet IF THE GOVERNED EMITTER BUILT IT.
//
// ⛔ THIS GUARANTEE HAS BEEN WRONG THREE TIMES. Each version was defeated by
// graph-senior-dev-hermes EXECUTING a mutation rather than arguing about it, and each
// failure was the same mistake wearing a different size:
//
//   v1 — packet-route-inventory: grouped header emissions by TOP-LEVEL FUNCTION and
//        credited the function if renderCandidateDisclosures( appeared anywhere in it.
//        graphPacket is 396 lines and already calls it, so a new branch inside it inherited
//        credit. True of FUNCTIONS, false of ROUTES.
//   v2 — a module-global call counter compared either side of the packet. Defended with
//        "not worth AsyncLocalStorage until a parallel caller exists"; the parallel caller
//        was the shipped server (rl.on('line', async …) with no queue). Two pipelined
//        tools/call requests interleave and one packet borrows the other's count.
//   v3 — a per-request call count. Still only EXISTENTIAL: it proves *some* render
//        happened, not that it belongs to the list that left. Their probe rendered
//        {symbol:'Unrelated'} and returned a bare list. A dummy call launders the route.
//
// ★ Every version asked "was the renderer consulted?" — a question about ACTIVITY. The
// question that matters is "who built this text?", a question about PROVENANCE. v4 asks
// that: the governed emitter registers the exact block it produces, and the seal requires
// every list-shaped block in the output to be one of them. A dummy call launders nothing
// because a call is no longer the credential.
//
// ★★ AND THE HEADER VOCABULARY IS GONE. v3 matched /DEFINED IN|CANDIDATES/ — a list of
// words I happened to remember. Dev found packet.js ALREADY emits `ALSO IN:` and that
// probes for `MATCHES:` and `LOCATIONS:` passed untouched. An enumeration missing a case is
// how this whole thread started, so v4 detects the SHAPE (a header line ending in ':'
// followed by '- ' rows) and has no vocabulary to be incomplete.
//
// ⚠ SCOPE: this enforces that nothing UNOWNED is emitted. It does not prove no
// disclosure-less route exists somewhere unexecuted — no runtime check can. The difference
// from v1 is that this one does not claim it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  graphPacket, sealPacketOutput, renderCandidateDisclosures, withSealScope,
  extractListBlocks, admitListBlock, SEAL_CAVEAT,
} from '../../../mcp/stdio/query/verbs/packet.js';

const SRC = join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js');
const strict = process.env.APG_PACKET_SEAL_STRICT === '1';  // whole suite, via vitest.config.js

async function sealed(fn) {
  const { out, admitted } = await withSealScope(fn);
  return () => sealPacketOutput(out, admitted);
}
async function expectRejected(fn, why) {
  const run = await sealed(fn);
  if (strict) expect(run, why).toThrow(/PACKET SEAL/);
  else expect(run(), why).toContain(SEAL_CAVEAT);
}
async function expectAccepted(fn, why) {
  const { out, admitted } = await withSealScope(fn);
  expect(sealPacketOutput(out, admitted), why).toBe(out);
}

describe('the packet seal admits only lists the governed emitter built', () => {
  it('★★★ dev\'s v3 killer: a DUMMY renderer call does not launder a hand-built list', async () => {
    // The exact shape of their probe — render something unrelated, return a bare list.
    // v3 passed this because it counted activity. Provenance does not care that a call
    // happened; it cares that this text was never produced by the emitter.
    await expectRejected(async () => {
      renderCandidateDisclosures({ shown: 1, total: 1, symbol: 'Unrelated', languages: ['js'] });
      return 'CANDIDATES:\n- src/hidden.cpp:1';
    }, 'a sibling renderer call must not admit an unrelated list');
  });

  it('★★★ dev\'s v2 killer: a concurrent packet cannot lend its admission', async () => {
    // A yields mid-flight exactly as an await inside graphPacketInner does; B does real
    // work meanwhile. The server has no queue, so this interleaving is the normal case.
    const tick = () => new Promise((r) => { setTimeout(r, 5); });
    const [bad, good] = await Promise.all([
      withSealScope(async () => { await tick(); return 'CANDIDATES:\n- src/hidden.cpp:1'; }),
      withSealScope(async () => {
        const t = await graphPacket({ repoRoot: process.cwd(), target: 'graphPacket', mode: 'orient' });
        await tick();
        return t;
      }),
    ]);
    expect(bad.admitted.size, 'the hand-built packet must own nothing').toBe(0);
    if (strict) expect(() => sealPacketOutput(bad.out, bad.admitted)).toThrow(/PACKET SEAL/);
    else expect(sealPacketOutput(bad.out, bad.admitted)).toContain(SEAL_CAVEAT);
    // ⚠ THE HALF THAT CAUGHT MY OWN BUG. The first scoping fix nested scopes, so a real
    // graphPacket inside an enclosing scope had its admissions collected by the INNER store
    // and the outer seal accused its own healthy output. A false accusation lands on a
    // working answer and trains readers to ignore the line.
    expect(sealPacketOutput(good.out, good.admitted), 'healthy concurrent packet must not be accused')
      .toBe(good.out);
  }, 60000);

  it('★★★ dev\'s v3 vocabulary finding: an INVENTED header is still a list', async () => {
    // ALSO IN is real production output packet.js already emits; MATCHES and LOCATIONS were
    // their probes; the last two are mine. None of them can be in an allowlist I wrote,
    // which is the point — the detector has no vocabulary to be missing a word from.
    for (const header of ['ALSO IN', 'MATCHES', 'LOCATIONS', 'FOUND IN', 'SOMETHING NEW']) {
      // eslint-disable-next-line no-await-in-loop
      await expectRejected(async () => `${header}:\n- src/hidden.cpp:1`,
        `an unowned "${header}:" list must not pass`);
    }
  });

  it('★★★ a list the governed emitter built IS admitted', async () => {
    // The negative half. Without it the seal could be satisfied by refusing everything,
    // which would caveat every healthy packet — the failure mode of over-correcting.
    await expectAccepted(async () => admitListBlock('DEFINED IN:\n- src/a.cpp — function @ line 3'),
      'an emitter-built list must pass untouched');
  });

  it('★★ a truncated copy of an admitted list still passes', async () => {
    // clampToBudget drops trailing rows AFTER admission, so exact-match alone would accuse
    // a packet for being shortened by its own budget clamp.
    await expectAccepted(async () => {
      const full = 'DEFINED IN:\n- a.cpp\n- b.cpp\n- c.cpp';
      admitListBlock(full);
      return 'DEFINED IN:\n- a.cpp\n- b.cpp';
    }, 'a budget-clamped list is still the emitter\'s list');
  });

  it('★★ prose and non-list sections are not accused', async () => {
    await expectAccepted(async () => 'READ FIRST: nothing here is a list\nplain prose line',
      'a packet with no list-shaped block must pass');
  });

  it('★★ UNRANKED disclosure lines are not lists', async () => {
    // "⚠ UNRANKED, showing 3 of 12" IS the population statement. Treating it as a list
    // would fire the seal on the very text that satisfies it.
    await expectAccepted(async () => '  ⚠ UNRANKED, showing 3 of 12 — order is arrival, not relevance.',
      'a disclosure line is not a list');
  });

  it('★★ the block detector finds what it claims to (liveness)', () => {
    // Every rejection above depends on extractListBlocks seeing the block. If it silently
    // stopped matching, all of them would pass vacuously — a green from a blind detector.
    expect(extractListBlocks('CANDIDATES:\n- a\n- b')).toEqual(['CANDIDATES:\n- a\n- b']);
    expect(extractListBlocks('X:\n- a\n\nY:\n- b')).toHaveLength(2);
    expect(extractListBlocks('no lists here'), 'must not invent blocks').toEqual([]);
  });

  it('★★★ the seal is actually WIRED into the exported entry point', async () => {
    // ⚠ The one structural assertion, and nothing behavioural replaces it: delete the
    // sealPacketOutput() call from graphPacket and every test above still passes — they
    // exercise the seal directly — while the strict suite stays green, because a door that
    // is never called never complains.
    const src = readFileSync(SRC, 'utf8');
    const wrapper = /export async function graphPacket\(([\s\S]*?)\n}/.exec(src);
    expect(wrapper, 'exported graphPacket wrapper not found').not.toBeNull();
    expect(wrapper[1], 'graphPacket must return through sealPacketOutput').toMatch(/sealPacketOutput\(/);
    expect(wrapper[1], 'and must run the inner implementation inside a seal scope').toMatch(/withSealScope\(/);

    const out = await graphPacket({ repoRoot: process.cwd(), target: 'graphPacket', mode: 'orient' });
    expect(typeof out).toBe('string');
    expect(out, 'a real packet must not be accused').not.toContain('[packet seal]');
  }, 60000);

  it('★★★ no route pushes a header and its rows as separate statements', () => {
    // ⚠ THE GAP A RUNTIME SEAL CANNOT COVER, and it was not hypothetical. `LAST TOUCHED:`
    // and `CO-CONSUMER FILES:` were built header-then-rows on the live-enrichment path,
    // which NO TEST EXERCISES (it needs live=true). The suite was fully green with the seal
    // armed while a real graph_packet(live=true) call would have had a POPULATION NOT
    // DISCLOSED caveat stapled to a perfectly healthy packet.
    //
    // ★ A false accusation on working output is the failure direction I claimed to care
    // about, and "the suite is green" said nothing about it — the seal only sees routes that
    // run. So this arm is static ON PURPOSE: it reads every route, including the ones no
    // fixture reaches. It is the same move that found the fourth disclosure route, turned on
    // my own mechanism.
    const src = readFileSync(SRC, 'utf8').split('\n');
    const headerPush = /lines\.push\(\s*[`'"]([^`'"]*:)\s*[`'"]\s*\)/;
    const rowPush = /lines\.push\(\s*[`'"]- /;
    const offenders = [];
    src.forEach((line, i) => {
      const m = headerPush.exec(line);
      if (!m) return;
      // Rows may follow directly or inside a loop a couple of lines down.
      const window = src.slice(i + 1, i + 6).join(' ');
      if (rowPush.test(window)) offenders.push(`${i + 1}: ${m[1]}`);
    });
    expect(offenders, 'build these with emitGovernedList() — a hand-assembled list is unowned '
      + 'and the seal will caveat it in production even though the content is fine').toEqual([]);
  });

  it('★ non-string output passes through untouched', () => {
    expect(sealPacketOutput(null, new Set())).toBeNull();
    expect(sealPacketOutput({ a: 1 }, new Set())).toEqual({ a: 1 });
  });
});
