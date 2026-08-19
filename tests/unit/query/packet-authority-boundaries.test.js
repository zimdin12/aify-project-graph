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
import { auditAll } from '../../../scripts/authority-ledger.mjs';
import { moduleSpecifiers, exportedNames } from '../../../scripts/lib/module-graph.mjs';

const VERBS = fileURLToPath(new URL('../../../mcp/stdio/query/verbs/', import.meta.url));
const read = (f) => readFileSync(join(VERBS, f), 'utf8');
// Every module that owns part of the packet authority, present or future. A slice that adds a
// file here without adding it to this list is a slice this ledger cannot see.
const PACKET_MODULES = () => readdirSync(VERBS).filter((f) => /^packet(-[a-z]+)?\.js$/.test(f));

describe('packet authority boundaries', () => {
  it('★★★ exactly ONE module exports a tool entry, in ANY declaration form', () => {
    // ⛔ THIS GATE WAS DECLARATION-SPELLING BASED and dev walked through it: it matched only
    // `export function graphPacket…`, so `export const graphPacketEscape = …` and
    // `export { x as graphPacketEscape }` were invisible. Third time a gate of mine checked a
    // shape instead of the thing it claims to govern.
    // ⇒ AST export inventory, and EVERY graphPacket* name outside packet.js is forbidden.
    const entries = [];
    for (const f of PACKET_MODULES()) {
      for (const name of exportedNames(read(f), f)) {
        if (/^graphPacket/u.test(name)) entries.push(`${f}:${name}`);
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

  it('★★★ no authority module DEPENDS ON the facade, in any form — that is the cycle', () => {
    // ⛔ THIS GATE WAS QUOTE-SPECIFIC AND graph-senior-dev WALKED THROUGH IT. It matched
    // /from\s+'\.\/packet\.js'/ — single quotes only — so this equally real cycle passed all
    // seven boundary tests:
    //     import { resolvePopulation } from "./packet.js";
    // A gate on SYNTAX SPELLING is not a gate on module reachability, and one passing spelling
    // does not prove the edge class. Same defect as every other instrument here that checked a
    // shape instead of establishing the route.
    // ⇒ AST now, covering static import (either quote), `export … from`, `export * from`, and
    // dynamic import() — which violates "islands never depend on the facade" just as surely,
    // even though it is not an eager ESM cycle.
    const offenders = [];
    for (const f of PACKET_MODULES()) {
      if (f === 'packet.js') continue;
      for (const dep of moduleSpecifiers(read(f), f)) {
        if (/(^|\/)packet\.js$/u.test(dep.specifier)) {
          offenders.push(`${f}:${dep.line} ${dep.form} ${dep.specifier}`);
        }
      }
    }
    expect(offenders, 'an island depending on its facade is a cycle and a partial-init hazard')
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

  it('★★★ every declaration is owned by exactly one authority — ASSERTED, not printed', () => {
    // ⛔ THIS TEST USED TO ASSERT `typeof auditFile === 'function'`. dev added an unassigned
    // export; the audit printed 9/10 and ALL FILES COMPLETE: false, and this still passed 7/7.
    // Importing a script that PRINTS a failure is not an assertion — the check `067e3ad` could
    // not fail, reproduced inside the test written to stop `067e3ad` happening again.
    const result = auditAll();
    const broken = result.files.filter((f) => !f.complete).map((f) => ({
      file: f.file, unassigned: f.unassigned, duplicated: f.duplicated, phantom: f.phantom,
    }));
    expect(broken, 'a declaration owned by nobody, or by two authorities, breaks the denominator')
      .toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('★★★ island exports are an EXACT allowlist — a new export is a reviewed event', () => {
    // ⚠ dev's reachability finding: slice 1 exported all 31 declarations of the two islands,
    // "much broader than the facade needs, and the boundary gate does not inventory it." Not an
    // automatic tool entry, but a new API fact that arrived unreviewed. Pinned exactly, so
    // widening the surface has to be a deliberate edit here.
    // ⚠ MINIMIZED, NOT MERELY PINNED. My first version allowlisted all 31 names that happened to
    // become reachable — dev: "the requested fix was minimal cross-boundary surface PLUS an exact
    // allowlist, not an allowlist around every name that happened to become reachable... otherwise
    // 'export every moved helper, then allowlist it' becomes the Phase-0 pattern."
    // Measured by AST: the facade referenced 15 of 31; 16 imports were never read. 31 -> 16.
    const ALLOWED = {
      'packet-input.js': [
        'esTokens', 'findFeature', 'findTask', 'hasCodeIntelCollection', 'normalizeMode',
        'optionsForMode', 'parseTarget', 'readBrief', 'readFunctionality', 'readManifest',
        'readTasks', 'resolvePacketBudget', 'snapshotLine', 'trustTier',
      ],
      'packet-overlay.js': ['buildFeaturePacket', 'buildTaskPacket'],
    };
    // ⛔ POPULATION-COMPLETE. dev: "a newly created packet-symbol.js would be discovered by
    // PACKET_MODULES() but absent from ALLOWED, so its exports would receive no exact check."
    // An allowlist that does not cover its own population is an allowlist with a hole.
    const SEPARATELY_GOVERNED = new Set(['packet.js', 'packet-lists.js', 'packet-budget.js',
      'packet-evidence.js', 'packet-verify.js']);
    const governed = PACKET_MODULES().filter((f) => !SEPARATELY_GOVERNED.has(f));
    expect(governed.sort(), 'every island must have an exact export allowlist')
      .toEqual(Object.keys(ALLOWED).sort());
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      expect(exportedNames(read(file), file), `${file} export surface changed`).toEqual(allowed);
    }
  });
});
