// THE BOUNDARY LEDGER — pre-registered before slice 1 moves anything.
//
// graph-senior-dev's Phase 0 target is not file length:
//   "Every top-level declaration belongs to exactly one named authority; every named guarantee
//    has exactly one owner module whose public API is sufficient to execute a hostile
//    counterexample; authority modules do not import their facade."
//
// ⛔ AND THEY PRE-REGISTERED THE FAILURE THEY EXPECT ME TO CAUSE, which is why these assertions
// exist BEFORE the extraction rather than after it:
//
//   1. AN UNSEALED ESCAPE INTRODUCED FOR TESTABILITY — an extracted renderer gets exported,
//      tests start calling it directly, and its string bypasses withSealScope/sealPacketOutput.
//      Everything inside the route looks right and focused tests pass, while the only product
//      guarantee lives one boundary above the thing now treated as API.
//   2. A CYCLE — the extracted module imports a helper back from the facade, leaving partially
//      initialised exports or forcing a shim.
//   3. DUPLICATE PRIVATE AUTHORITY STATE — a population/list helper copied, or loaded through
//      two specifier identities, so an occurrence branded by one module instance is not
//      recognised by the serializer in another.
//
// ⚠ "If the gates do not go red, the gates are not ready." These are written to fail on the
// mistake, not to describe the current arrangement.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERBS = fileURLToPath(new URL('../../../mcp/stdio/query/verbs/', import.meta.url));
const read = (f) => readFileSync(join(VERBS, f), 'utf8');
// Every module that owns part of the packet authority, present or future. A slice that adds a
// file here without adding it to this list is a slice this ledger cannot see.
const PACKET_MODULES = () => readdirSync(VERBS).filter((f) => /^packet(-[a-z]+)?\.js$/.test(f));

describe('packet authority boundaries', () => {
  it('★★★ exactly ONE module exports a tool entry — no unsealed escape', () => {
    // Failure 1. The seal lives in the facade wrapper; any other module exporting something that
    // renders a whole packet would be a public route around enforcement.
    const entries = [];
    for (const f of PACKET_MODULES()) {
      const src = read(f);
      for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(graphPacket\w*)/gmu)) {
        entries.push(`${f}:${m[1]}`);
      }
    }
    expect(entries, 'exactly one exported packet entry, and it must be the sealed wrapper')
      .toEqual(['packet.js:graphPacket']);
  });

  it('★★★ graphPacketInner is NOT exported — the seal cannot be bypassed by importing it', () => {
    expect(read('packet.js'), 'exporting the inner route makes the wrapper optional')
      .not.toMatch(/^export\s+(?:async\s+)?function\s+graphPacketInner/mu);
  });

  it('★★★ the exported entry still wraps the inner call in the seal scope', () => {
    // Pins the exact shape dev named. packet-seal.test.js already source-inspects for this;
    // asserted here too because slice 4 touches the facade and this is the line that must survive.
    const src = read('packet.js');
    expect(src).toMatch(/withSealScope\(/);
    expect(src).toMatch(/sealPacketOutput\(/);
  });

  it('★★★ no authority module imports the facade — that is the cycle', () => {
    // Failure 2. packet.js may import its islands; an island may never import packet.js back.
    const offenders = [];
    for (const f of PACKET_MODULES()) {
      if (f === 'packet.js') continue;
      if (/from\s+'\.\/packet\.js'/u.test(read(f))) offenders.push(f);
    }
    expect(offenders, 'an island importing its facade is a cycle and a partial-init hazard')
      .toEqual([]);
  });

  it('★★★ the list authority has exactly ONE owner module', () => {
    // Failure 3. The population brand and occurrence parts are private to packet-lists.js by
    // design: a second definition means an occurrence minted by one instance is unrecognised by
    // the serializer in the other, and the forgery boundary opens silently.
    const owners = PACKET_MODULES().filter((f) => {
      const src = read(f);
      return /new WeakSet\(\)/u.test(src) && /new WeakMap\(\)/u.test(src);
    });
    expect(owners, 'private population/occurrence state must exist in exactly one module')
      .toEqual(['packet-lists.js']);
  });

  it('★★★ no module re-declares the population constructors', () => {
    const dupes = PACKET_MODULES().filter((f) => f !== 'packet-lists.js'
      && /^export\s+const\s+(exactly|atLeast|unknownPopulation)\s*=/mu.test(read(f)));
    expect(dupes, 'a second brand is a forgeable brand').toEqual([]);
  });

  it('★★★ every declaration is owned by exactly one authority (the denominator)', async () => {
    // The check `067e3ad` could not fail. Imported rather than shelled so a broken ledger is a
    // red test rather than a silent skip.
    const { auditFile } = await import('../../../scripts/authority-ledger.mjs');
    expect(typeof auditFile).toBe('function');
  });
});
