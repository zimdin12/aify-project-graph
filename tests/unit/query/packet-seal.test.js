// NO CANDIDATE LIST LEAVES graph_packet WITHOUT THE SHARED DISCLOSURE RENDERER HAVING RUN.
//
// ⛔ THIS FILE EXISTS BECAUSE THE PREVIOUS GUARANTEE WAS FALSE AND A REVIEWER PROVED IT.
// packet-route-inventory.test.js claimed "NO route shows a symbol list without reaching
// renderCandidateDisclosures()". graph-senior-dev-hermes inserted, inside graphPacket:
//
//     if (mode === '__inventory_probe__') return 'CANDIDATES:\n- src/hidden.cpp:1';
//
// — a real reader-facing route returning a candidate list that never touches the renderer.
// The inventory's route arm returned PASS. Reproduced here before writing any of this: the
// arm passed on the mutant, exactly as reported.
//
// ★ The cause is structural. That test groups header emissions by TOP-LEVEL FUNCTION and
// credits the function if `renderCandidateDisclosures(` appears anywhere within it.
// graphPacket is 396 lines and already contains a renderer call, so every branch added to
// it inherits credit. The claim was true of FUNCTIONS and false of ROUTES — which is the
// same distinction the fourth route taught me, applied one level down and missed again.
//
// ⇒ Attributing a header to the code path that produced it is dataflow, not pattern
// matching, so no source scan can carry this. The guarantee moved to the one boundary every
// route returns through. The seal compares the renderer's call count either side of the
// call: a route that emitted a list without consulting it is caught because it never ran,
// whichever branch produced it.
//
// ⚠ SCOPE, stated because trusting a check past its scope is how this whole thread started:
// this enforces that nothing is EMITTED unchecked. It does not prove no disclosure-less
// route exists somewhere unexecuted — no runtime check can, and the inventory that claimed
// to prove that could not either. The difference is that this one does not claim it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  graphPacket, sealPacketOutput, renderCandidateDisclosures, _disclosureRenderCount, SEAL_CAVEAT,
} from '../../../mcp/stdio/query/verbs/packet.js';

const SRC = join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js');

// The suite runs with APG_PACKET_SEAL_STRICT=1 (vitest.config.js), so violations throw.
const strict = process.env.APG_PACKET_SEAL_STRICT === '1';

describe('the packet seal catches a list emitted without disclosures', () => {
  it('★★★ dev\'s exact fifth-route payload is caught', () => {
    // Byte-for-byte the string their probe returned. `before` is captured with no renderer
    // call in between, which is precisely the state that branch leaves behind.
    const payload = 'CANDIDATES:\n- src/hidden.cpp:1';
    const before = _disclosureRenderCount();
    if (strict) {
      expect(() => sealPacketOutput(payload, before)).toThrow(/PACKET SEAL/);
    } else {
      expect(sealPacketOutput(payload, before)).toContain(SEAL_CAVEAT);
    }
  });

  it('★★★ a DEFINED IN list is held to the same rule', () => {
    // The other list header. A seal that only knew the one word from the reported mutation
    // would be fitting the report rather than the defect.
    const before = _disclosureRenderCount();
    const payload = 'DEFINED IN:\n- src/a.cpp — function @ line 3';
    if (strict) expect(() => sealPacketOutput(payload, before)).toThrow(/PACKET SEAL/);
    else expect(sealPacketOutput(payload, before)).toContain(SEAL_CAVEAT);
  });

  it('★★★ a list IS allowed through once the renderer has actually run', () => {
    // The negative half. Without it the seal could be satisfied by refusing everything,
    // which would caveat every healthy packet and teach readers to ignore the line.
    const before = _disclosureRenderCount();
    renderCandidateDisclosures({ shown: 3, total: 3, symbol: 'Foo', languages: ['cpp'] });
    const payload = 'CANDIDATES — showing 3 of 3:\n- src/a.cpp';
    expect(sealPacketOutput(payload, before)).toBe(payload);
  });

  it('★★ the renderer counts even when it legitimately emits NOTHING', () => {
    // One language, nothing omitted -> the renderer correctly returns []. That must still
    // count as consulted, or every ordinary single-language packet would be accused. This
    // is why the seal counts CALLS and not output markers: there is no marker to look for.
    const before = _disclosureRenderCount();
    const lines = renderCandidateDisclosures({ shown: 2, total: 2, symbol: 'Bar', languages: ['cpp'] });
    expect(lines, 'fixture assumes the silent case — if this emits, the test proves less').toEqual([]);
    expect(sealPacketOutput('CANDIDATES:\n- src/b.cpp', before)).toBe('CANDIDATES:\n- src/b.cpp');
  });

  it('★★ prose that merely mentions a header is not a list', () => {
    // Anchored to start-of-line. A packet that discusses candidates in a sentence must not
    // be accused — a false accusation on a healthy answer is how a warning gets ignored.
    const before = _disclosureRenderCount();
    const prose = 'READ FIRST:\n- the CANDIDATES section is omitted for feature packets';
    expect(sealPacketOutput(prose, before)).toBe(prose);
  });

  it('★★ UNRANKED lines are disclosures, not lists, and do not trip the seal', () => {
    // "⚠ UNRANKED, showing 3 of 12" IS the population statement. Treating it as a list
    // header would make the seal fire on the very text that satisfies it.
    const before = _disclosureRenderCount();
    const t = '  ⚠ UNRANKED, showing 3 of 12 — order is arrival, not relevance.';
    expect(sealPacketOutput(t, before)).toBe(t);
  });

  it('★★★ the seal is actually WIRED into the exported entry point', async () => {
    // ⚠ The one structural assertion in this file, and it is here because nothing
    // behavioural can replace it: if someone deletes the sealPacketOutput() call from
    // graphPacket, every test above still passes — they exercise the seal directly — and
    // the strict suite stays green, because a door that is never called never complains.
    // That is the dead-instrument shape this repo keeps finding, so it gets an explicit
    // guard rather than an assumption.
    const src = readFileSync(SRC, 'utf8');
    const wrapper = /export async function graphPacket\(([\s\S]*?)\n}/.exec(src);
    expect(wrapper, 'exported graphPacket wrapper not found').not.toBeNull();
    expect(wrapper[1], 'graphPacket must return through sealPacketOutput')
      .toMatch(/sealPacketOutput\(/);
    expect(wrapper[1], 'and must call the inner implementation it seals')
      .toMatch(/graphPacketInner\(/);

    // Behavioural half: the real entry point runs, and a genuine packet comes back
    // unsealed — proving the door is passable, not merely present.
    const out = await graphPacket({ repoRoot: process.cwd(), target: 'graphPacket', mode: 'orient' });
    expect(typeof out).toBe('string');
    expect(out, 'a real packet must not be accused').not.toContain('[packet seal]');
  }, 60000);

  it('★ non-string output passes through untouched', () => {
    const before = _disclosureRenderCount();
    expect(sealPacketOutput(null, before)).toBeNull();
    expect(sealPacketOutput({ a: 1 }, before)).toEqual({ a: 1 });
  });
});
