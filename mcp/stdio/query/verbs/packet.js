// graph_packet — single-call agent prompt packet for a task or feature.
//
// Architectural rule (locked in 2026-04-25 upgrade plan v2):
// presentation/orchestration primitive only, NOT a new graph engine.
// Composes existing trusted sources in priority order:
//   1. task / feature overlay (static JSON, fast)
//   2. brief / health / trust state (static JSON, fast)
//   3. optional narrow live enrichment (only if cheap, budgeted,
//      explicit-skip-on-timeout)
// Output is a fixed-schema markdown string designed for prompt-cache
// stability. The packet must remain useful even when LIVE enrichment
// is skipped or times out — overlay-first value is the milestone.

import {
  // ⚠ MINIMIZED, not allowlisted. the reviewer on the first attempt: I pinned all 31
  // accidental exports instead of reducing them — "otherwise 'export every moved helper, then
  // allowlist it' becomes the Phase-0 pattern." Measured by AST: the facade referenced 15 of the
  // 31; the other 16 were imports it never read, which preserve behaviour while obscuring
  // whether ownership actually moved.
  esTokens, resolvePacketBudget, normalizeMode, optionsForMode,
  readBrief, readFunctionality, readTasks, readManifest, hasCodeIntelCollection,
  snapshotLine, parseTarget, findFeature, findTask,
} from './packet-input.js';
import { buildFeaturePacket, buildTaskPacket } from './packet-overlay.js';

// ⚠ COMPATIBILITY RE-EXPORT, per the reviewer: "keep compatibility re-exports from
// packet.js where existing callers import them." `resolvePacketBudget` was part of this
// module's public surface before slice 1 and four tests import it from here. Moving a
// declaration is a mechanical change; moving its PUBLIC NAME is an API change, and slice 1
// is not allowed to be one.
export { resolvePacketBudget } from './packet-input.js';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeTrustLevel } from './health.js';
import { getTrackedDirtyFilesSync } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { assessOverlayBuild, overlayNotBuiltHint } from '../../overlay/quality.js';
import { getPacketTokenBudget } from '../response-budget.js';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbolWithTotal, languageCensusExact } from './symbol_lookup.js';
// Slice 2: the symbol-route data helpers now live in their own authority. `buildSymbolPointerPacket`
// stays here and keeps calling them — only the definitions moved.
import { countByLanguage, resolveFeatureForSymbolCheap, resolvePopulation } from './packet-symbol.js';
// Slice 3: live enrichment moved to its own authority. The facade still uses `withTimeout` and
// `LIVE_BUDGET_MS` for the BUDGETED SYMBOL LOOKUP on the static path — a different caller from
// enrichLive, which is why both cross the boundary rather than staying island-private.
import { LIVE_BUDGET_MS, withTimeout, enrichLive } from './packet-live.js';
// Slice 4: the LEGACY TEXT clamp moved to its own compatibility module.
//
// ⚠ A BARE RE-EXPORT IS CORRECT *HERE*, and that is a measured difference from slice 2 rather
// than a style choice. `resolvePopulation` had two live call sites inside this file, so a bare
// re-export left them unbound and would have thrown at runtime while `node --check` passed.
// `clampToBudget` has NONE — production uses `clampOccurrences` — so it is purely a
// compatibility surface, and importing it here would leave a dead binding whose only effect is to
// look like a dependency the facade does not have.
export { clampToBudget } from './packet-text-budget.js';
// The governed-list machinery lives in its own module so routes in THIS file cannot reach
// the admission primitive. See packet-lists.js for why that had to stop being a choice.
import {
  clampList, boundedList, boundedListAll, candidateList, symbolList,
  exactly, atLeast, unknownPopulation, renderCandidateDisclosures,
  withSealScope, sealPacketOutput, renderPacketLines, clampOccurrences,
} from './packet-lists.js';

// Re-exported: these were part of packet.js's surface before the extraction and existing
// importers (tests, and the seal's own fixtures) still name them here.
export {
  renderCandidateDisclosures, extractListBlocks, sealPacketOutput, withSealScope, SEAL_CAVEAT,
  candidateList, symbolList, boundedList, boundedListAll, renderPacketLines,
  exactly, atLeast, unknownPopulation, _disclosureRenderCount,
} from './packet-lists.js';





















// ----- enrichment helpers (overlay-first) -----










// ----- packet renderer -----










// ----- LIVE enrichment (M3) -----
//
// Called only when the caller passes live=true. Adds a small targeted
// enrichment block computed from existing read verbs, with a strict
// time budget. If the budget is exceeded the block aborts and we mark
// LIVE: timeout in the output. Errors mark LIVE: unavailable. Both keep
// the rest of the packet usable.
//
// Per M0.5 profile (docs/dogfood/latency-profile-2026-04-25.json) the
// read verbs themselves are <150ms on graphs up to ~9k nodes, so the
// budget is set well above that to give callers headroom but still
// catch pathological cases (unfresh state, disk slowness).




