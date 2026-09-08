import { describe, it, expect } from 'vitest';
import { ATTESTATION } from '../../../mcp/stdio/storage/publication-schema.js';
import { graphCapabilities } from '../../../mcp/stdio/query/graph-capabilities.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ THE DEFECT THIS CLOSES WAS MEASURED ON THIRD-PARTY REPOSITORIES, not imagined:
//
//     fast-route (PHP)  0 compiler-verified edges  ->  trust: "strong"
//     fmt (C++)         0 compiler-verified edges  ->  trust: "ok"
//     click (Python)    1,410 verified (10.4%)     ->  trust: "weak"
//
// `computeTrustLevel` is a function of unresolved-edge count alone. It is a real measure of how
// completely extraction resolved its own references, and it says NOTHING about whether a compiler
// ever checked an edge. So the repo with no spine reports the strongest trust.
//
// `graph_health` already warns in `nextActions`. The problem is that the HEADLINE CONTRADICTS THE
// WARNING — and a reader who believes the headline never reaches the correction.
//
// ⇒ Review ruled: report capabilities SEPARATELY, do not refuse to call the graph usable, do not
// auto-run a 60-second collection. These tests pin that ruling.

describe('graphCapabilities — orientation and absence authority are INDEPENDENT', () => {
  it('⭐ a graph with NO verified edges is still usable for orientation', () => {
    // The half review insisted on: a missing spine does not make the graph worthless. File and
    // symbol location, containment and module structure are all served by extraction.
    const c = graphCapabilities({ indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false });
    expect(c.orientationUsable).toBe(true);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('no_collection');
  });

  it('⛔ absence authority is FALSE when the spine is empty — the deleting claim', () => {
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true },
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('trust_spine_empty');
  });

  it('⛔ absence authority is FALSE on a PARTIAL collection, even with verified edges', () => {
    // click: 1,410 verified edges and 25 of 79 files processed. An empty caller set there is a
    // floor, not a fact, and this is the exact state that reported trust "weak" while having the
    // only real spine of the four arms.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: false },
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('collection_partial');
  });

  it('⭐ every clause holding LEAVES ONLY the architectural refusal — nothing else is denying', () => {
    // ⛔ 2026-09-08: THIS WAS "absence authority is TRUE only when every clause holds", and its
    // comment read "a predicate that never grants is as useless as one that always does". The grant
    // is now a stated POLICY — the product cannot establish what a language server indexed — so a
    // boolean assertion here would only re-state a constant.
    //
    // ⇒ THE LIVENESS RESIDUE IS STRONGER THAN THE BOOLEAN WAS. With every repository-side clause
    // satisfied, the surviving reason must be the ARCHITECTURAL one. If any clause were silently
    // denying — a stale collection, an empty spine, a missing attestation — its reason would appear
    // here instead, and this test names which.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true },
      collectionCurrent: true, attestation: ATTESTATION.ATTESTED,
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason, 'every repository-side clause released; only the unattestable population remains')
      .toBe('index_population_unattested');
    expect(c.nextAction, 'a refusal must still name an action').toBeTruthy();
  });

  it('⛔ UNKNOWN coverage refuses — `complete !== true`, not `=== false`', () => {
    // A collection stored before the coverage columns existed reports null. Unknown coverage is not
    // complete coverage, and this repository has repeatedly paid for collapsing those two.
    for (const coverage of [null, undefined, {}, { complete: null }]) {
      const c = graphCapabilities({
        indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage,
      });
      expect(c.absenceAuthority, JSON.stringify(coverage)).toBe(false);
    }
  });

  it('⛔ an unindexed repo has NEITHER capability', () => {
    const c = graphCapabilities({ indexed: false });
    expect(c.orientationUsable).toBe(false);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('not_indexed');
  });
});

