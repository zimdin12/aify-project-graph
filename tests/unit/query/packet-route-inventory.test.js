// EVERY FUNCTION THAT SHOWS A READER A SYMBOL LIST MENTIONS THE SHARED DISCLOSURE RENDERER.
//
// ⚠ READ THE TITLE AGAIN — IT SAYS *FUNCTION*, AND IT USED TO SAY *ROUTE*. THAT WAS FALSE.
//
// ⛔ This file previously claimed "NO route shows a symbol list without reaching
// renderCandidateDisclosures()". review, hermes session falsified it by executing a
// mutation: inside graphPacket,
//
//     if (mode === '__inventory_probe__') return 'CANDIDATES:\n- src/hidden.cpp:1';
//
// a real reader-facing route returning a candidate list that never touches the renderer.
// The route arm below returned PASS. I reproduced it before changing anything: it passes.
//
// ★ The cause is structural and not fixable here. This groups header emissions by TOP-LEVEL
// FUNCTION and credits the function if the renderer appears anywhere inside it. graphPacket
// is 396 lines and already calls the renderer, so any branch added to it inherits credit it
// did not earn. Attributing a header to the code path that produced it is DATAFLOW; regex
// over source cannot do it, and a test that claims otherwise is worse than no test because
// it retires a doubt it has not earned. That is exactly what it did: I wrote "a fifth might
// exist" was resting on memory, and replaced it with something resting on a false premise.
//
// ⇒ THE ROUTE-LEVEL GUARANTEE LIVES IN packet-lists.js AND ITS TESTS, not here.
//
// ⚠ THIS PARAGRAPH USED TO DESCRIBE A CALL-COUNT SEAL — "compares the renderer's call count
// either side of the call" — which was several architectures ago and was itself falsified
// twice. the reviewer flagged the stale text as non-blocking, on the grounds that an
// explanation nobody has re-read becomes an authority the next reviewer cites. They were
// right; a comment that is wrong about the mechanism is worse than none, because it is
// believed.
//
// The actual mechanism: a list is a TYPED OCCURRENCE built by candidateList() / symbolList() /
// boundedList(); renderPacketLines() is the only place one becomes text and consumes each
// identity exactly once; the budget clamp transforms occurrences BEFORE serialization; and the
// final text is reconciled ONE-TO-ONE against what was emitted. The whole suite runs with
// APG_PACKET_SEAL_STRICT=1, so a violation fails hard rather than appending a caveat.
//
// ⇒ WHAT THIS FILE IS STILL WORTH: it is a cheap structural smoke test. A brand-new
// top-level function that lists symbols and never mentions the renderer at all is caught
// here at authoring time, before anyone has to execute it. That is a real but SMALL claim,
// and the ★ OPEN OBLIGATION it leaves is explicit: this cannot see a disclosure-less branch
// added inside a function that already calls the renderer. Do not read a green here as
// coverage of that case.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js');
const lines = readFileSync(SRC, 'utf8').split('\n');

const declRe = /^(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)/;
const fns = [];
lines.forEach((l, i) => { const m = l.match(declRe); if (m) fns.push({ name: m[1], line: i }); });

function bodyOf(idx) {
  const start = fns[idx].line;
  let depth = 0; let seen = false;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) { if (ch === '{') { depth += 1; seen = true; } else if (ch === '}') depth -= 1; }
    if (seen && depth === 0) return lines.slice(start, i + 1);
  }
  return lines.slice(start);
}

const HEADER = /(DEFINED IN|CANDIDATES|UNRANKED)/;
const isCode = (l) => !/^\s*(\/\/|\*)/.test(l);

describe('packet.js: no symbol-listing FUNCTION omits the renderer entirely', () => {
  const emitters = fns.map((_, i) => ({ name: fns[i].name, body: bodyOf(i) }))
    .filter((f) => f.body.some((l) => isCode(l) && HEADER.test(l)));

  it('★★ the inventory is non-empty and finds the known emitters (liveness)', () => {
    // Without this the assertion below passes vacuously the moment the header regex or the
    // declaration regex stops matching — a green from a detector that found nothing.
    // ⚠ graphPacket is now graphPacketInner: the exported graphPacket is the thin sealing
    // wrapper, and the body that emits lists is the inner one. A rename that silently
    // dropped a known emitter from this list is the failure this arm is here to make loud.
    expect(emitters.length, 'no symbol-list emitters found — the detector is dead').toBeGreaterThan(0);
    const names = emitters.map((e) => e.name);
    expect(names, 'the two known list-emitting functions must be in the inventory')
      .toEqual(expect.arrayContaining(['buildSymbolPointerPacket', 'graphPacketInner']));
  });

  it('★ no listing function builds a list outside the governed constructors (weak, by construction)', () => {
    // ⚠ THIS IS A FUNCTION-LEVEL CLAIM and it stays weak on purpose: it cannot discriminate
    // sibling branches inside a function that uses a constructor somewhere. That limit was
    // proven by execution — see the header — and the real guarantee is the runtime one.
    //
    // ⚠ WHAT IT CHECKS CHANGED, and not to make anything pass. It used to require a mention of
    // renderCandidateDisclosures, which was the right proxy when routes assembled their own
    // headers and called the renderer directly. Routes now hand population FACTS to
    // candidateList()/symbolList()/boundedList() and those call the renderer internally — so
    // the old proxy flagged graphPacketInner precisely because it had stopped hand-assembling,
    // which is the improvement. Checking for the constructors keeps the same intent pointed at
    // the shape the code actually has.
    const GOVERNED = /(candidateList|symbolList|boundedList|boundedListAll)\(/;
    const offenders = emitters
      .filter((f) => !f.body.some((l) => isCode(l) && GOVERNED.test(l)))
      .map((f) => f.name);
    expect(offenders, 'these functions list symbols without a governed list constructor')
      .toEqual([]);
  });
});