// ⛔ A SAMPLE LENGTH IS NOT A POPULATION, AND ABSENCE IS NOT ZERO-DIFFERENCE.
//
// Both consumers below used to read `matched?.symbols_total ?? symHits.length`. That `??`
// conflates two states that must never render alike:
//   1. a producer that MEASURED the population and found total === sample.length;
//   2. a producer that omitted it, or does not know.
// While `symbols_total` was (wrongly) deleted from graphConsequences, this fallback silently
// substituted the sample for the population and printed "UNRANKED (3 matches)" on a repo with
// NINE definitions. The tests did not merely miss the deletion — the fallback absorbed it and
// manufactured a confident wrong number in its place.
//
// review, hermes session's ruling, which this implements: fail closed. `symHits.length` is a
// display count, not a population authority. A total is usable ONLY when producer-attested and
// internally consistent; anything else is `unknown`, and a boolean cannot mint a count.
//
// ★ ONE resolver, used by BOTH call sites deliberately. Two parallel fallbacks are how one
// path gets repaired while the other stays fail-open — which is exactly what happened here
// once already: I fixed the no-feature branch and the feature branch kept the bug for a day.
// ★★ ONE RENDERER FOR CANDIDATE/DEFINITION LISTS, CONSUMED BY EVERY BRANCH.
//
// the field test, after the third per-branch fix: "I would stop patching branches. Three fixes to
// three branches of one verb, and comparing the two survivors immediately surfaced a fourth
// divergence." They were right, and the fourth was real — both branches printed the
// CROSS-LANGUAGE DUPLICATE finding, only ONE carried the FLOOR caveat, on the same verb, same
// symbol, same repo content. A disclosure added where someone was burned, not to its sibling.
//
// ⇒ The structural version closes the CLASS instead of the instances: population, omitted
// count, duplicate finding, floor caveat and next-verb are assembled in one place, so a new
// branch cannot be born missing them. That makes the next "third route" impossible rather than
// findable.
//
// ⚠ The floor caveat's MECHANISM is gated on the languages actually present — also their
// correction. The CONDITION (a cross-language duplicate) is language-generic; naming
// `R"(...)"` is C++/GLSL-specific and would be noise on a Python/TypeScript duplicate. The
// general claim is what always holds; the example appears only where it applies.
// ⛔ THE ROUTE INVENTORY COULD NOT SEE A FIFTH ROUTE, AND review, hermes session PROVED IT
// BY WRITING ONE. They inserted a branch inside graphPacket returning a bare
// `CANDIDATES:\n- src/hidden.cpp:1` — a real reader-facing list that never touches the
// renderer — and packet-route-inventory.test.js still passed 2/2.
//
// ★ The reason is structural, not a bug in the regex: that test groups header emissions by
// TOP-LEVEL FUNCTION and passes the function if `renderCandidateDisclosures(` appears
// anywhere inside it. graphPacket is 396 lines and already contains a renderer call, so
// every new branch added to it inherits credit it did not earn. My claim — "NO route shows
// a symbol list without reaching renderCandidateDisclosures()" — was true of functions and
// false of routes, which is precisely the distinction the fourth route taught me.
//
// ⇒ A source inventory cannot fix this: attributing a header to the code path that reaches
// it is dataflow, not pattern matching. So the guarantee moves to RUNTIME, at the one
// boundary every route must pass through. This counter is the instrument: the seal compares
// it either side of a call, so a route that emits a list without consulting the renderer is
// caught by the fact that it never ran, no matter which branch produced it.
// ⛔ THE FIRST VERSION OF THIS COUNTER WAS MODULE-GLOBAL, AND I DEFENDED IT WITH AN
// ASSUMPTION I HAD NOT CHECKED: "not worth AsyncLocalStorage until a parallel caller
// exists." A parallel caller already existed — the shipped server. mcp/stdio/server.js does
// `rl.on('line', async (line) => ...)` with no queue, mutex or in-flight tracking anywhere,
// and readline does not await an async listener before emitting the next line. Two
// pipelined tool calls interleave by construction.
//
// ★ Deterministic repro of the hole, no async needed: call A (a disclosure-less route)
// snapshots the count, call B renders, call A seals — A sees the count advanced and passes.
// I ran exactly that and the seal let `CANDIDATES:\n- src/hidden.cpp:1` through untouched.
// The "it can only ever produce a FALSE PASS" defence was true and worthless: a false pass
// is the entire defect this seal exists to prevent.
//
// ⇒ Each graphPacket invocation gets its own scope, so a renderer call made by one packet
// cannot satisfy another. The global counter is kept for observability only and is no
// longer what the seal reads.






// ⭐ COMPATIBILITY RE-EXPORT, and the identity is PINNED by test. dev: "Move the definition with
// that authority and compatibility-re-export it from packet.js; pin that the old name resolves to
// the same function object." A re-export that returned an equivalent-but-different function would
// satisfy every behavioural test and still break any caller comparing identities.
// ⚠ `export { x } from '…'` RE-EXPORTS WITHOUT BINDING LOCALLY. This was written as a bare
// re-export first, and `node --check` passed while two internal call sites below would have thrown
// ReferenceError at runtime — a syntax check cannot see an unbound identifier. The name is
// imported above for local use and re-exported here for compatibility; both are needed and they
// are not the same thing.
export { resolvePopulation };


