// ★ "1688 TESTS PASS" IS NOT A STATEMENT ABOUT BEHAVIOUR, AND I KEPT QUOTING IT AS ONE.
//
// the reviewer's scope-4 audit (2026-08-10) measured that 68 of 1,593 declared cases
// invoke ZERO production behaviour — they read implementation files and assert regexes,
// token order, comments. All 68 stay green if the named behaviour becomes unreachable
// while the source spelling survives. Two more pass with no assertion at all on live
// paths, and 23 report PASS where they should report SKIP.
//
// Their conclusion, which this file enforces: counting those in one green headline
// INFLATES BEHAVIOURAL CONFIDENCE. The fix is classification, not deletion — structural
// contracts are worth keeping, they just must not be laundered into behavioural cover.
//
// And I am the reason it needs enforcing rather than documenting. I quoted "1688 pass"
// in four commit messages on 2026-08-11, after reading the audit, while ADDING to the
// number. A count that flatters the person reporting it does not get audited by them.
//
// ⚠ WHAT THIS FILE IS NOT: a claim that source-contract tests are worthless. Several
// below guard things that have no runtime surface to assert against. The claim is
// narrower and harder to argue with — THEY CANNOT FAIL WHEN THE BEHAVIOUR BREAKS, so
// they belong in a different denominator.
//
// ⚠ AND THE CLASSIFIER IS A HEURISTIC, stated plainly rather than dressed up: it asks
// whether a file reads implementation TEXT without importing implementation CODE. That
// under-counts mixed files (which contain source-only cases alongside real ones) and
// cannot see a zero-assert case at all. So the numbers here are a FLOOR, exactly as the
// original audit said of its own 68.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const TESTS_ROOT = join(import.meta.dirname, '..');

function allTestFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTestFiles(p, out);
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