describe('the PHP case — a permanent limit must not be dressed as a pending action', () => {
  it('⭐ names the missing language server instead of suggesting a collection', () => {
    // ⛔ fast-route reports trust "strong" with zero verified edges and can NEVER earn one, because
    // no PHP language server exists here. Telling that reader to run graph_collect_code_intel
    // sends them to a command that cannot help — a remedy that cannot work is worse than naming
    // the limit, because it costs them a minute AND leaves the wrong belief intact.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false,
      language: 'php', languageHasServer: false,
    });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('no_language_server');
    expect(c.nextAction).toMatch(/no language server for php/i);
    expect(c.nextAction).toMatch(/rg/);
    // ⛔ CONTROLLED NEGATIVE, because a bare `not.toMatch` passes vacuously on null or on a typo in
    // the pattern. The repo's own guard caught this one — `negative-assertions-are-controlled`
    // failed the suite when I wrote the bare form, which is the mechanical control working.
    // The canaries prove the matcher is live AND not overbroad before absence is asserted.
    expectAbsentWithLiveMatcher(
      /graph_collect_code_intel/,
      { forbidden: 'graph_collect_code_intel({ scope: "all" })', allowed: 'verify with rg before any delete' },
      c.nextAction,
      'a language with no server must NOT be sent to a collection that cannot help it',
    );
  });

  it('a language WITH a server still gets the collection action', () => {
    // The negative control: without this, the assertion above is satisfied by never suggesting a
    // collection to anyone.
    const c = graphCapabilities({
      indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false,
      language: 'python', languageHasServer: true,
    });
    expect(c.nextAction).toMatch(/graph_collect_code_intel/);
  });
});

describe('every refusal carries an action a reader can take', () => {
  it('⛔ no reason is ever reported without a next action', () => {
    // A capability that says "no" and stops makes the reader re-ask, which this project has spent
    // the day removing everywhere else.
    const states = [
      { indexed: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true } },
      { indexed: true, compilerVerifiedEdges: 5, collectionAvailable: true, coverage: { complete: false } },
      { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false, language: 'php', languageHasServer: false },
    ];
    for (const s of states) {
      const c = graphCapabilities(s);
      expect(c.absenceAuthority, JSON.stringify(s)).toBe(false);
      expect(typeof c.nextAction, JSON.stringify(s)).toBe('string');
      expect(c.nextAction.length).toBeGreaterThan(10);
    }
  });

  it('⭐ NO to every state, but never the SAME no — the rubber stamp moved to the reason', () => {
    // ⛔ THIS TEST WAS WRITTEN TO CATCH A CLAUSE QUIETLY TURNING THE ONE YES INTO ZERO, and its own
    // comment warned about exactly that twice. On 2026-09-08 the zero became DELIBERATE: the grant
    // is a stated policy, because the product cannot establish what a language server indexed.
    //
    // ⇒ ITS PURPOSE SURVIVES THE CHANGE AND ITS INSTRUMENT DOES NOT. "Not a rubber stamp" cannot be
    // measured on a boolean that is constant by design, so it moves to the field that still varies.
    // A gate that denied every state for the SAME reason would be the rubber stamp this test has
    // always been about — and that is now the failure it can catch.
    const states = {
      everythingSatisfied: { indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true }, collectionCurrent: true, attestation: ATTESTATION.ATTESTED },
      notIndexed: { indexed: false },
      noCollection: { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: false },
      emptySpine: { indexed: true, compilerVerifiedEdges: 0, collectionAvailable: true, coverage: { complete: true } },
      partialCoverage: { indexed: true, compilerVerifiedEdges: 9, collectionAvailable: true, coverage: { complete: false } },
    };
    const results = Object.fromEntries(
      Object.entries(states).map(([k, v]) => [k, graphCapabilities(v)]),
    );

    // The policy: not one of them buys the licence.
    for (const [k, c] of Object.entries(results)) {
      expect(c.absenceAuthority, `${k} must not grant`).toBe(false);
    }
    // The discrimination: five states, five different answers to WHY.
    const reasons = Object.values(results).map((c) => c.reason);
    expect(new Set(reasons).size, `five states must give five reasons, got ${reasons.join(', ')}`)
      .toBe(5);
    // And every one of them names an action, so a denial is never a dead end.
    for (const [k, c] of Object.entries(results)) {
      expect(c.nextAction, `${k} must tell the reader what to do`).toBeTruthy();
    }
  });
});