function buildSymbolPointerPacket({ symbol, consequences, snapshot, codeIntelAvailable = false }) {
  const lines = [];
  // ⛔ THE LAST LINE USED TO BE UNCONDITIONAL, AND IT WAS WRONG TWICE OVER ON A JS REPO.
  // the field test, in the field: on a file-path target it emitted
  //   NEXT: code_intel_hierarchy(symbol="mcp/stdio/query/verbs/packet.js", kind="callers")
  //         — clangd call/override tree
  // A C++ verb recommended for JavaScript, AND a file path in a parameter named `symbol`.
  // It was also offered when graph_health had just reported no code-intel collection exists, so
  // the verb had nothing to answer with.
  //
  // ★ Advice that is not conditioned on whether it applies is the same defect as a disclosure
  // that does not state its basis: it costs the reader a call to find out it was never for them.
  const looksLikePath = /[\\/]/.test(symbol) || /\.[a-z0-9]{1,4}$/i.test(symbol);
  const readNext = [
    `NEXT: graph_pull(node="${symbol}") — cross-layer context for this ${looksLikePath ? 'file' : 'symbol'}`,
    `NEXT: graph_consequences(target="${symbol}") — "what breaks if I touch it"`,
    // ⚠ Same defect as the clangd line, one verb over: graph_explore takes SYMBOLS, so a path
    // in `symbols=[...]` is the wrong parameter for the wrong verb. Found while verifying the
    // file-target fix, not reported — the field report named the class and this is another
    // member of it.
    // ⛔ AND THE REPLACEMENT FOR graph_file WAS A DUPLICATE. `graph_file` is not in the default
    // profile, so it sent readers at a door they cannot open; my first correction pointed this
    // slot at graph_pull, which is ALREADY the first line — two identical NEXTs, which reads as
    // a bug in the tool and wastes the slot.
    //
    // ⇒ There is no listed verb that answers "what this file contains" beyond graph_pull, so
    // for a path this line is DROPPED rather than filled. This block's own comment is the
    // reason: advice not conditioned on whether it applies costs the reader a call to find out
    // it was never for them, and an invented third suggestion is exactly that.
    ...(looksLikePath ? [] : [`NEXT: graph_explore(symbols=["${symbol}"]) — verbatim source`]),
    // Offered only when the target is symbol-shaped AND a collection exists to query.
    ...(looksLikePath || !codeIntelAvailable
      ? []
      : [`NEXT: code_intel_hierarchy(symbol="${symbol}", kind="callers") — compiler-backed call/override tree`]),
  // ⚠ the field test, 2026-08-19: "names a listed verb" and "adds information" are DIFFERENT
  // assertions, and only the first was tested. My own correction produced a duplicate NEXT —
  // I repointed a slot at graph_pull when graph_pull was already the first line — which reads
  // as a bug in the tool and burns the slot. Deduping at the point of emission makes the state
  // unconstructible instead of relying on the next reviewer noticing.
  ].filter((line, i, all) => all.indexOf(line) === i);

  if (consequences && typeof consequences === 'object') {
    const symHits = consequences.matched?.symbols ?? [];
    const fileHits = consequences.matched?.files ?? [];
    if (symHits.length === 0 && fileHits.length === 0) return null;
    // ⛔ A PATH IS NOT A SYMBOL, AND CALLING IT ONE STARTED THE CONTRADICTION. The field
    // report saw "SYMBOL: <file>" / "DEFINED IN: none" / "ALSO IN: <the same file>" — three
    // statements that cannot all be sensible together, reading as a bug in the tool. A file is
    // not DEFINED anywhere; it IS somewhere.
    lines.push(`${looksLikePath ? 'FILE' : 'SYMBOL'}: ${symbol}`);
    lines.push(`STATUS: known to graph; not mapped to a feature (${looksLikePath ? 'file' : 'symbol'}-context packet)`);
    lines.push(snapshot);
    // ★ THIS LIST IS TRUNCATED AND UNRANKED — SAY BOTH.
    //
    // Field report (the field test, echoes_of_the_fallen, 2026-08-09). `GpuMaterial`
    // has 16 hits: ONE authoritative C++ declaration and 15 GLSL mirrors. This
    // slice showed five shader copies and dropped the C++ declaration entirely,
    // while graph_whereis ranked the C++ one first. An agent trusting this list
    // would have gone and edited a shader copy.
    //
    // The cause is that `slice(0, 6)` is arrival order, not relevance — and the
    // packet never said so, which is what made a wrong first entry read as the
    // answer. Ranking properly belongs in graph_whereis, which already does it;
    // duplicating a heuristic here would give two rankings that can disagree.
    // So the packet states what it is: an unranked sample, with a pointer to the
    // verb that ranks. Silence about truncation is the defect, not the truncation.
    const SHOWN = 6;
    // ⚠ NOT pre-sliced any more. `clampList(locItems, SHOWN)` received a list ALREADY cut to
    // SHOWN, so `truncated` was structurally always false and its "(N more)" branch could never
    // fire — a safeguard that cannot execute, the same dead-instrument shape as an assertion
    // that cannot fail. Found by enumerating every symbol-list emitter in this file rather than
    // recalling them, after a FOURTH route turned up that I had never listed.
    const locItems = symHits.map((s) => ({
      file: s.file, why: `${s.type || 'symbol'}${s.line ? ` @ line ${s.line}` : ''}`,
    }));
    const definedRows = clampList(locItems, SHOWN);
    // ★★ REPORT THE TRUE TOTAL, NOT THE CAP.
    //
    // `symHits` is `matched.symbols`, which upstream is `pickPrimarySymbol(...)` sliced to
    // THREE. So `symHits.length > SHOWN` (6) was unreachable dead code, and the else
    // branch rendered "(3 matches)" on a repo with nine definitions — the cap reported as
    // the total, with no disclosure that anything had been dropped.
    //
    // That is the same defect the field test found in symbol_lookup's candidate list, one
    // layer up: a capped list whose consumer could not tell it had been capped. The old
    // test here asserted the template's spelling and could never have seen the number in
    // it was wrong.
    const pop = resolvePopulation(consequences.matched?.symbols_total, symHits.length);
    // ⛔ DEFINED IN USED TO BE A "BOUNDED" LIST — a kind that by definition states no
    // population — while the population was disclosed on SEPARATE LINES pushed after it.
    // the reviewer, reading the output with no knowledge of the design, could not tell
    // whether one row meant one definition, a sample, or a floor. I had flagged the same seam
    // from the design side. Two independent routes to the same conclusion.
    //
    // ⇒ It is a symbol list now: the population is IN THE HEADER, derived from `pop`, and the
    // ranking caveat rides inside the same occurrence instead of beside it. Adjacency was the
    // defect — a reader does not owe the packet the assumption that a nearby line refers to
    // the list above it.
    const rankingNote = pop.attested && pop.total > 1
      ? [`  ⚠ UNRANKED — order is arrival, not relevance. graph_whereis(symbol="${symbol}") `
        + 'lists them; NEITHER verb ranks — do not treat the first entry as the definition.']
      : [];
    // ⚠ Skipped for a path target: a file is not DEFINED anywhere, so "DEFINED IN: none" is
    // an answer to a question that does not apply, and a reader takes it as a finding.
    if (!looksLikePath) lines.push(symbolList(
      'DEFINED IN',
      definedRows.items.map((x) => `- ${x.file} — ${x.why}`),
      {
        symbol,
        population: pop.attested ? exactly(pop.total) : unknownPopulation(),
        languages: (consequences.matched?.symbols_by_language ?? []).map((b) => b.lang),
        notes: rankingNote,
      },
    ));
    // ⛔ THE FOURTH ROUTE, AND MY "ONE RENDERER FOR EVERY BRANCH" CLAIM WAS FALSE.
    //
    // This object-form branch consumed `matched.symbols` and the total but never
    // `matched.symbols_by_language`, and never called renderCandidateDisclosures(). dev's probe —
    // an unanchored symbol with 1 C++ and 15 GLSL definitions — got the population warning and
    // NO cross-language duplicate finding and NO floor caveat. The shared renderer closed the
    // divergence between the branches I had already looked at; it could not close a branch I had
    // never enumerated, and I asserted coverage over "every branch" without listing them.
    //
    // ⇒ Route identity, not just branch parity: this route now consumes the same renderer.
    lines.push(...renderCandidateDisclosures({
      shown: symHits.length,
      total: pop.attested ? pop.total : NaN,
      symbol,
      languages: (consequences.matched?.symbols_by_language ?? []).map((b) => b.lang),
      exact: consequences.matched?.symbols_census_exact !== false,
    }));
    if (fileHits.some((f) => String(f) !== String(symbol))) {
      // ALSO IN was bounded too, for the same reason and with the same consequence. Its
      // population IS known — fileHits.length — and it is shown capped at 6, so the header
      // now says which of those two numbers the reader is looking at.
      // ⚠ The target itself is not a place the target "also" appears. Under a population it
      // is also a wrong count, which is how a cosmetic oddity became a false number elsewhere.
      const otherHits = fileHits.filter((f) => String(f) !== String(symbol));
      const shownHits = otherHits.slice(0, 6);
      lines.push(symbolList('ALSO IN', shownHits.map((f) => `- ${f}`), {
        symbol,
        population: exactly(otherHits.length),
      }));
    }
    lines.push(...readNext);
    return renderPacketLines(lines);
  }

  if (typeof consequences === 'string') {
    const trimmed = consequences.trim();
    // NO MATCH → the symbol is truly unknown; let the caller hard-error.
    if (/^NO MATCH/i.test(trimmed)) return null;
    // AMBIGUOUS MATCH (or any other informative string) → surface it verbatim
    // (it already lists the concrete candidate locations) plus the read-next.
    lines.push(`${looksLikePath ? 'FILE' : 'SYMBOL'}: ${symbol}`);
    // ★ "NO FEATURE MAPPING" WAS NEVER ESTABLISHED ON THIS PATH.
    //
    // Found in field testing (2026-08-09) while reviewing the timeout fix, and it is
    // the SAME defect 148 lines earlier — an unestablished negative rendered as a
    // fact about the code.
    //
    // This branch fires when graphConsequences returns a human-readable AMBIGUOUS
    // MATCH string. There is no features_touching in a string: consequences
    // short-circuits to candidates BEFORE computing one. So nothing here ever
    // looked for a feature — and the old wording claimed there was none.
    //
    // Disproved with data, not argued: `WorldBuffer` takes this exact path and is
    // anchors.symbols[0] of feature `world-buffer`. `GpuMaterial` likewise, of
    // `material-palette`. Both were being told they map to no feature.
    //
    // Worse than the timeout case in one respect: there, a lookup ran and failed.
    // Here nothing was attempted, and the output could not distinguish "we looked
    // and found none" from "ambiguity short-circuited before we looked". And by
    // the cost analysis this is the CHEAP path — the one large C++ repos land on
    // most often.
    lines.push('STATUS: known to graph; AMBIGUOUS — feature mapping NOT CHECKED');
    lines.push('  Ambiguity short-circuits the symbol→feature lookup, so this packet has NOT');
    lines.push('  established that the symbol maps to no feature. Do not read it as unmapped.');
    lines.push(snapshot);
    // ⛔ THE THIRD ROUTE. This branch kept the candidate rows and DROPPED the population that
    // was sitting in the same string. the field test, on real C++ with no overlay: `GpuMaterial`
    // printed five candidates with no count, no truncation marker and no cross-language
    // finding, while `graph_consequences` — the source of this very text — printed
    // "16 concrete candidates found", "SHOWING 5 OF 16 — 11 omitted" and the DUPLICATE finding
    // for the same symbol in the same repo. Eleven definitions silently absent, including the
    // sole C++ declaration.
    //
    // ★ Same cap-as-total defect fixed twice already in this verb, surviving in a THIRD branch:
    // a fix applied per-route does not cover the other routes reading the same data. And the
    // block is meticulous about a DIFFERENT unknown four lines up — it explains at length that
    // feature mapping was NOT CHECKED — so one unknown was disclosed with care while the other
    // was not disclosed at all.
    //
    // ⇒ Nothing is recomputed here. The population, the omission and the finding are carried
    // through from the text this branch is already reading.
    const consequenceLines = trimmed.split('\n');
    const allCandidates = consequenceLines.filter((l) => l.startsWith('- '));
    const candidateLines = allCandidates.slice(0, 6);
    const statedTotal = Number(trimmed.match(/(\d+)\s+concrete candidates/)?.[1] ?? NaN);
    // ⛔ A POPULATION CAN ITSELF BE CAPPED, AND "of N" SAYS IT WAS NOT.
    //
    // the field test built the case both of us had recorded as untested — 60 headers each defining
    // the same struct, above the 50-row retrieval cap. `graph_consequences` got it exactly
    // right: "AT LEAST 50 concrete candidates, identified from 50 of 60 matching rows — the
    // full ambiguity population is NOT established (retrieval was capped before grouping)".
    // Three distinct facts kept separate. This branch then printed `showing 5 of 50` — THE CAP
    // AS THE POPULATION, when the truth is 60 and the sibling says so in as many words.
    //
    // ★ That is the ORIGINAL defect — a cap reported as a finding — reappearing at the
    // truncation boundary. The fail-closed work taught this branch to carry a population;
    // nobody told it the population it carries can itself be a floor.
    //
    // ⇒ AND IT EXPOSES A FOURTH STATE the three-state vocabulary lacked: ATTESTED-AS-A-FLOOR.
    // Not UNKNOWN (50 is real and useful), not `of N` (50 is not the total). Rendering it as
    // `of N` is the only wrong choice available.
    //
    // ⇒ the field test's structural point, which the shared renderer does NOT address: a renderer
    // handed the bare integer 50 will faithfully print "of 50" in every branch at once, and the
    // parity arm passes with both routes agreeing on the same wrong word. The exactness must
    // travel WITH the value, not be re-derived at each call site.
    const populationIsFloor = /AT LEAST|NOT established/.test(trimmed);
    const rowsSeen = trimmed.match(/identified from (\d+) of (\d+) matching rows/);
    const crossLanguage = consequenceLines.find((l) => /CROSS-LANGUAGE DUPLICATE/.test(l));
    if (candidateLines.length) {
      // Two caps can apply: consequences already sampled, and this packet samples again.
      // The header states what is SHOWN HERE against the producer-attested population — and
      // says UNKNOWN rather than guessing when the producer did not state one.
      // The languages are recovered from the consequences text this branch is already
      // reading — the finding was computed upstream and was being discarded.
      const langsFromText = crossLanguage?.match(/\(([a-z+, ]+)\)\s*\.?\s*$/)?.[1]?.split(',').map((s) => s.trim()) ?? [];
      // ⚠ THE ROUTE NO LONGER BUILDS ITS OWN HEADER. It hands over the POPULATION FACTS and
      // emitCandidateList derives header, rows and disclosures from that one set of inputs —
      // so a header cannot disagree with the disclosures beneath it, and "minting" a
      // credential is the same act as computing the disclosure correctly.
      // ⚠ The population is now decided HERE, once, as a tagged value — not passed as an
      // integer beside a boolean the constructor defaults to `exact`. That default is how a
      // floor could render as a total if a caller forgot the flag.
      const population = !(Number.isInteger(statedTotal) && statedTotal >= candidateLines.length)
        ? unknownPopulation()
        : populationIsFloor
          ? atLeast(statedTotal, { rowsSeen: rowsSeen ? [rowsSeen[1], rowsSeen[2]] : null })
          : exactly(statedTotal);
      lines.push(candidateList({
        rows: candidateLines,
        symbol,
        population,
        languages: langsFromText.length > 1 ? langsFromText : (crossLanguage ? ['cpp', 'other'] : []),
      }));
    }
    // The disambiguating step comes first here: on this path the useful next move
    // is to narrow the target, not to re-ask the same ambiguous question.
    lines.push(`NEXT: pick a candidate above, then graph_consequences(target="<file>:<symbol>") — resolves the feature the ambiguity hid`);
    lines.push(...readNext);
    return renderPacketLines(lines);
  }

  return null;
}