function classify(filePath) {
  const src = readFileSync(filePath, 'utf8');
  // ⚠ A PATH HELD IN A CONST USED TO BE INVISIBLE HERE. Both patterns below require the
  // implementation path to appear INSIDE the readFileSync call, so the ordinary way to
  // write this —
  //     const SRC = join(dirname, '..', 'mcp', 'stdio', 'query', 'verbs', 'packet.js');
  //     readFileSync(SRC, 'utf8')
  // — read implementation text while classifying as behavioural. Two files were sitting in
  // that gap when it was found on 2026-08-18, one of them added the previous day by the
  // author of this ratchet. A measurement that cannot see the thing it measures does not
  // report zero honestly; it reports zero convincingly.
  const implPathConst = /const\s+\w+\s*=\s*(?:join|resolve|fileURLToPath|new URL)\([^;]*(?:mcp|scripts|integrations)/.test(src);
  const readsImplText = /readFileSync\([^)]*(mcp|scripts|integrations)/.test(src)
    || /readFileSync\(\s*join\([^)]*(mcp|scripts)/.test(src)
    || (implPathConst && /readFileSync\(/.test(src));
  // Static `from '…/mcp/…'` AND dynamic `await import('…/mcp/…')`. The dynamic form was
  // missed at first, so a genuine conversion (reindex-payload, 2026-08-11) stayed
  // classified as source-contract and the ratchet refused it credit. A measurement that
  // cannot see an improvement will eventually be worked around rather than fixed.
  const importsImplCode = /from '[^']*\/(mcp|scripts)\//.test(src)
    || /import\(\s*'[^']*\/(mcp|scripts)\//.test(src);
  if (readsImplText && !importsImplCode) return 'source_contract';
  if (readsImplText && importsImplCode) return 'mixed';
  return 'behavioural';
}

// ★ THE RATCHET. Every file here asserts on implementation TEXT and imports no
// implementation CODE, so none of them can fail when the behaviour they describe
// breaks. The list may SHRINK freely — converting one to a behavioural test is the
// goal. It may not GROW without a deliberate edit here, which is the whole point: a
// new one should cost a conversation, not slip in during a busy evening.
//
// Two were converted on 2026-08-11 and are deliberately absent:
//   · tier-identity-check's comment-matching case → tier-identity-behaviour.test.js,
//     which found a live `import_linked` mislabel within three minutes of running code
//   · framing-not-data's two declaration-shape assertions → the same file
// ★★ MUTATION EVIDENCE, 2026-08-11 — recorded per file, with the mutation named.
//
// the field test: "delete the behaviour, run the test, see if it goes red. Where it stays
// green, the test is decoration regardless of what either of us judged about it." And
// their caution, which decides how a result may be read: "a case that stays GREEN is
// decoration ONLY IF the mutation actually reached the behaviour it names."
//
// ⚠ MY FIRST TWO SWEEPS BOTH MEASURED THE WRONG THING, and the second failure is the more
// embarrassing:
//
//   ROUND 1 — mutated the LITERAL the test greps for (renamed the field, deleted the
//     string). All six went red, which proves nothing: a source-grep test notices a
//     spelling change by construction. I measured whether the grep works.
//   ROUND 2 — right mutation (keep the text, break the code), WRONG HARNESS. It treated
//     any thrown exception as a failing test, so a spawn error read as a caught mutation.
//     It reported RED for two files that are green. Careful direct runs are the truth.
//
// ⇒ Verified by hand, one file at a time, each mutation applied and reverted explicitly:
//
//   ✅ candidate-truncation-disclosed — CONVERTED 2026-08-11. Was DECORATION. Made the "SHOWING n OF m" banner
//      UNREACHABLE (`omitted = 0`) while leaving every string in source: 4/4 still green.
//      It asserts the banner's spelling, not that it ever fires.
//   ✅ health-dirty-noise — CONVERTED 2026-08-11. Was DECORATION. Corrupted the arithmetic it describes
//      (`dirtyFilesTotal + 999`) with all predicate text intact: 3/3 still green.
//      ⚠ Note the irony recorded in field testing separately: the dirtyFilesOmitted
//      arithmetic bug was caught by a human reading a live payload, NOT by this test —
//      which guards that exact line.
//   ✅ dirty-omitted-reconciles — CONVERTED 2026-08-11. Mutation split it cleanly: case 1
//      DID catch a different arithmetic error of the same class (a real guard, but one
//      pinning a spelling that a harmless refactor would break); case 2 asserted a
//      COMMENT within 900 chars of the field and could not fail for any arithmetic
//      reason. Replaced by a RECONCILIATION over the emitted payload — omitted + shown
//      must equal total — falsified by restoring the ORIGINAL historical bug
//      (unconditional `- DIRTY_LIST_CAP`), which turns 2 of 3 cases red.
//   ✅ packet-unranked-candidates — 3 of 4 real; the emissions were genuinely removed.
//   ✅ coverage-denominator — CONVERTED 2026-08-11. Was EIGHT regexes over health.js, all
//      spelling, none able to fail on a wrong number — on a statistic whose entire failure
//      mode IS a wrong number, and which the field test confirmed they actually use. The
//      computation was inline in health.js, which is why it had never been run in a test;
//      extracted to query/coverage-denominator.js and wired back, so the tested code is
//      the shipped code. Falsified by restoring the ORIGINAL 12% defect (divide by every
//      CALLS edge): 4 of 7 cases red.
//   ✅ observed-doc-mentions — CONVERTED 2026-08-11. Was SQL fragments and variable names
//      (`e.relation = 'MENTIONS'`, `COUNT(DISTINCT n.id)`, `declaredDocSet`) — rewrite the
//      query with a JOIN or rename a local and it goes red having found nothing, while a
//      genuinely reversed ranking sails through. Now builds a graph where the answer is
//      order-sensitive and asserts the ORDER. Falsified by flipping DESC to ASC.
//      ⚠ TWO FIXTURES WERE WRONG FIRST, and both were findings: (1) duplicate MENTIONS
//      rows are UNREPRESENTABLE — the schema has a UNIQUE constraint on
//      (from_id,to_id,relation), which the query's own comment already states, so the
//      DISTINCT guards a join fan-out rather than duplicate edges; (2) a single mention is
//      below the weak-signal FLOOR and is dropped, so a ranking test needs both documents
//      above it. Neither was visible from the source-grep version.
//   ✅ packet-timeout-not-absence — CONVERTED 2026-08-11, using the seam the field test named:
//      "needs an injectable slow lookup, then assert the TIMED OUT text". Was asserting
//      `featureLookupTimedOut = true` and the ORDER OF TWO BRANCHES by their byte offsets
//      — reorder them for readability and it goes red having found nothing, while a
//      timeout silently rendered as "not found" sails through. A vi.mock lookup that
//      never resolves reaches the real branch in the real verb; hanging rather than
//      sleeping near the budget keeps it off the flaky-on-loaded-CI path. Falsified by
//      discarding the timeout flag with every string intact: 3 of 3 red.
//   ✅ ambiguous-not-unmapped — CONVERTED 2026-08-11. Mutation had shown it UNTESTED
//      rather than cleared: 1 of 3 red, the other two never reached (a `.not.toMatch`
//      negative guard no emission change can fail, and an assertion on a different line).
//      ★ The negative guard is the point: the defect was a WRONG SENTENCE, so the test
//      that matters is "the old claim is not made" — and a source regex can only assert
//      that about the FILE, while a phrase absent from one file can be assembled in
//      another. Now asserts it about the OUTPUT. Falsified by restoring the original
//      false claim ("ambiguous / no feature mapping"): 2 of 3 red.
//
// ⇒ BOTH CONFIRMED DECORATIONS ARE NOW CONVERTED and removed from the list below. Each
// replacement was falsified against the exact mutation its predecessor survived:
//   · candidate-truncation now calls `buildAmbiguousMatchMessage` with 16 same-named
//     definitions and asserts the REAL integers (SHOWING 5 OF 16, 11 omitted). Making the
//     banner unreachable turns 3 cases red where the old file stayed 4/4 green.
//   · health-dirty-noise now indexes a scratch repo and compares `dirtyFilesTotal` to
//     reality. The +999 mutation turns it red where the old file stayed 3/3 green.
// Both also gained the missing negative half — no truncation marker when nothing was
// truncated, tracked dirt still reported when suppression fires — so "always emit" or
// "always suppress" cannot satisfy them.
const KNOWN_SOURCE_CONTRACT = new Set([
  // ★★ Was EMPTY as of 2026-08-11, when all eighteen source-contract tests had been made
  // behavioural. The last was degraded-split-persistence; the one before it,
  // stale-warning-actionable, was the file that argued advisory prose needed no fixture —
  // and it had broken twice that same day for reasons that were not behaviour changes.
  //
  // ⚠ Keep this set SMALL and every entry argued. An addition here is a test that reads
  // source instead of running it, and the ratchet exists so that choice has to be made
  // deliberately rather than by reaching for readFileSync because a seam looked hard to
  // build. Every one of the eighteen had a seam; four exposed live defects once it existed.
  //
  // ⛔ THE TWO ENTRIES BELOW WERE NOT A RELAPSE — THEY WERE ALWAYS HERE AND THE CLASSIFIER
  // COULD NOT SEE THEM. Both hold the implementation path in a const, which every pattern
  // in classify() missed until 2026-08-18. "Zero source-contract files" was true of what
  // the measurement could see, not of the suite. Neither has a seam to build; both are
  // arguing that the artifact under test IS text, which is the one case this list is for.
  // ⚠ ADDED 2026-08-19, and the argument is the narrow one this list is for: THE ARTIFACT
  //   UNDER TEST IS TEXT. The claim is "no remedy string in a default-profile verb names a
  //   verb outside that profile", and its population is EVERY such string — including branches
  //   that need a particular graph state to reach. A behavioural version would drive the misses
  //   it can construct and silently pass on the ones it cannot, which is the false-completeness
  //   this suite exists to refuse. It found SIX violations on its first run, five unreported.
  // ⚠ NOT fully source-only in fact: the profile it checks against comes from the REAL server
  //   over stdio, not from a copy of the constant, so a listing change is caught behaviourally.
  //   The classifier cannot see that half; recording it here rather than arguing with it.
  // ⚠ ADDED 2026-08-19. The artifact under test IS TEXT — a marker inside shipped markdown that
  //   lets an INSTALLED copy be recognised as stale by whoever reads it. There is no runtime
  //   seam because the thing being asserted never executes: skills are copied to a user's
  //   profile and read by an agent, not called. Building a behavioural harness here would mean
  //   inventing an execution path the artifact does not have.
  // ⚠ It also derives its runtime list from the directory rather than naming four, so a fifth
  //   integration cannot ship unstamped just because nobody edited the test.
  'unit/integrations/skill-safety-contract.test.js',
  'unit/query/remedy-names-a-reachable-verb.test.js',
  'unit/query/packet-route-inventory.test.js',
  //   ↳ ⚠ THE ARGUMENT THAT PUT THIS HERE WAS WRONG, AND THE ENTRY SURVIVES ON A SMALLER
  //     ONE. It read: "an INVENTORY cannot be behavioural by construction — its purpose is
  //     to catch a route nobody has written a fixture for." That defended a claim the file
  //     could not keep. review, hermes session added a disclosure-less branch INSIDE
  //     graphPacket and the route arm passed, because the check is function-level and that
  //     function calls the renderer elsewhere. A source-contract test whose contract is
  //     false is the worst case this list can hold: it retires a doubt it never earned.
  //     ⇒ The route-level guarantee is now BEHAVIOURAL — packet-seal.test.js plus the seal
  //     in packet.js, with the whole suite running APG_PACKET_SEAL_STRICT=1. What remains
  //     here is a cheap authoring-time smoke test for a wholly new listing function that
  //     never mentions the renderer, and its header now states that limit and the open
  //     obligation instead of claiming coverage of the branch case.
  'unit/integrations/skill-parity.test.js',
  //   ↳ The artifact under test is markdown we SHIP. There is no code whose behaviour this
  //     stands in for: the four SKILL.md trees are the product, and "these four files agree,
  //     use LF, and contain no '' escape corruption" is a statement about bytes. The
  //     body-parity half could be delegated to `scripts/sync-skills.mjs --check`, but the
  //     CRLF, quote-corruption and orphan-file arms — each of which caught a real shipped
  //     defect — have no runtime surface at all.
  // 'unit/query/response-budget.test.js' — reclassified 2026-08-11 when the classifier
  //   learned to see dynamic `await import()`. It was already running code; the
  //   heuristic could not see it. Not a conversion, a measurement fix.
  // 'unit/query/tier-identity-check.test.js' — DELETED 2026-08-11 with the
  // `symbol_referenced` tier it guarded. Its behavioural successor is
  // tier-identity-behaviour.test.js, which found a live mislabel within three minutes
  // of running the code the deleted file had only ever grepped.
  // 'unit/scripts/reindex-payload.test.js' — CONVERTED 2026-08-11, the first entry
  //   retired by running code rather than by argument. Its "never fails the git
  //   operation" case asserted /process\.exit\(0\)/ on a POST-COMMIT HOOK; it now forces
  //   a real ENOTDIR and asserts the exit code. Its three payload regexes now index a
  //   repo, move HEAD, run the hook and assert graph + briefs + categorization all came
  //   back in step. Falsified: disabling generateBrief fails the new test, while
  //   toMatch(/generateBrief/) still passed on the import line alone.
]);

describe('suite composition — what the green headline actually covers', () => {
  const files = allTestFiles(TESTS_ROOT);
  const byKind = { source_contract: [], mixed: [], behavioural: [] };
  for (const f of files) {
    byKind[classify(f)].push(relative(TESTS_ROOT, f).split(sep).join('/'));
  }

  it('★ no NEW source-contract-only test file appears without a deliberate edit here', () => {
    const unexpected = byKind.source_contract.filter((f) => !KNOWN_SOURCE_CONTRACT.has(f));
    expect(unexpected, [
      'A NEW TEST FILE ASSERTS ON IMPLEMENTATION TEXT AND RUNS NO IMPLEMENTATION CODE.',
      'It cannot fail when the behaviour it describes breaks, and it CAN fail when a line',
      'is reflowed — three did exactly that on 2026-08-11, each time on a fix rather than',
      'a regression. Prefer a fixture that runs the code. If the contract genuinely has no',
      'runtime surface, add the file to KNOWN_SOURCE_CONTRACT with a reason.',
    ].join(' ')).toEqual([]);
  });

  it('the ratchet only turns one way — a converted file must be removed from the list', () => {
    // Shrinking is the goal, so a stale entry is not a failure — but it must not be
    // invisible, or the list stops describing the suite and starts describing history.
    const stale = [...KNOWN_SOURCE_CONTRACT].filter((f) => !byKind.source_contract.includes(f));
    expect(stale, 'these are no longer source-contract-only — remove them from KNOWN_SOURCE_CONTRACT').toEqual([]);
  });

  it('★ reports the three denominators separately, so no one number stands for all of them', () => {
    // The assertion is deliberately weak; the VALUE is the printed breakdown. A single
    // "N pass" is the thing being corrected here, and a test that produced another
    // single number would be repeating the mistake in a smaller font.
    const total = files.length;
    const lines = [
      `  behavioural files : ${byKind.behavioural.length}`,
      `  mixed files       : ${byKind.mixed.length}  (contain source-only cases too — a FLOOR)`,
      `  source-contract   : ${byKind.source_contract.length}  (cannot fail when behaviour breaks)`,
      `  total             : ${total}`,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(`\nSUITE COMPOSITION — quote these three, not one:\n${lines}\n`);

    expect(total).toBe(byKind.behavioural.length + byKind.mixed.length + byKind.source_contract.length);
    // A floor on health, not a target: if the behavioural share ever drops below half,
    // the headline has stopped meaning anything at all.
    expect(byKind.behavioural.length / total).toBeGreaterThan(0.5);
  });
});
