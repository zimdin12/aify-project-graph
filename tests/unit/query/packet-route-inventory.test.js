// EVERY ROUTE THAT SHOWS A READER A SYMBOL LIST MUST REACH THE SHARED DISCLOSURE RENDERER.
//
// ⛔ WHY THIS FILE EXISTS. graph_packet had the same cap-as-total defect fixed in three separate
// branches on 2026-08-12, and then graph-senior-dev-hermes found a FOURTH — the object-form
// symbol-pointer branch, which consumed the population but never called
// renderCandidateDisclosures(), so it emitted no cross-language finding and no floor caveat.
//
// ★ I had claimed "one renderer, consumed by every branch". I had enumerated three. Branch
// PARITY cannot catch that by construction: parity compares the routes you already named. Only
// an inventory catches the route you forgot — and after the fourth, "a fifth might exist" was
// not a claim I could leave standing on memory.
//
// ⇒ So the enumeration is executable rather than remembered. This walks packet.js, finds every
// top-level function that puts a symbol/candidate list in front of a reader, and requires it to
// reach the renderer. A new branch added without disclosures fails HERE, at the point of being
// written, instead of in the field N rounds later.
//
// ⚠ Deliberately structural, not behavioural: it asserts the WIRING exists. It cannot tell you
// the disclosures are correct — the fixtures in packet-population-fail-closed.test.js do that.
// Stating the scope because a check that does not publish its own scope gets trusted past it.
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

// A reader-facing symbol list is announced by one of these headers. Comments do not count —
// this file is full of prose about the headers.
const HEADER = /(DEFINED IN|CANDIDATES|UNRANKED)/;
const isCode = (l) => !/^\s*(\/\/|\*)/.test(l);

describe('every packet route that lists symbols reaches the shared disclosure renderer', () => {
  const emitters = fns.map((_, i) => ({ name: fns[i].name, body: bodyOf(i) }))
    .filter((f) => f.body.some((l) => isCode(l) && HEADER.test(l)));

  it('★★ the inventory is non-empty and finds the known routes (liveness)', () => {
    // Without this the suite below passes vacuously if the header regex ever stops matching —
    // a green result from a detector that found nothing to check.
    expect(emitters.length, 'no symbol-list emitters found — the detector is dead').toBeGreaterThan(0);
    const names = emitters.map((e) => e.name);
    expect(names, 'the two known list-emitting routes must be in the inventory')
      .toEqual(expect.arrayContaining(['buildSymbolPointerPacket', 'graphPacket']));
  });

  it('★★★ NO route shows a symbol list without reaching renderCandidateDisclosures()', () => {
    const offenders = emitters
      .filter((f) => !f.body.some((l) => isCode(l) && /renderCandidateDisclosures\(/.test(l)))
      .map((f) => f.name);
    // Hand-written expectation: the empty set. If a new branch appears without disclosures it
    // is named here by construction, which is the whole point — the fourth route was invisible
    // precisely because nothing enumerated.
    expect(offenders, 'these routes list symbols but emit no population/duplicate/floor disclosures')
      .toEqual([]);
  });
});
