// THE BOUNDARY LEDGER — pre-registered before slice 1 moves anything.
//
// the reviewer's Phase 0 target is not file length:
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
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAll } from '../../../scripts/authority-ledger.mjs';
import { moduleSpecifiers, exportedNames } from '../../../scripts/lib/module-graph.mjs';

const VERBS = fileURLToPath(new URL('../../../mcp/stdio/query/verbs/', import.meta.url));
const read = (f) => readFileSync(join(VERBS, f), 'utf8');
// Every module that owns part of the packet authority, present or future. A slice that adds a
// file here without adding it to this list is a slice this ledger cannot see.
// ⛔ THE GOVERNED SET WAS DEFINED BY NAME, AND A NAME CAN BE CHOSEN.
//
// It was `/^packet(-[a-z]+)?\.js$/`. `packet-text-budget.js` — the module slice 4 creates — did
// not match, so it would have been governed by nothing: no export allowlist, no cycle check, no
// unsealed-entry check. And the governed-set-equals-allowlist assertion could not catch it,
// because a file that never enters the set cannot be missing from it.
//
// ⛔ THEN I WIDENED THE REGEX, WHICH CLOSED THE INSTANCE AND LEFT THE CLASS OPEN. the field test
// measured the repair: 10 of 15 plausible names still escaped — `packet-v2-lists.js`,
// `packet-text.mjs`, `packet_text.js`, `packetText.js`, `packet2-lists.js`. Not adversarial
// constructions; names a person reaches for. A digit, an underscore, a capital or a different
// extension was enough. And the gate FAILS OPEN: a non-matching file is not rejected, it is
// ungoverned, silently.
//
// I had written "a gate whose population is defined by a regex can be left silently by choosing a
// name" in this very comment, and then fixed the hyphen count. Fourth time a gate here has
// checked a SHAPE instead of the thing it claims to govern.
//
// ⇒ SO MEMBERSHIP IS PHYSICAL, NOT SPELT. A module cannot participate in the packet authority
// without being REACHABLE FROM THE FACADE — that is what makes it part of the system rather than
// a file sitting in a directory. The import graph cannot be sidestepped by choosing a nicer name,
// which is precisely the property the regex lacked.
//
// The name pattern is kept as a UNION member, not as the definition: a file called `packet-*`
// that nothing imports yet is still governed, so a module cannot escape by being added before it
// is wired. Escaping now requires being BOTH unreachable from packet.js AND not named like a
// packet module — which is the definition of not being part of this authority.
const VERB_FILES = () => readdirSync(VERBS).filter((f) => /\.(js|mjs|cjs|ts)$/.test(f) && !/\.test\./.test(f));