// ⛔ F8 — AN INTERRUPTED INDEX LEAVES A GRAPH THAT PASSES EVERY OTHER CHECK.
//
// Observed on the pinned corpus: a `graph_index` killed mid-write left click holding 90 nodes
// (Document 43, Directory 25, Config 22) and ZERO code nodes, while the file existed, opened
// cleanly, carried a plausible count, and health reported it indexed.
//
// `writeManifest` renames atomically at the END of a successful run, so the manifest keeps
// describing the last good state while the database is mangled — and nothing compared the two.
//
// ⭐ POSITIVE CONTROL, measured on all four arms in the same pass: healthy graphs agree EXACTLY
// (fmt 6735/14855, click 2572/13618, fast-route 489/1343, p-queue 184/384), so a mismatch is a real
// signal rather than ordinary drift. The `HEALTHY` case below is that control in test form: without
// it, every assertion here is satisfied by a function that calls every graph broken.
describe('graphCapabilities — an incomplete index is reported, and only when it IS one', () => {
  // `FULL` means every capability clause satisfied, so it gained `lspPopulationAttested` on
  // 2026-09-06 with the clause itself — otherwise this positive control would assert that an
  // integrity-agreeing graph "keeps every capability" while one of them was denied for an unrelated
  // reason, and the integrity tests below would be measuring the wrong denial.
  const FULL = { indexed: true, compilerVerifiedEdges: 1410, collectionAvailable: true, coverage: { complete: true }, collectionCurrent: true, attestation: ATTESTATION.ATTESTED };

  it('⭐ POSITIVE CONTROL: a graph whose counts agree keeps every capability', () => {
    const c = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 2572, manifestEdges: 13618, dbEdges: 13618, codeNodes: 1904 } });
    expect(c.orientationUsable).toBe(true);
    // ⛔ THE CAPABILITY THIS CONTROL IS ABOUT IS INTEGRITY, NOT THE GRANT. Agreeing counts must not
    // produce `index_incomplete`; since 2026-09-08 the grant is a constant policy, so the assertion
    // that this state is healthy lives in the REASON — it must not be an integrity complaint.
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason, 'agreeing counts must not be diagnosed as a half-written index')
      .toBe('index_population_unattested');
  });

  it('⛔ THE OBSERVED SHAPE: manifest 2,572 / database 90 / zero code nodes', () => {
    const c = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 90, manifestEdges: 13618, dbEdges: 0, codeNodes: 0 } });
    expect(c.orientationUsable).toBe(false);
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('index_incomplete');
  });

  it('⛔ ORIENTATION FAILS TOO — a half-written graph cannot answer "what is near this" either', () => {
    // The narrower fix would have failed only absenceAuthority. But the observed graph had NO code
    // nodes at all, so "what does this module contain" is wrong, not merely incomplete.
    const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 } });
    expect(c.orientationUsable).toBe(false);
  });

  it('⛔ the nextAction says REINDEX and names both counts — never "run a collection"', () => {
    // The first cut of this fix let `index_incomplete` fall through to the default branch, which
    // told the operator to run a 60-second collection on a graph that needed rebuilding. Executing
    // it caught that; reading it had not.
    const { nextAction } = graphCapabilities({ ...FULL, integrity: { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 } });
    expect(nextAction).toMatch(/graph_index/);
    // A bare negative here would pass just as happily if the regex were dead. The canaries prove
    // it fires on the wrong remedy and stays silent on the right one.
    expectAbsentWithLiveMatcher(
      /graph_collect_code_intel/,
      { forbidden: 'graph_collect_code_intel({ scope: "all" }) to build the trust spine', allowed: 'graph_index({ force: true })' },
      nextAction,
      'a partial graph must be told to reindex, never to collect',
    );
    expect(nextAction).toContain('2572');
    expect(nextAction).toContain('90');
  });

  it('⛔ index_incomplete OUTRANKS every other reason — an unusable graph explains itself first', () => {
    // A partial PHP graph must not be told its problem is the missing language server.
    const c = graphCapabilities({ indexed: true, languageHasServer: false, language: 'php', collectionAvailable: false, integrity: { manifestNodes: 489, dbNodes: 12, codeNodes: 0 } });
    expect(c.reason).toBe('index_incomplete');
  });

  describe('⛔ it must not accuse a graph that is merely SMALL, EMPTY, or UNMEASURED', () => {
    it('a docs-only repository with zero code nodes and agreeing counts is fine', () => {
      // The zero-code signal alone would condemn every legitimate documentation tree. It fires only
      // paired with the database holding LESS than the manifest promised.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 90, dbNodes: 90, codeNodes: 0 } });
      expect(c.orientationUsable).toBe(true);
      expect(c.reason).not.toBe('index_incomplete');
    });

    it('a graph holding MORE than the manifest promised is not partial', () => {
      // A collection legitimately adds nodes after the index that wrote the manifest.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2393, dbNodes: 2566, codeNodes: 0 } });
      expect(c.orientationUsable).toBe(true);
    });

    it('UNKNOWN REFUSES TO ACCUSE: absent integrity, and manifests predating these fields', () => {
      expect(graphCapabilities({ indexed: true }).orientationUsable).toBe(true);
      expect(graphCapabilities({ indexed: true, integrity: null }).orientationUsable).toBe(true);
      expect(graphCapabilities({ indexed: true, integrity: { manifestNodes: null, dbNodes: 90, codeNodes: 0 } }).orientationUsable).toBe(true);
    });

    it('short of the manifest but still HOLDING CODE is not condemned on that evidence alone', () => {
      // Short alone could be a pruned collection. The pair is required.
      const c = graphCapabilities({ indexed: true, integrity: { manifestNodes: 2572, dbNodes: 2100, codeNodes: 1500 } });
      expect(c.orientationUsable).toBe(true);
    });
  });

  it('⭐ it DISCRIMINATES: exactly one of these six states is called incomplete', () => {
    // Each negative above passes individually for a function that never fires. Counting both
    // outcomes in one pass is the cheapest proof this is not simply inert.
    const states = [
      { manifestNodes: 2572, dbNodes: 90, codeNodes: 0 },        // the observed defect
      { manifestNodes: 2572, dbNodes: 2572, codeNodes: 1904 },   // healthy
      { manifestNodes: 90, dbNodes: 90, codeNodes: 0 },          // docs-only
      { manifestNodes: 2393, dbNodes: 2566, codeNodes: 0 },      // post-collection growth
      { manifestNodes: 2572, dbNodes: 2100, codeNodes: 1500 },   // short but holding code
      { manifestNodes: null, dbNodes: 90, codeNodes: 0 },        // unmeasured
    ];
    const fired = states.filter((integrity) => graphCapabilities({ indexed: true, integrity }).reason === 'index_incomplete');
    expect(fired).toHaveLength(1);
    expect(fired[0].dbNodes).toBe(90);
  });
});