// ----- main -----

async function graphPacketInner({ repoRoot, target, mode = 'orient', budget = null, live = false, since = null, files = [], audited = false, analyze = false, analyzeMode = 'clang-tidy', analyzeTimeoutMs }) {
  if (!repoRoot) return 'ERROR: repoRoot parameter is required';

  // Verify mode short-circuit: post-edit decision packet, no target required.
  // Routes to buildVerifyPacket which handles the W1.4 fixtures: clean+fresh,
  // edit+stale, edit+unavailable, edit+audited, edit+partial, plus untracked files.
  const earlyMode = normalizeMode(mode);
  if (earlyMode === 'verify') {
    const { buildVerifyPacket } = await import('./packet-verify.js');
    let analysis = null;
    if (analyze) {
      const { codeIntelAnalyze } = await import('./code_intel_analyze.js');
      analysis = await codeIntelAnalyze({ repoRoot, files, mode: analyzeMode, timeoutMs: analyzeTimeoutMs });
    }
    return buildVerifyPacket({ repoRoot, since, files, audited, analysis }).rendered;
  }

  if (!target) return 'ERROR: target parameter is required (task:<id>, feature:<id>, bare id, or bare symbol)';

  // Per architectural rule: read overlay + brief + manifest JSON directly.
  // No ensureFresh() call. No SQLite open. No verb dispatch. Static-first.
  const functionality = readFunctionality(repoRoot);
  const tasksArtifact = readTasks(repoRoot);
  const brief = readBrief(repoRoot);
  const manifest = readManifest(repoRoot);
  const snapshot = snapshotLine(brief, manifest, repoRoot);

  // Repo-size-aware budget (manifest.nodes is free here — already read above).
  // Precedence: explicit arg > APG_PACKET_BUDGET env > tier default.
  const { budgetTokens, caps } = resolvePacketBudget({
    explicit: budget,
    env: process.env.APG_PACKET_BUDGET,
    nodeCount: manifest?.nodes ?? 0,
  });
  const opts = optionsForMode(normalizeMode(mode), budgetTokens);
  // Let the read-first list grow with the repo (monotonic — only ever larger),
  // so god-repos surface enough entry points without re-grepping.
  opts.read_first = Math.max(opts.read_first, caps.read_first);

  const parsed = parseTarget(target);

  // Resolve target
  let kind = parsed.kind;
  let resolvedFeature = null;
  let resolvedTask = null;
  if (kind === 'feature' || (!kind && functionality)) {
    resolvedFeature = findFeature(functionality, parsed.value);
    if (resolvedFeature) kind = 'feature';
  }
  if (!resolvedFeature && (kind === 'task' || !kind) && tasksArtifact) {
    resolvedTask = findTask(tasksArtifact, parsed.value);
    if (resolvedTask) kind = 'task';
  }

  // Bare symbol/file fallback (M3 follow-up — addresses validation-gate
  // finding that PLAN/IMPACT tasks couldn't use packet because targets
  // were function names, not feature/task ids).
  // Strategy: ask graph_consequences to map the symbol to its containing
  // feature, then build the packet from that feature with a MATCHED VIA
  // line preserving the original target.
  let matchedViaSymbol = null;
  let symbolConsequences = null; // retained for the graceful degrade path below
  let featureLookupTimedOut = false; // a timeout must never be rendered as "not found"
  // ★ CHEAP PATH FIRST. See resolveFeatureForSymbolCheap: the budgeted traversal
  // below could not finish on ANY bare symbol on a 12k-node C++ repo, so on the
  // repos this verb matters most for it was never running at all.
  if (!parsed.kind && !resolvedFeature && !resolvedTask) {
    const cheap = resolveFeatureForSymbolCheap(repoRoot, functionality, parsed.value);
    if (cheap?.feature) {
      resolvedFeature = cheap.feature;
      kind = 'feature';
      matchedViaSymbol = parsed.value;
      // Feed the same shape the expensive path produced, so DEFINED IN renders
      // identically whichever route got here.
      symbolConsequences = { matched: { symbols: cheap.locations.map((l) => ({
        label: parsed.value, type: l.type, file: l.file, line: l.line,
      })), symbols_total: cheap.locationsTotal, symbols_by_language: cheap.locationsByLanguage, symbols_census_exact: cheap.locationsCensusExact, files: [] } };
    } else if (cheap?.locations?.length) {
      // Known to the graph, anchored by no feature — the symbol-pointer packet's
      // case, reached without paying for the traversal.
      symbolConsequences = { matched: { symbols: cheap.locations.map((l) => ({
        label: parsed.value, type: l.type, file: l.file, line: l.line,
      })), symbols_total: cheap.locationsTotal, symbols_by_language: cheap.locationsByLanguage, symbols_census_exact: cheap.locationsCensusExact, files: [] } };
    }
  }

  if (!parsed.kind && !resolvedFeature && !resolvedTask && !symbolConsequences) {
    const { graphConsequences } = await import('./consequences.js');
    let mapped;
    try {
      const raw = await withTimeout(
        graphConsequences({ repoRoot, target: parsed.value }),
        LIVE_BUDGET_MS,
      );
      if (raw && raw.__timeout) {
        // ★ A TIMEOUT IS NOT AN ABSENCE.
        //
        // Root-caused 2026-08-09 from the field test: graph_packet("SimCoordinator")
        // on echoes returned ERROR: not found as feature, task, or symbol — while
        // graph_consequences on the SAME symbol, overlay and process resolved it
        // to TWO features. Measured: consequences takes 601ms on a 3958-node repo
        // and 4316ms on a 12126-node one. The budget here is 2000ms.
        //
        // So on any repo large enough to matter, the lookup timed out and the
        // packet reported the symbol as NOT FOUND. That is a latency fact rendered
        // as a fact about the code — the exact substitution this whole project
        // exists to remove, sitting in the flagship orientation verb.
        //
        // It also explains the count inversion the field test measured: a UNIQUE match
        // runs the full computation and blows the budget, while AMBIGUOUS matches
        // return early and cheap. Not inverted on count — inverted on COST. The
        // cleanest input takes the most expensive path.
        featureLookupTimedOut = true;
      }
      if (raw && !raw.__timeout) {
        // graphConsequences returns an object directly (not a JSON string),
        // unlike some other verbs. Handle both shapes defensively.
        if (typeof raw === 'object') mapped = raw;
        else if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          mapped = JSON.parse(raw);
        } else if (typeof raw === 'string') {
          // AMBIGUOUS MATCH / NO MATCH come back as human-readable strings;
          // keep them for the symbol-pointer degrade path.
          symbolConsequences = raw;
        }
      }
      if (mapped) symbolConsequences = mapped;
    } catch {/* fall through to degrade path */}

    const featureHit = mapped?.features_touching?.[0];
    if (featureHit) {
      resolvedFeature = findFeature(functionality, featureHit.id);
      kind = 'feature';
      matchedViaSymbol = parsed.value;
    }
  }

  // FIX 3 (test-round-2026-05-31): graceful symbol degrade. The initialize
  // playbook advertises packet for "a feature/symbol", but a bare symbol that
  // resolves in the graph yet maps to NO feature (or is ambiguous) used to hard
  // reject — contradicting the playbook. Instead, when the symbol IS known to
  // the graph, emit a compact SYMBOL packet that points the agent at its
  // file(s)/feature and the right verbs for symbol context, rather than erroring.
  if (!resolvedFeature && !resolvedTask && !parsed.kind) {
    const symbolPacket = buildSymbolPointerPacket({
      symbol: parsed.value,
      consequences: symbolConsequences,
      snapshot,
      // Threaded in rather than looked up inside: the packet builder is pure over its inputs,
      // and a recommendation gated on a fact the builder cannot see is how the ungated line
      // survived in the first place.
      codeIntelAvailable: hasCodeIntelCollection(repoRoot),
    });
    if (symbolPacket) return symbolPacket;
  }

  // ★ TIMED OUT ≠ NOT FOUND. Say which one happened.
  //
  // Before this, a lookup that blew the 2000ms budget fell through to the same
  // ERROR as a symbol the graph has never heard of. A reader cannot act on that:
  // "not found" invites you to conclude the symbol does not exist, when in fact
  // it may map to several features and the tool simply ran out of time.
  if (!resolvedFeature && !resolvedTask && featureLookupTimedOut) {
    return renderPacketLines([
      `SYMBOL: ${parsed.value}`,
      'STATUS: feature lookup TIMED OUT — this is NOT "symbol not found"',
      snapshot,
      `  The symbol→feature lookup exceeded its ${LIVE_BUDGET_MS}ms budget. On large`,
      '  repos this is expected: the lookup runs a full cross-layer traversal.',
      '  NOTHING here says the symbol is absent or unmapped — only that this verb',
      '  could not finish in time. Do not read it as an absence.',
      `NEXT: graph_consequences(target="${parsed.value}") — the same lookup, unbudgeted; it is what timed out here`,
      `NEXT: graph_whereis(symbol="${parsed.value}") — cheapest way to locate it`,
      'NEXT: graph_packet(target="feature:<id>") — if graph_consequences names a feature, ask for it directly',
    ]);
  }

  if (!resolvedFeature && !resolvedTask) {
    // FIX B — overlay-empty hint. When the target is feature/task-shaped (an
    // explicit feature:/task: prefix, OR a bare id that would resolve via the
    // overlay) and the overlay is missing / has no features / all anchors are
    // broken, the silent "not found" reads as "tool broken." Emit a clear
    // OVERLAY NOT BUILT hint instead. Static-first path (no DB) — uses the
    // declared-anchor fallback in assessOverlayBuild. Bare *symbol* targets
    // that genuinely resolve in the graph never reach here (handled above), so
    // this only fires for the overlay-routed shapes.
    // ⛔ `|| !parsed.kind` MADE THE ERROR BELOW UNREACHABLE, AND SENT EVERY TYPO TO BUILD AN
    // OVERLAY. A bare unresolved token has no kind, so it was classed as overlay-routed and got
    // "OVERLAY NOT BUILT" — byte-identical for `renderPacket` (a misspelling of a symbol that
    // exists) and `ZZZ_definitely_not_a_symbol_12345`. The remedy offered was real; it was just
    // not the reader's problem. Found in the first field test of this code (the field test).
    //
    // ★ The comment that used to sit here said "bare symbol targets that genuinely resolve
    // never reach here". True — and the ones that do NOT resolve reach here, which is the
    // entire population the error below was written for.
    //
    // ⚠ THE FIX IS NOT "SAY NOT FOUND INSTEAD". A bare token on an overlay-less repo is
    // genuinely ambiguous: a misspelled symbol, or a feature id whose overlay was never built.
    // Nothing here can distinguish them, so asserting either is the same defect in different
    // words. An EXPLICIT feature:/task: target is not ambiguous and keeps the overlay hint.
    const explicitlyOverlayRouted = parsed.kind === 'feature' || parsed.kind === 'task';
    const build = assessOverlayBuild(repoRoot, {
      features: functionality?.features ?? [],
      tasks: tasksArtifact?.tasks ?? [],
    });
    if (explicitlyOverlayRouted && !build.built) {
      return [overlayNotBuiltHint(build.reason), snapshot].join('\n');
    }
    return [
      `ERROR: target "${target}" not found as feature, task, or symbol mapping to a feature`,
      ...(build.built
        ? []
        // Named as a possibility, not asserted as the cause — the reader knows which of the
        // two they typed, and this tool does not.
        : [`HINT: no feature overlay exists here, so if "${target}" is a FEATURE id it cannot`
          + ' resolve — run /graph-build-functionality. If it was meant to be a symbol, it is'
          + ' not in the graph under that name.']),
      `HINT: list features in .aify-graph/functionality.json or tasks in .aify-graph/tasks.json`,
      `HINT: try the explicit form 'feature:<id>' or 'task:<id>'`,
      `HINT: bare function/file targets need to map to a known feature via graph_consequences first`,
      snapshot,
    ].join('\n');
  }

  let lines;
  if (resolvedFeature) {
    lines = buildFeaturePacket({ feature: resolvedFeature, brief, functionality, opts, snapshot });
  } else {
    lines = buildTaskPacket({ task: resolvedTask, functionality, brief, opts, snapshot });
  }
  if (matchedViaSymbol) {
    // Insert MATCHED VIA right after the FEATURE/TASK header so the agent
    // knows the packet is symbol-derived, not direct.
    //
    // ★ AND CARRY THE SYMBOL'S OWN LOCATION WITH IT.
    //
    // Field report (the field fleet / sc-coder, Sand Castle, 2026-08-09), from a real
    // 223-member census in a 50k-line header set: asking for a symbol returned
    // the broad owning feature and OMITTED the file that declares it.
    // graph_whereis found it instantly at game/UnifiedFluidRuntime.h:378.
    //
    // The branches were inverted relative to what a reader needs. DEFINED IN was
    // emitted ONLY by the symbol-pointer packet — the path taken when the symbol
    // maps to NO feature and the packet can say least. The moment a feature DID
    // resolve, the packet grew authority and lost the one line that says where
    // the thing actually is. Their verdict, which is the right one: a packet that
    // resolves to a feature but drops the defining declaration is worse than one
    // that returns nothing, because it looks like an answer.
    //
    // The locations are already computed — symbolConsequences is what produced
    // the feature match in the first place.
    const symHits = symbolConsequences?.matched?.symbols ?? [];
    // ⛔ THESE ROWS USED TO BEGIN WITH TWO SPACES, WHICH PUT THIS ENTIRE ROUTE OUTSIDE THE
    // LIST GRAMMAR. Not only did the header state no population — the detector could not see
    // the list at all, so nothing downstream could have noticed. Governed rows start "- ".
    const defLines = symHits.slice(0, 3)
      .filter((s) => s?.file)
      .map((s) => `- ${s.file}${s.line ? `:${s.line}` : ''} — ${s.type || 'symbol'}`);
    lines.splice(1, 0, `MATCHED VIA: symbol "${matchedViaSymbol}" → feature ${resolvedFeature.id}`);
    if (defLines.length) {
      // ⛔ THIS IS THE SECOND CAP, AND I FIXED THE OTHER ONE FIRST.
      //
      // The no-feature path got `symbols_total` and a "showing n of m" line. This branch
      // has its OWN cap and got nothing — so on the case that actually matters it stayed
      // broken. the field test, testing the fix on real echoes: `GpuMaterial` has SIXTEEN
      // definitions and the packet listed three, with no count and no marker of any kind.
      // Their words, and they are the point: a wrong number is at least a number a reader
      // can doubt; a silently complete-looking list of 3 offers nothing to doubt.
      //
      // ★ I fixed the axis I was looking at and did not enumerate the axes I moved —
      // again. The test I wrote used a NO-FEATURE fixture, so it never ran this branch.
      // Same resolver as the pointer-packet branch above — deliberately, so a repair here
      // cannot leave the other consumer fail-open (which is precisely the split that let this
      // branch stay broken for a day after I "fixed" the other one).
      const pop = resolvePopulation(symbolConsequences?.matched?.symbols_total, defLines.length);
      const total = pop.total;
      const byLang = symbolConsequences?.matched?.symbols_by_language ?? [];
      const sampled = pop.attested && total > defLines.length;
      // ⛔ THE THIRD BRANCH HERE WAS THE DEFECT, AND I REPORTED THIS FINDING FIXED WITHOUT IT.
      // When the population was attested and EQUAL to the shown count, the header was the bare
      // `DEFINED IN (…):` with no population at all — exactly the "is one row all of them?"
      // case a first-time reader could not answer. I converted buildSymbolPointerPacket, saw
      // "showing 1 of 1" in real output, and called the finding fixed generally: one branch, a
      // general claim, which is the fourth-route mistake for the third time.
      //
      // ⇒ The population is now a tagged value and the header comes from it, so there is no
      // branch left in which it can be omitted.
      const definedPopulation = pop.attested ? exactly(total) : unknownPopulation();
      const extra = [];
      if (sampled && byLang.length) {
        // Repo-size-independent in a way the sample can never be: two lines say "1 C++
        // header and 15 shader mirrors" whatever the cap happens to be.
        // ⛔ "ALL" WAS A COMPLETENESS CLAIM THE EXTRACTOR CANNOT SUPPORT. the field test, on real
        // C++: `LodChunkInstance` reported `ALL 4 BY LANGUAGE` and the true mirror count is 5.
        // The fifth is GLSL embedded in a C++ RAW STRING LITERAL —
        //   static const char* flatQuadVertSrc = R"( #version 450 struct LodChunkInstance {…} )"
        // — which tree-sitter never parses as a symbol, no `*.glsl` grep finds, and the shader
        // toolchain does not compile at build time. It is the MOST drift-prone copy of a
        // std430-mirrored struct, and `ALL` told the reader the enumeration was complete.
        //
        // ★ Same shape as every cap-as-total defect in this repo, one verb over: the number is
        // a FLOOR and the word said it was a total. PARSED is what the graph can actually
        // attest, and it costs one word.
        extra.push(`  PARSED ${total} BY LANGUAGE: ${byLang.map((b) => `${b.lang} ${b.count}`).join(' · ')}`);
      }
      // ⚠ NOT gated on `total` any more. It used to read `byLang.length > 1 && total > 1`;
      // with fail-closed `total` becoming null when unattested, `null > 1` is false and this
      // FINDING would have been silently suppressed exactly when the population is unknown.
      // The finding does not depend on the population: >1 language in `symbols_by_language`
      // already means >1 definition. Caught by re-reading my own diff, not by a test.
      if (byLang.length > 1) {
        // ★ graph_consequences ALREADY calls this a finding — "CROSS-LANGUAGE DUPLICATE …
        // usually a FINDING rather than a disambiguation problem". Two verbs, one repo,
        // one symbol, opposite treatment: one named the hazard, this one truncated it in
        // silence. Same sentence, same data, no new analysis required.
        // ⚠ The floor caveat rides HERE rather than on every packet, because this is the exact
        // condition where an unparsed mirror matters: a shader struct duplicated across
        // languages is the thing that drifts. the field test's rule — a disclosure that fires
        // conditionally carries information by appearing at all; one that fires always is
        // wallpaper and readers stop seeing it.
      }
      // ⇒ BOTH branches now assemble their disclosures from renderCandidateDisclosures, which
      // is why the FLOOR caveat can no longer exist on one and not the other — the divergence
      // the field test found by comparing the two survivors of the previous round.
      // Still offered when completeness is UNKNOWN — that case needs the remedy more, not less.
      // ⚠ No `limit=` here and no "unsampled": with no population there is no number to pass,
      // and promising an unsampled result from a verb that caps at 5 is the false promise this
      // round removed. What is true unconditionally is that whereis reports its own cap.
      if (!pop.attested) {
        extra.push(`  NEXT: graph_whereis(symbol="${matchedViaSymbol}") — lists them, and reports its own cap`);
      }
      // One typed occurrence carrying header, rows and every disclosure — not a header, a
      // spread of rows and a spread of extras assembled at the call site, which is what let
      // this route drift from its sibling for six iterations without anything noticing.
      lines.splice(2, 0, symbolList(
        'DEFINED IN',
        defLines,
        {
          symbol: matchedViaSymbol,
          population: definedPopulation,
          languages: byLang.map((b) => b.lang),
          notes: ['  (the symbol you asked for, not the feature)', ...extra],
        },
      ));
    }
  }

  // LIVE: enrichment block. Enrichment is explicit-only. The packet exists
  // to be a stable, cheap overlay-first context primitive; auto-enabling
  // live calls on weak/stale snapshots reintroduced the exact ensureFresh
  // latency risk M0.5 identified. Bare-symbol fallback may use one
  // budgeted graph_consequences call to map symbol→feature, but enrichment
  // still requires live=true.
  //
  // When live=true we run a budgeted
  // graph_consequences call and append the cheap-to-compute fields
  // (last_touched, co_consumer_files) that overlay JSON can't give us.
  // Strict 2s budget. Timeout / unavailable both still leave the rest
  // of the packet usable.
  if (live) {
    // For symbol-fallback path, prefer the ORIGINAL symbol target for
    // graph_consequences (which expects symbol/file, not feature id).
    // Without this, LIVE returned "unavailable" on symbol-fallback even
    // when enrichment would have worked on the symbol directly
    // (final-bench bug 2).
    const enrichValue = matchedViaSymbol
      ?? (resolvedFeature ? resolvedFeature.id : null)
      ?? (resolvedTask ? resolvedTask.id : null)
      ?? parsed.value;
    const enrich = await enrichLive({
      repoRoot,
      target,
      kind,
      value: enrichValue,
      opts,
    });
    if (enrich.status === 'enriched') {
      lines.push(`LIVE: enriched (${enrich.elapsed_ms}ms)`);
      // ⚠ THESE TWO WOULD HAVE FALSE-ACCUSED A REAL USER. They are list-shaped, they are
      // built by hand, and NO TEST EXERCISES THEM — the live-enrichment path needs live=true.
      // The suite was green with the seal on; a user calling graph_packet(live=true) would
      // have got a POPULATION NOT DISCLOSED caveat stapled to a perfectly good packet.
      //
      // ★ That is the failure direction I said I cared about and had not checked for. A
      // runtime check only sees executed routes, so "the suite is green" says nothing about
      // the routes the suite never runs. Found by enumerating header-then-rows pushes
      // statically instead of trusting the green — the same move that turned up the fourth
      // disclosure route, applied to my own new mechanism.
      if (enrich.last_touched.length) {
        lines.push(boundedListAll('LAST TOUCHED', enrich.last_touched));
      }
      if (enrich.co_consumer_files.length) {
        lines.push(boundedListAll('CO-CONSUMER FILES', enrich.co_consumer_files,
          (f) => (typeof f === 'string' ? f : (f.file ?? JSON.stringify(f)))));
      }
    } else {
      lines.push(`LIVE: ${enrich.status} (${enrich.detail}; ${enrich.elapsed_ms}ms)`);
    }
  } else {
    const symbolNote = matchedViaSymbol ? '; symbol mapped via budgeted lookup' : '';
    lines.push(`LIVE: skipped_under_budget (overlay-first${symbolNote}; pass live=true to enrich)`);
  }

  // EVIDENCE block injection (Plan #5b): when a code-intel collection has been
  // imported, append a compact provenance-tagged summary so non-verify modes
  // also expose compiler-backed facts. Budget-gated: `clampToBudget` drops the
  // tail when over budget, so EVIDENCE is the first thing trimmed if needed.
  // Surface is read-only — does not change the canonical packet schema for
  // existing callers (the EVIDENCE: line is a strict append).
  try {
    const { buildEvidenceBlock, renderEvidenceBlock } = await import('./packet-evidence.js');
    const symbolForEvidence = (kind === 'feature' || kind === 'task') ? null : (parsed?.value || target);
    const block = buildEvidenceBlock({ repoRoot, symbol: symbolForEvidence, files: [] });
    if (block && (block.available || block.reason === 'no_collection')) {
      lines.push(renderEvidenceBlock(block));
    }
  } catch { /* never block the packet on evidence lookup */ }

  // Cross-link footer (low-salience-wall tie-in, Code-Intel v2 / P1-2+P1-3).
  // graph_packet is a verb agents ALREADY reach for, so a one-line pointer here
  // raises the salience of the two new source-reading verbs they under-pick on
  // their own: graph_trace for a full call path, graph_explore for several
  // symbols' verbatim source. Light cross-link, not a rewrite — appended before
  // the budget clamp so it's trimmed first if the packet is over budget.
  lines.push('NEXT: for the full call path between two symbols use graph_trace(from,to); for several symbols\' source in one read use graph_explore(symbols).');

  // ⛔ CLAMP FIRST, SERIALIZE SECOND. This used to serialize and then rewrite the finished
  // text, which put a transform behind the guarantee: the seal validated a string the clamp
  // then edited. Every attempt to let that through by RECOGNISING the rewritten text failed in
  // one direction or the other — accepting an arbitrary truncation of a candidate list while
  // refusing a genuinely skeletonized bounded one.
  //
  // ⇒ Clamping an OCCURRENCE produces a new occurrence, so the emitted text IS the final text
  // and reconciliation is exact. READ FIRST holds the packet target's primary anchor files —
  // it is the section "containing the target" and must never be dropped (codegraph #564/#569).
  return renderPacketLines(clampOccurrences(lines, opts.budget_tokens, 'READ FIRST'));
}




export async function graphPacket(args) {
  const { out, scope } = await withSealScope(() => graphPacketInner(args));
  return sealPacketOutput(out, scope);
}