// ⛔ THE WALK COLLAPSED THE THIRD STATE ITS OWN PARSER GOES OUT OF ITS WAY TO EMIT.
//
// `module-graph.mjs` fails CLOSED on a specifier it cannot read, and says so in capitals:
// "'could not resolve the specifier' is NOT 'there is no dependency'" — emitting
// `{ specifier: '<unresolved>', form: 'dynamic-import-unresolved' }`. This walk then ran
// `/^\.\/(.+)$/` over it, `<unresolved>` failed the match, and it was dropped by the same
// `continue` as "not a sibling in verbs/". Two states meaning opposite things, one branch.
//
// the field test demonstrated the escape it opens, and it is not exotic:
//     const p = './packet_v2Escape.js';   // name escapes NAME_SHAPED
//     await import(p);                    // specifier unreadable -> edge dropped
// Not name-shaped, not reachable, not a tool. Ungoverned, silently — which is the exact property
// the inversion was built to eliminate.
//
// I fixed the PRODUCER this morning and the CONSUMER inherited the old two-state shape. Fourth
// time tonight, and this time in the caller of the very API written to provide the third state.
//
// ⇒ Unreadable is a REFUSAL, not a non-edge. The walk cannot know what it points at, so it stops
// and says so — discovery must not be more permissive than the boundary check downstream of it.
// Same for a parse failure, which is the strongest possible "I could not tell" and was handled as
// "nothing here".
//
// ⚠ LATENT TODAY: 47 verb modules, 0 unresolved specifiers, 0 parse failures. Reported and fixed
// anyway, because a preventive gate exists for the module nobody has written yet.
function reachableFromFacade() {
  const seen = new Set(['packet.js']);
  const queue = ['packet.js'];
  const refusals = [];
  while (queue.length) {
    const f = queue.pop();
    let deps;
    try {
      deps = moduleSpecifiers(read(f), f);
    } catch (err) {
      refusals.push(`${f}: could not be parsed (${err?.message ?? err}) — its edges are unknown`);
      continue;
    }
    for (const d of deps) {
      if (d.specifier === '<unresolved>' || d.form === 'dynamic-import-unresolved') {
        refusals.push(`${f}:${d.line} has an unreadable dynamic import — the governed set cannot be computed`);
        continue;
      }
      const m = /^\.\/(.+)$/.exec(d.specifier);
      if (!m) continue;                       // genuinely not a sibling in verbs/
      const target = m[1].endsWith('.js') ? m[1] : `${m[1]}.js`;
      if (seen.has(target)) continue;
      if (!VERB_FILES().includes(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return { seen, refusals };
}

// ⚠ REACHABILITY ALONE WAS TOO BROAD, and the first attempt proved it by sweeping in
// `code_intel_analyze.js` and ten other sibling VERBS. packet.js legitimately calls other verbs;
// those are not packet-authority islands and must not inherit its export allowlist.
//
// The discriminator is also physical rather than spelt: a REGISTERED TOOL is enumerated in
// `tools/schema.js`, which is the manifest the server actually loads. So an island is a verbs/
// module that the packet family reaches AND that is not itself a tool — it exists to serve packet
// rather than to be called. A file cannot leave that set by renaming; it can only leave by
// becoming a registered tool, which is a reviewed act that appears in the schema.
const SCHEMA = fileURLToPath(new URL('../../../mcp/stdio/tools/schema.js', import.meta.url));
// ⚠ AST, NOT A REGEX — a spelling-shaped predicate had survived inside the fix for spelling-shaped
// predicates. The first version matched /from\s+'\.\.\/query\/verbs\/([^']+)'/ : single quotes
// only, and requiring the `from` keyword. It works on schema.js today because all 35 imports
// happen to be single-quoted, which is a formatting convention rather than a fact.
// Lower severity than the walk defect because it fails toward OVER-governing — a missed tool gets
// swept into the island set and over-constrained — but the machinery was two files away.
const REGISTERED_TOOLS = () => {
  const out = new Set();
  for (const d of moduleSpecifiers(readFileSync(SCHEMA, 'utf8'), 'schema.js')) {
    const m = /^\.\.\/query\/verbs\/(.+)$/.exec(d.specifier);
    if (m) out.add(m[1].endsWith('.js') ? m[1] : `${m[1]}.js`);
  }
  return out;
};

const NAME_SHAPED = (f) => /^packet(-[a-z][a-z-]*)?\.(js|mjs|cjs|ts)$/.test(f);
const PACKET_MODULES = () => {
  const { seen: reachable, refusals } = reachableFromFacade();
  // A discovery that could not complete must not hand back a set that looks complete.
  if (refusals.length) {
    throw new Error(`governed set cannot be computed: ${refusals.join(' | ')}`);
  }
  const tools = REGISTERED_TOOLS();
  return VERB_FILES()
    .filter((f) => f === 'packet.js'
      || NAME_SHAPED(f)
      || (reachable.has(f) && !tools.has(f)))
    .sort();
};

describe('packet authority boundaries', () => {
  it('★★★ the GOVERNED SET cannot be escaped by naming a file', () => {
    // ⛔ THE GATE HOLE I FOUND BY TRYING TO NAME A FILE. The discovery pattern allowed one
    // hyphenated segment, so `packet-text-budget.js` — the module slice 4 creates — would not
    // have appeared in PACKET_MODULES() at all. No export allowlist, no cycle check, no
    // unsealed-entry check, and the governed-set-equals-allowlist assertion could not have caught
    // it, because a file that never enters the set cannot be missing from it.
    //
    // the reviewer's BLOCKER C closed the gap between the governed set and the allowlist. This closes the
    // gap one level up, in how the governed set is DISCOVERED: a gate whose population is defined
    // by a regex can be left silently by choosing a name.
    //
    // Asserted on the predicate rather than on today's directory listing, so it stays true for
    // files that do not exist yet — which is the only version of this check that helps.
    // ⛔ THE VERSION OF THIS TEST I WROTE FIRST PINNED A LIST OF NAMES — six of them, chosen by
    // the person who had just widened the pattern, every one passing for the same reason it was
    // widened. It could not fail for the eleventh name, because the eleventh name was not in it.
    // the field test: "a report that enumerates instances invites an instance-shaped fix. You
    // reported it to yourself as an instance." Measured: 10 of 15 plausible names still escaped.
    //
    // ⇒ So this asserts the PROPERTY the governed set must have: every packet island is
    // discovered by physical membership, and a file cannot leave the set by being renamed. The
    // check that matters is that the ACTUAL packet modules are all found — including the two whose
    // names arrived after the pattern was written.
    const listed = PACKET_MODULES();
    for (const must of ['packet.js', 'packet-input.js', 'packet-overlay.js', 'packet-symbol.js',
      'packet-live.js', 'packet-text-budget.js', 'packet-lists.js']) {
      expect(listed, `${must} must be in the governed set`).toContain(must);
    }
    // Nothing that is a registered TOOL may be swept in — those are verbs packet calls, not
    // islands serving packet, and inheriting the island allowlist would be wrong for them.
    // ⚠ EXCEPT THE FACADE ITSELF, which is both — `packet.js` is the registered graphPacket
    // handler AND the module the islands serve. My first version asserted this absolutely and went
    // red on the one file that is legitimately both, which is the difference between a rule and
    // a rule that has been run.
    const tools = REGISTERED_TOOLS();
    expect(listed.filter((f) => f !== 'packet.js' && tools.has(f)),
      'a registered tool is a verb packet CALLS, not an island serving it').toEqual([]);
    expect(listed.length, 'the packet authority is not empty').toBeGreaterThan(3);
  });

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
    // ⚠ CONTROLLED. This guards the seal boundary — if the pattern ever dies, the assertion
    // passes forever and the one thing standing between a caller and an unsealed route is a
    // regex nobody has run. The control proves it fires on the exact text it forbids.
    // ⚠ USES THE HELPER THAT ALREADY EXISTED. I built a second one — weaker, one canary — before
    // the field test found `live-matcher.js`, landed 0d97826 on 2026-08-12 with TWO canaries and a
    // lastIndex-safe clone. The mechanism was never missing; ADOPTION was: 3 call sites against
    // 158 bare `not.toMatch` in eight days.
    expectAbsentWithLiveMatcher(
      /^export\s+(?:async\s+)?function\s+graphPacketInner/mu,
      {
        forbidden: 'export async function graphPacketInner({ repoRoot }) {',
        allowed: 'export async function graphPacket({ repoRoot }) {',
      },
      read('packet.js'),
      'exporting the inner route makes the seal wrapper optional',
    );
  });

  it('★★★ the exported entry still wraps the inner call in the seal scope', () => {
    // Pins the exact shape the reviewer named. packet-seal.test.js already source-inspects for this;
    // asserted here too because slice 4 touches the facade and this is the line that must survive.
    const src = read('packet.js');
    expect(src).toMatch(/withSealScope\(/);
    expect(src).toMatch(/sealPacketOutput\(/);
  });

  it('★★★ no authority module DEPENDS ON the facade, in any form — that is the cycle', () => {
    // ⛔ THIS GATE WAS QUOTE-SPECIFIC AND the reviewer WALKED THROUGH IT. It matched
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

  it('★★★ the compat re-export is the SAME FUNCTION OBJECT, not an equivalent one', async () => {
    // dev, ruling on slice 2: "Move the definition with that authority and compatibility-
    // re-export it from packet.js; pin that the old name resolves to the same function object."
    //
    // ⚠ IDENTITY, NOT BEHAVIOUR. A re-export that wrapped or re-implemented the function would
    // satisfy every behavioural test in this repo and still break any caller that compares
    // identities — and the failure would surface far from here, as a mysterious inequality.
    const facade = await import('../../../mcp/stdio/query/verbs/packet.js');
    const island = await import('../../../mcp/stdio/query/verbs/packet-symbol.js');
    expect(facade.resolvePopulation, 'the old name must resolve to the moved definition')
      .toBe(island.resolvePopulation);
    // Slice 4's compat re-export, same contract. ⚠ Note the DIFFERENT form: resolvePopulation is
    // imported AND re-exported because the facade still calls it; clampToBudget is a bare
    // re-export because production uses clampOccurrences and the facade has no call site. A bare
    // re-export where a live call site exists is the slice-2 bug that node --check cannot see.
    const budget = await import('../../../mcp/stdio/query/verbs/packet-text-budget.js');
    expect(facade.clampToBudget, 'the legacy clamp must be the same function object')
      .toBe(budget.clampToBudget);
  });

  it('★★★ the serializer-returning route did NOT become reachable', () => {
    // ⛔ dev pre-registered this as the most likely failure of the whole phase: "an unsealed
    // escape introduced for testability — an extracted renderer gets exported, tests begin
    // calling it directly, and its string output bypasses withSealScope/sealPacketOutput."
    //
    // `buildSymbolPointerPacket` returns a serialized string via renderPacketLines, so it stays
    // private in the facade. This asserts the negative directly rather than trusting that the
    // allowlist above happens to omit it — an allowlist proves what IS exported; this proves the
    // one name that must never be.
    for (const f of PACKET_MODULES()) {
      expect(exportedNames(read(f), f), `${f} must not export the unsealed renderer`)
        .not.toContain('buildSymbolPointerPacket');
    }
  });

  it('★★★ island exports are an EXACT allowlist — a new export is a reviewed event', () => {
    // ⚠ the reviewer's reachability finding: slice 1 exported all 31 declarations of the two islands,
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
      // ⭐ PRE-REGISTERED BEFORE THE FILE EXISTED, which is the reviewer's explicit instruction for slice 2:
      // "Pre-register packet-symbol.js's exact allowed surface before adding it." Writing the
      // allowlist first makes the surface a decision; writing it after makes it a description of
      // whatever the extraction happened to leave reachable, which is how slice 1 ended up
      // exporting all 31 of its declarations.
      //
      // ⚠ THREE NAMES, AND buildSymbolPointerPacket IS NOT ONE OF THEM. the reviewer ruled option (1):
      // that function returns a SERIALIZED string via renderPacketLines, so deep-importing it
      // would create the unsealed-renderer escape they pre-registered as the most likely failure
      // of this whole phase — an extracted renderer gets exported, tests call it directly, and its
      // output bypasses withSealScope/sealPacketOutput. It stays private in packet.js.
      'packet-symbol.js': ['countByLanguage', 'resolveFeatureForSymbolCheap', 'resolvePopulation'],
      // ⭐ SLICE 3, PRE-REGISTERED BEFORE THE FILE EXISTED — same discipline as slice 2.
      //
      // ⚠ ALL THREE CROSS THE BOUNDARY, and that is a measured fact rather than a convenience:
      // `withTimeout` and `LIVE_BUDGET_MS` are used by the CHEAP SYMBOL PATH that stays in
      // packet.js (the budgeted symbol→feature lookup and the message that explains its budget),
      // not only by `enrichLive`. Keeping them private would have forced either a duplicate
      // constant — a second source of truth for a budget — or the facade importing its own
      // island's internals. Exporting the minimum that genuinely crosses is the rule; here the
      // minimum is three.
      // A NEW EXPORT HERE IS A REVIEWED EVENT, and these two are that review. The budget became
      // configuration so the suite's verdict could not depend on machine load; `resolveLiveBudget`
      // is the pure resolver (inputs in, value out) and `DEFAULT_LIVE_BUDGET_MS` is the shipped
      // default the product still uses. Both are read by tests that pin the default and prove the
      // environment is actually consulted.
      'packet-live.js': ['DEFAULT_LIVE_BUDGET_MS', 'LIVE_BUDGET_MS', 'enrichLive', 'resolveLiveBudget', 'withTimeout'],
      // ⭐ SLICE 4, PRE-REGISTERED BEFORE THE FILE EXISTED.
      //
      // ⚠ ONLY `clampToBudget` CROSSES. dev: "clampToBudget(text, ...) is an exported
      // compatibility/test surface; production now uses clampOccurrences. It may move to a
      // clearly named compatibility module with re-export, but do not move it into the private
      // occurrence authority as if both mechanisms had equal safety." The three helpers it calls
      // stay private to the module — exporting them would be the "export every moved helper, then
      // allowlist it" pattern the reviewer named as the Phase-0 failure mode.
      'packet-text-budget.js': ['clampToBudget'],
    };
    // ⛔ POPULATION-COMPLETE. dev: "a newly created packet-symbol.js would be discovered by
    // PACKET_MODULES() but absent from ALLOWED, so its exports would receive no exact check."
    // An allowlist that does not cover its own population is an allowlist with a hole.
    // ⚠ DENY BY DEFAULT: everything the physical predicate finds is governed unless it is named
    // HERE, with a reason. That is the inversion — a new module is governed automatically, and
    // excluding one is an act that shows up in a diff and has to be justified next to itself.
    // The old regex failed the other way: a file it did not match was silently ungoverned.
    const SEPARATELY_GOVERNED = new Set([
      'packet.js',            // the facade — governed by the seal/entry assertions above
      'packet-lists.js',      // the private occurrence authority; its surface is deliberately wide
      'packet-budget.js',
      'packet-evidence.js',
      'packet-verify.js',
      // Reached from packet.js and not registered as tools, so the predicate finds them — but they
      // are SHARED verb infrastructure rather than packet islands, used by callers/consequences/
      // whereis too. Excluded explicitly rather than by a pattern that would also have hidden a
      // real island.
      'symbol_lookup.js',
      'read_freshness.js',
    ]);
    const governed = PACKET_MODULES().filter((f) => !SEPARATELY_GOVERNED.has(f));
    expect(governed.sort(), 'every island must have an exact export allowlist')
      .toEqual(Object.keys(ALLOWED).sort());
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      expect(exportedNames(read(file), file), `${file} export surface changed`).toEqual(allowed);
    }
  });
});