// A COMPLETE COLLECTION IS NOT A CURRENT ONE.
// `coverage.complete` is a frozen fact about a moving corpus: it describes the collection at
// collection time. After that commit, every changed file loses its verified evidence on the next
// rebuild, because the per-file salvage gate drops it rather than re-stamp shifted line numbers.
// Measured on this repository — 121 commits past its collection, one reindex took the spine from
// 1,943 verified edges to 1,054 — while absenceAuthority was still being granted.
//
// `lsp-evidence` already renders "the set is a FLOOR, not exhaustive" once HEAD has moved. This flag
// disagreed with it, and of the two surfaces this is the one read before deleting code.
describe('absence authority requires a CURRENT collection, not just a complete one', () => {
  const complete = {
    indexed: true,
    collectionAvailable: true,
    language: 'cpp',
    languageHasServer: true,
    coverage: { complete: true },
    compilerVerifiedEdges: 1054,
    attestation: ATTESTATION.ATTESTED,
    // Added 2026-09-06 with the clause it satisfies: the gate now also requires that the LANGUAGE
    // SERVER attested which files it indexed, because `coverage.complete` counts files APG
    // PROCESSED and the two are different populations. The base means "every clause satisfied", so
    // it carries the new one too — same extension this fixture took for `collectionCurrent` and
    // `attestation` before it.
  };

  it('POSITIVE CONTROL: a current, complete collection still grants authority', () => {
    // ⛔ WITHOUT THIS THE TWO ASSERTIONS BELOW WOULD PASS ON A CLAUSE THAT DENIES UNCONDITIONALLY,
    // and that risk is REAL, not theoretical: since 2026-09-08 the verdict IS unconditional. So the
    // control moved to the reason, which still varies — a current collection must NOT be diagnosed
    // as stale, and this is what proves `collection_stale` below is the currency clause firing.
    const c = graphCapabilities({ ...complete, collectionCurrent: true });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason, 'a current collection must not be reported stale').toBe('index_population_unattested');
  });

  it('denies authority when the collection was taken at an older commit', () => {
    // Catches: granting "no callers" authority from evidence whose subject has moved.
    const c = graphCapabilities({ ...complete, collectionCurrent: false });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason).toBe('collection_stale');
  });

  it('fails closed when collection currency is unknown, under its OWN reason', () => {
    // Catches: treating an unsupplied or unknowable commit as currency. Null is not evidence.
    const c = graphCapabilities({ ...complete });
    expect(c.absenceAuthority, 'unknown currency must not grant authority').toBe(false);
    expect(c.reason, 'unknown is a different fact from known-stale').toBe('collection_currency_unknown');
  });

  it('does not assert an older commit when no comparison was possible', () => {
    // ⛔ THE BUG THIS TEST EXISTS FOR WAS MINE, an hour after writing the clause. Collapsing unknown
    // into collection_stale made the refusal claim the collection "was taken at an older commit" in
    // exactly the state where nothing could be compared — and prescribe a re-collect that cannot
    // help, since HEAD is unreadable in a non-git checkout no matter how many collections run.
    const c = graphCapabilities({ ...complete });
    expectAbsentWithLiveMatcher(
      /taken at an older commit/i,
      {
        forbidden: 'the collection is complete but was taken at an older commit, so every file',
        allowed: 'the currency of the collection could not be established — either it predates',
      },
      c.nextAction,
      'an unknown currency must not be reported as a known staleness',
    );
    expect(c.nextAction, 'and it must still say what the caller set is worth').toMatch(/FLOOR/);
  });

  it('names the cause and a remedy rather than only refusing', () => {
    // Catches: a bare denial. A reason with no next action gets worked around, not acted on.
    const c = graphCapabilities({ ...complete, collectionCurrent: false });
    expect(c.nextAction).toMatch(/graph_collect_code_intel/);
    expect(c.nextAction, 'must say WHY it decayed').toMatch(/older commit/i);
    expect(c.nextAction, 'must tell the reader what the caller set is worth meanwhile').toMatch(/FLOOR/);
  });

  it('does not mask a more severe reason that was already firing', () => {
    // Catches: the new clause jumping the precedence order and hiding an empty trust spine.
    const c = graphCapabilities({ ...complete, compilerVerifiedEdges: 0, collectionCurrent: false });
    expect(c.reason).toBe('trust_spine_empty');
  });
});

// A BINARY STALENESS FLAG ON AN ACTIVE REPOSITORY IS ALWAYS ON, AND AN ALWAYS-ON WARNING IS IGNORED.
// collection_stale fires after a single commit — correct, because that file's evidence is genuinely
// gone — but "stale" reads identically whether one covered file changed or fifty. The verdict stays
// binary because the authority question is binary; the magnitude goes in the message.
describe('the staleness message carries how much decayed', () => {
  const stale = {
    indexed: true, collectionAvailable: true, language: 'cpp', languageHasServer: true,
    coverage: { complete: true }, compilerVerifiedEdges: 1054, collectionCurrent: false,
  };

  it('states the decay when it is known', () => {
    // Catches: an always-on warning with no way to tell a nudge from an emergency.
    const c = graphCapabilities({ ...stale, collectionFilesCovered: 88, collectionFilesChanged: 50 });
    expect(c.nextAction).toMatch(/50 of 88 covered files have changed/);
  });

  it('degrades cleanly when it is not known, without an empty aside', () => {
    // Catches: rendering "(null of null …)" or a stray empty parenthesis when the numbers are absent.
    const c = graphCapabilities({ ...stale });
    expect(c.nextAction).toMatch(/lost its verified evidence\. Caller sets/);
    expectAbsentWithLiveMatcher(
      /\(\s*(null|undefined|NaN|)\s*(of)?\s*(null|undefined|NaN|)?\s*covered files/,
      {
        forbidden: 'evidence (null of null covered files have changed). Caller sets',
        allowed: 'evidence (50 of 88 covered files have changed). Caller sets',
      },
      c.nextAction,
      'an unknown decay must be omitted, not rendered as empty values',
    );
  });

  it('the verdict does not change with the magnitude — only the message does', () => {
    // Catches: a threshold sneaking in. One changed covered file is still lost evidence.
    const one = graphCapabilities({ ...stale, collectionFilesCovered: 88, collectionFilesChanged: 1 });
    const many = graphCapabilities({ ...stale, collectionFilesCovered: 88, collectionFilesChanged: 88 });
    expect(one.absenceAuthority).toBe(false);
    expect(many.absenceAuthority).toBe(false);
    expect(one.reason).toBe(many.reason);
    expect(one.nextAction).toMatch(/1 of 88/);
  });
});

// ⛔ AN UNATTESTED GRAPH CANNOT SUPPORT AN ABSENCE CLAIM.
//
// Every other clause in this function asks how GOOD the evidence is. This one asks whether the
// graph in front of the reader is the graph the manifest is describing. If that cannot be
// established, the quality of the evidence is a question about something else entirely.
//
// ⚠ FOUR STATES, AND COLLAPSING ANY TWO GRANTS SOMETHING UNEARNED — or, worse, prescribes a remedy
// that cannot work. `legacy_unattested` means the question cannot be asked of this graph and one
// rebuild fixes it forever. `never_completed` means the question WAS asked and nothing has ever
// been published. `generation_mismatch` means a rebuild committed and its manifest never landed.
// `attestation_unknown` is not about the graph at all — it is a caller that forgot to ask.
describe('publication attestation gates the claim that deletes code', () => {
  const attestedBase = {
    indexed: true,
    compilerVerifiedEdges: 1054,
    collectionAvailable: true,
    coverage: { complete: true },
    collectionCurrent: true,
    // See the note on `complete` above — "every other clause satisfied" now includes the language
    // server's own indexed population being attested.
  };

  it('POSITIVE CONTROL: an attested graph with every other clause satisfied still grants authority', () => {
    // ⛔ WITHOUT THIS EVERY DENIAL BELOW IS WORTHLESS — and since 2026-09-08 the closed state IS
    // permanent by policy, so the old form of this control (assert it opens) can no longer be
    // written. What still discriminates is the REASON: an attested graph must stop producing an
    // attestation complaint, which is what makes the three refusals below meaningful.
    const c = graphCapabilities({ ...attestedBase, attestation: ATTESTATION.ATTESTED });
    expect(c.absenceAuthority).toBe(false);
    expect(c.reason, 'an attested graph must not be diagnosed as an attestation problem')
      .toBe('index_population_unattested');
    expect(c.attestation).toBe(ATTESTATION.ATTESTED);
  });

  for (const [state, reason] of [
    [ATTESTATION.LEGACY_UNATTESTED, 'legacy_unattested'],
    [ATTESTATION.NEVER_COMPLETED, 'never_completed'],
    [ATTESTATION.GENERATION_MISMATCH, 'generation_mismatch'],
  ]) {
    it(`⛔ ${state} denies authority under its OWN reason`, () => {
      const c = graphCapabilities({ ...attestedBase, attestation: state });
      expect(c.absenceAuthority, 'every other clause holds, so only attestation can be denying').toBe(false);
      expect(c.reason).toBe(reason);
      expect(c.nextAction, 'a refusal without a remedy is a dead end').toBeTruthy();
    });
  }

  it('⛔ the three denials do NOT share a remedy — each names what actually happened', () => {
    // Collapsing them would send a reader to a command that cannot help. `never_completed` in
    // particular must not read like `legacy_unattested`: one is an old graph, the other is an empty
    // graph presenting as a real one.
    const actions = [ATTESTATION.LEGACY_UNATTESTED, ATTESTATION.NEVER_COMPLETED, ATTESTATION.GENERATION_MISMATCH]
      .map((a) => graphCapabilities({ ...attestedBase, attestation: a }).nextAction);
    expect(new Set(actions).size, 'three states, three messages').toBe(3);
    expect(actions[1]).toMatch(/generation 0|never been (completed|published)/i);
    expect(actions[2]).toMatch(/DIFFERENT generations|manifest never landed/i);
  });

  it('⛔ orientation SURVIVES an unattested graph — the denial is scoped to absence claims', () => {
    // Denying orientation here would be over-correction: a legacy graph is still perfectly good at
    // "where does this live". Only the claim that deletes code needs the attestation.
    for (const a of [ATTESTATION.LEGACY_UNATTESTED, ATTESTATION.GENERATION_MISMATCH]) {
      const c = graphCapabilities({ ...attestedBase, attestation: a });
      expect(c.orientationUsable, `${a} must not disable orientation`).toBe(true);
    }
  });

  it('⛔ a caller that supplies NOTHING is denied, under a reason that blames the CALLER', () => {
    const c = graphCapabilities(attestedBase);
    expect(c.absenceAuthority, 'the default must not be a silent pass').toBe(false);
    expect(c.reason).toBe('attestation_unknown');
    expectAbsentWithLiveMatcher(
      /\b(legacy|generation 0|older commit)\b/i,
      { forbidden: 'this graph is legacy', allowed: 'the caller did not supply an attestation' },
      c.nextAction,
      'a caller-side omission must not be reported as a fact about the graph',
    );
  });

  it('⛔ attestation_unknown does NOT mask a more specific graph state', () => {
    // Ordered last deliberately. Placed first it reported a caller bug in place of a real
    // diagnosis, and an existing test in this file caught it within one run.
    const c = graphCapabilities({ indexed: true, collectionAvailable: false });
    expect(c.reason, 'a missing collection is a fact about the graph and outranks a caller omission')
      .toBe('no_collection');
    expect(c.absenceAuthority, 'it still denies — it just does not get to explain').toBe(false);
  });
});

// ⛔ A REMEDY THAT CANNOT WORK IS WORSE THAN NAMING THE LIMIT.
//
// Every unattested remedy said "graph_index()". Measured on a real legacy graph: graph_index()
// returned indexed:true / processed:0 and left it legacy, because the verb defaults to force:false
// and an unchanged or body-only-changed repository takes the all-cosmetic no-op path, which returns
// before publication. graph_index({force:true}) published generation 1.
//
// So a user following the printed advice would see success, see no change, and conclude the tool
// was broken. The positive control below is the case where the bare form IS correct — there is no
// graph to no-op over — which is why this asserts per state rather than banning the bare string.
describe('the unattested remedies name a command that actually publishes', () => {
  const base = {
    indexed: true, compilerVerifiedEdges: 1054, collectionAvailable: true,
    coverage: { complete: true }, collectionCurrent: true,
  };

  for (const state of [
    ATTESTATION.LEGACY_UNATTESTED,
    ATTESTATION.NEVER_COMPLETED,
    ATTESTATION.GENERATION_MISMATCH,
    ATTESTATION.MANIFEST_UNUSABLE,
  ]) {
    it(`⛔ ${state} tells the reader to force the rebuild`, () => {
      const { nextAction } = graphCapabilities({ ...base, attestation: state });
      expect(nextAction, 'a no-op rebuild cannot fix an unattested graph').toMatch(/force: true/);
    });
  }

  it('POSITIVE CONTROL: not_indexed still says the BARE form, and correctly', () => {
    // ⛔ Without this the fix would read as "always say force:true", which is wrong: with no graph
    // at all there is nothing to no-op over, and telling someone to force a build that has never
    // happened adds a flag for no reason.
    const { nextAction } = graphCapabilities({ indexed: false });
    expect(nextAction).toMatch(/graph_index\(\) to build the graph/);
    expectAbsentWithLiveMatcher(
      /force: true/,
      { forbidden: 'graph_index({ force: true })', allowed: 'graph_index() to build the graph' },
      nextAction,
      'a first build needs no force flag',
    );
  });
});
